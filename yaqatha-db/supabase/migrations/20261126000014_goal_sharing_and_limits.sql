-- الهجرة 14: المشرف يرى التزام المتابَع بعاداته اليومية (بموافقة منفصلة)، وحدّ لعدد البلاغات وطلبات المتابعة.
-- إضافية: عمود جديد بقيمة افتراضية، وجدول داخلي، ودوال. لا تغيير على ما سبق إلا توسيع ما تعيده mentee_progress.

-- ---------- 1) موافقة منفصلة لمشاركة العادات اليومية ----------
-- من وافق سابقًا على مشاركة المسارات لم يوافق على هذه، فتبقى مطفأة حتى يختارها.
alter table public.mentorship_requests add column share_goals boolean not null default false;
grant insert (share_goals) on public.mentorship_requests to authenticated;

create function public.set_share_goals(on_off boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  update public.mentorship_requests set share_goals = on_off
   where user_id = auth.uid() and status <> 'closed';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- تعيد الآن كائنًا: { paths: [...] أو null، goals: [...] أو null } بحسب ما وافق عليه المستخدم.
-- العادات: العنوان، والمدة، وعدد الأيام المنجزة، وآخر 7 أيام، وهل علّمها اليوم. لا وصف ولا ملاحظات.
create or replace function public.mentee_progress(request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.mentorship_requests;
declare p jsonb; declare g jsonb;
begin
  select * into r from public.mentorship_requests where id = request_id;
  if r.id is null or not (public.is_manager() or r.assigned_to = public.my_email()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not r.share_progress and not r.share_goals then return null; end if;
  if r.share_progress then
    p := coalesce((
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
  end if;
  if r.share_goals then
    g := coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', gl.title,
               'days', gl.days,
               'done', (select count(*) from public.goal_checkins c where c.goal_id = gl.id and c.done),
               'last7', (select count(*) from public.goal_checkins c where c.goal_id = gl.id and c.done and c.day > current_date - 7),
               'last_day', (select max(c.day) from public.goal_checkins c where c.goal_id = gl.id and c.done)
             ) order by gl.created_at)
        from public.goals gl
       where gl.user_id = r.user_id and gl.kind = 'daily' and gl.status in ('not_started', 'in_progress')), '[]'::jsonb);
  end if;
  return jsonb_build_object('paths', p, 'goals', g);
end $$;

revoke execute on function public.set_share_goals(boolean) from public, anon, authenticated;
grant execute on function public.set_share_goals(boolean) to authenticated;

-- ---------- 2) حدّ للإرسال: البلاغات وطلبات المتابعة ----------
-- سجل داخلي لا يقرؤه أحد من الواجهة (لا صلاحيات للمستخدمين عليه)، تملؤه المشغّلات وحدها.
create table public.rate_events (
  user_id uuid not null,
  kind    text not null,
  at      timestamptz not null default now()
);
create index rate_events_idx on public.rate_events (user_id, kind, at desc);
revoke all on public.rate_events from public, anon, authenticated;
alter table public.rate_events enable row level security;

create function public.rate_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); declare k text := tg_argv[0];
declare per_hour int := tg_argv[1]::int; declare per_day int := tg_argv[2]::int;
begin
  if u is null then return new; end if; -- إدراج من الخادم أو SQL Editor: بلا حد
  if (select count(*) from public.rate_events where user_id = u and kind = k and at > now() - interval '1 hour') >= per_hour
     or (select count(*) from public.rate_events where user_id = u and kind = k and at > now() - interval '1 day') >= per_day then
    raise exception 'rate limited' using errcode = 'P0001';
  end if;
  insert into public.rate_events (user_id, kind) values (u, k);
  delete from public.rate_events where at < now() - interval '2 days' and user_id = u;
  return new;
end $$;
revoke execute on function public.rate_guard() from public, anon, authenticated;

-- البلاغ: 10 في الساعة، 30 في اليوم. طلب المتابعة (يمكن سحبه وإعادته): 3 في الساعة، 5 في اليوم.
create trigger material_reports_rate before insert on public.material_reports
  for each row execute function public.rate_guard('report', '10', '30');
create trigger mentorship_requests_rate before insert on public.mentorship_requests
  for each row execute function public.rate_guard('mentorship', '3', '5');
