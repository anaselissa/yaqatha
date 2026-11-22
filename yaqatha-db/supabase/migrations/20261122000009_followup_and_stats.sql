-- ============================================================================
-- يَقَظَة — الهجرة 9: الإعدادات، المتابِعون، طلبات المتابعة المباشرة، وأرقام الأثر للوحة
-- إضافات فقط: لا تعديل ولا حذف لأي جدول أو بيانات موجودة. آمنة للتطبيق على الإنتاج.
-- مبدأ الخصوصية: رقم الهاتف لا يراه إلا صاحبه والمدير والمتابِع المسنَد إليه الطلب؛ ولا يُسجَّل في سجل التغييرات.
-- ============================================================================

-- ---------- الإعدادات العامة (يعدّلها المدير من اللوحة) ----------
create table public.app_settings (
  key        text primary key check (key in ('team_whatsapp', 'mentorship_open', 'women_section_open', 'mentorship_response_days')),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('team_whatsapp', 'null'), ('mentorship_open', 'true'), ('women_section_open', 'false'), ('mentorship_response_days', '3');
create trigger app_settings_touch before update on public.app_settings for each row execute function public.set_updated_at();

create function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;

-- ---------- المتابِعون: يُعرَّفون ببريد Google المؤكَّد، ويرون الطلبات المسندة إليهم فقط ----------
create table public.mentors (
  email      text primary key check (email = lower(btrim(email)) and email like '%@%'),
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;

create function public.is_mentor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mentors where email = public.my_email())
$$;

-- ---------- طلبات المتابعة ----------
create type public.mentorship_status as enum ('new', 'contacted', 'active', 'closed');

create table public.mentorship_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  phone          text check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{6,19}$'),
  other_contact  text check (other_contact is null or char_length(other_contact) <= 200),
  preferred_time text check (preferred_time is null or char_length(preferred_time) <= 100),
  topic          text not null check (topic in ('prayer', 'repentance', 'quit_habit', 'quran', 'faith', 'character', 'family', 'time', 'knowledge', 'other')),
  gender         text not null check (gender in ('male', 'female')),
  status         public.mentorship_status not null default 'new',
  assigned_to    text,                                -- بريد المتابِع أو عضو الفريق
  staff_note     text check (staff_note is null or char_length(staff_note) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (phone is not null or other_contact is not null)
);
-- طلب واحد مفتوح لكل مستخدم
create unique index mentorship_one_open on public.mentorship_requests (user_id) where status <> 'closed';
create index mentorship_status_idx on public.mentorship_requests (status, created_at desc);
create index mentorship_assigned_idx on public.mentorship_requests (assigned_to);
create trigger mentorship_touch before update on public.mentorship_requests for each row execute function public.set_updated_at();

-- الطلب الجديد: يُحترم إيقاف الاستقبال وقسم الأخوات، ويبدأ دائمًا «جديدًا» بلا إسناد ولا ملاحظة
create function public.mentorship_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((public.setting('mentorship_open'))::boolean, false) is not true then
    raise exception 'mentorship requests are closed' using errcode = 'P0001';
  end if;
  if new.gender = 'female' and coalesce((public.setting('women_section_open'))::boolean, false) is not true then
    raise exception 'women section is not open yet' using errcode = 'P0001';
  end if;
  new.status := 'new'; new.assigned_to := null; new.staff_note := null;
  return new;
end $$;
create trigger mentorship_before_ins before insert on public.mentorship_requests
  for each row execute function public.mentorship_before_insert();

-- ---------- الصلاحيات ----------
revoke all on public.app_settings, public.mentors, public.mentorship_requests from anon, authenticated;
alter table public.app_settings        enable row level security;
alter table public.mentors             enable row level security;
alter table public.mentorship_requests enable row level security;

create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);
create policy app_settings_write on public.app_settings for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create policy mentors_manager on public.mentors for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create policy mentorship_read on public.mentorship_requests for select to authenticated
  using (user_id = auth.uid() or (select public.is_manager()) or assigned_to = (select public.my_email()));
create policy mentorship_insert on public.mentorship_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy mentorship_update on public.mentorship_requests for update to authenticated
  using ((select public.is_manager()) or assigned_to = (select public.my_email()))
  with check ((select public.is_manager()) or assigned_to = (select public.my_email()));
create policy mentorship_delete on public.mentorship_requests for delete to authenticated
  using (user_id = auth.uid() or (select public.is_manager()));

grant select on public.app_settings to anon, authenticated;
grant update (value) on public.app_settings to authenticated;
grant select, insert, delete on public.mentors to authenticated;
grant select, delete on public.mentorship_requests to authenticated;
grant insert (name, phone, other_contact, preferred_time, topic, gender) on public.mentorship_requests to authenticated;
grant update (status, assigned_to, staff_note) on public.mentorship_requests to authenticated;

-- المتابِع المسنَد لا يعيد الإسناد لغيره؛ ذلك للمدير وحده
create function public.mentorship_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is distinct from old.assigned_to and not public.is_manager() then
    raise exception 'only a manager can assign requests' using errcode = '42501';
  end if;
  new.assigned_to := nullif(lower(btrim(coalesce(new.assigned_to, ''))), '');
  return new;
end $$;
create trigger mentorship_before_upd before update on public.mentorship_requests
  for each row execute function public.mentorship_before_update();

create trigger app_settings_audit after insert or update or delete on public.app_settings for each row execute function public.audit_row();
create trigger mentors_audit      after insert or update or delete on public.mentors      for each row execute function public.audit_row();
-- طلبات المتابعة لا تُسجَّل في audit_log عمدًا: فيها أرقام هواتف.

-- ---------- أرقام الأثر للوحة: أعداد مجمّعة فقط، بلا أي هوية ----------
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.require_staff();
  with prog as (
    select e.id, e.user_id, e.path_id,
           (select count(*) from public.steps s where s.version_id = e.version_id) as total,
           (select count(*) from public.enrollment_steps es where es.enrollment_id = e.id and es.state = 'completed') as done
      from public.enrollments e
  ),
  per_path as (
    select p.id, p.slug, p.status,
           coalesce((select v.title from public.path_versions v where v.path_id = p.id and v.status = 'published'),
                    (select v.title from public.path_versions v where v.path_id = p.id order by v.version_no desc limit 1)) as title,
           (select count(distinct pr.user_id) from prog pr where pr.path_id = p.id) as started,
           (select count(distinct pr.user_id) from prog pr where pr.path_id = p.id and pr.total > 0 and pr.done = pr.total) as completed,
           (select count(distinct g.id) from public.goals g
              join public.goal_enrollments ge on ge.goal_id = g.id
              join public.enrollments e on e.id = ge.enrollment_id and e.path_id = p.id
             where g.title in (select sg.title from public.path_suggested_goals sg where sg.path_id = p.id)) as adopted_goals
      from public.paths p
     where p.status <> 'draft'
  )
  select jsonb_build_object(
    'users_total',   (select count(*) from auth.users),
    'users_7d',      (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'users_30d',     (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d',     (select count(distinct e.user_id) from public.enrollment_steps es join public.enrollments e on e.id = es.enrollment_id
                       where es.updated_at > now() - interval '7 days'),
    'started_total',   (select count(distinct (user_id, path_id)) from prog),
    'completed_total', (select count(distinct (user_id, path_id)) from prog where total > 0 and done = total),
    'goals_total',   (select count(*) from public.goals),
    'requests_new',  (select count(*) from public.mentorship_requests where status = 'new'),
    'requests_open', (select count(*) from public.mentorship_requests where status <> 'closed'),
    'paths', coalesce((select jsonb_agg(to_jsonb(pp) order by pp.started desc, pp.title) from per_path pp), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function public.setting(text), public.my_email(), public.is_mentor(), public.admin_stats(),
  public.mentorship_before_insert(), public.mentorship_before_update() from public, anon, authenticated;
grant execute on function public.my_email(), public.is_mentor(), public.admin_stats() to authenticated;
