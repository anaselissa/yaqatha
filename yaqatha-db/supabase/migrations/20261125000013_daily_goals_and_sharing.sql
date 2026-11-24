-- الهجرة 13: عدّاد يومي للأهداف، ومشاركة التقدّم مع المشرف (باختيار المستخدم)، ونوع البلاغ.
-- كلها إضافية: أعمدة جديدة بقيم افتراضية، وجدول جديد، ودالتان. لا يتغير شيء مما سبق.

-- ---------- 1) الأهداف اليومية ----------
-- kind: once = يُعلَّم عند إنجازه (كما كان)، daily = يُعلَّم كل يوم لعدد من الأيام
alter table public.goals add column kind text not null default 'once' check (kind in ('once', 'daily'));
alter table public.goals add column days smallint check (days is null or days between 1 and 365);
alter table public.goals add constraint goals_days_only_daily check (kind = 'daily' or days is null);
grant insert (kind, days) on public.goals to authenticated;
grant update (kind, days) on public.goals to authenticated;

-- يوم واحد لكل هدف: done = أنجزه، false = «ليس اليوم»
create table public.goal_checkins (
  goal_id    uuid not null references public.goals(id) on delete cascade,
  day        date not null,
  done       boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (goal_id, day)
);

-- اليوم يرسله المتصفح بتوقيت المستخدم، فنقبل يومًا قبل أو بعد تاريخ الخادم فقط (لا تعليم لأيام بعيدة)
create function public.goal_checkin_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.day < current_date - 1 or new.day > current_date + 1 then
    raise exception 'checkin day out of range' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.goals g where g.id = new.goal_id and g.kind = 'daily') then
    raise exception 'only daily goals take checkins' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger goal_checkins_guard before insert or update on public.goal_checkins
  for each row execute function public.goal_checkin_guard();
revoke execute on function public.goal_checkin_guard() from public, anon, authenticated;

revoke all on public.goal_checkins from anon, authenticated;
alter table public.goal_checkins enable row level security;
create policy goal_checkins_own on public.goal_checkins for all to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid()));
grant select, delete on public.goal_checkins to authenticated;
grant insert (goal_id, day, done) on public.goal_checkins to authenticated;
grant update (done) on public.goal_checkins to authenticated;

-- ---------- 2) نوع البلاغ ----------
alter table public.material_reports add column kind text
  check (kind is null or kind in ('broken_link', 'content_error', 'unclear_source', 'other'));
grant insert (kind) on public.material_reports to authenticated;

-- ---------- 3) مشاركة التقدّم مع المشرف المكلّف ----------
-- مطفأة افتراضيًا. يراها المدير والمتابِع المسنَد إليه الطلب فقط، ومن خلال دالة تعيد التقدّم وحده
-- (اسم المسار وعدد الخطوات المنجزة وآخر نشاط): لا أهداف ولا ملاحظات ولا ما كتبه المستخدم لنفسه.
alter table public.mentorship_requests add column share_progress boolean not null default false;
grant insert (share_progress) on public.mentorship_requests to authenticated;

-- المستخدم يغيّر الموافقة على طلبه المفتوح متى شاء (سياسة التحديث للفريق فقط، فنمرّ عبر دالة)
create function public.set_share_progress(on_off boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  update public.mentorship_requests set share_progress = on_off
   where user_id = auth.uid() and status <> 'closed';
  get diagnostics n = row_count;
  return n > 0;
end $$;

create function public.mentee_progress(request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.mentorship_requests;
begin
  select * into r from public.mentorship_requests where id = request_id;
  if r.id is null or not (public.is_manager() or r.assigned_to = public.my_email()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not r.share_progress then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'title', v.title,
             'done',  (select count(*) from public.enrollment_steps es where es.enrollment_id = e.id and es.state = 'completed'),
             'total', (select count(*) from public.steps s where s.version_id = e.version_id),
             'started_at', e.started_at,
             'last_activity', coalesce((select max(es.updated_at) from public.enrollment_steps es where es.enrollment_id = e.id), e.started_at)
           ) order by e.started_at desc)
      from public.enrollments e
      join public.path_versions v on v.id = e.version_id
     where e.user_id = r.user_id and e.status = 'active'), '[]'::jsonb);
end $$;

revoke execute on function public.set_share_progress(boolean), public.mentee_progress(uuid) from public, anon, authenticated;
grant execute on function public.set_share_progress(boolean), public.mentee_progress(uuid) to authenticated;
