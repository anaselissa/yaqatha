-- ============================================================================
-- يَقَظَة — الهجرة 10: أسئلة بعد المادة («اختبر فهمك»)، والنقاط وسلسلة الأيام
-- إضافات فقط. القرار: النقاط للتنافس مع النفس فقط — لا ترتيب بين الناس، ولا تُقرأ نقاط أحد إلا لصاحبها.
-- النقاط على الالتزام والتعلّم (خطوة مكتملة، إجابة صحيحة، مسار مكتمل)، لا على العبادة نفسها.
-- ============================================================================

create table public.material_questions (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.materials(id) on delete cascade,
  position      int  not null default 1,
  prompt        text not null check (char_length(btrim(prompt)) between 1 and 500),
  options       jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5),
  correct_index int  not null check (correct_index >= 0),
  explanation   text check (explanation is null or char_length(explanation) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (correct_index < jsonb_array_length(options))
);
create index material_questions_idx on public.material_questions (material_id, position);
create trigger material_questions_touch before update on public.material_questions for each row execute function public.set_updated_at();

-- أول إجابة هي المحسوبة (لا تحسين للنقاط بالتكرار)؛ يمكن إعادة الإجابة للتعلّم دون تغيير السجل
create table public.quiz_attempts (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id  uuid not null references public.material_questions(id) on delete cascade,
  chosen_index int  not null check (chosen_index >= 0),
  correct      boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- الصحة تُحسب في القاعدة، لا يُرسلها المتصفح
create function public.quiz_attempt_grade() returns trigger
language plpgsql security definer set search_path = public as $$
declare q public.material_questions;
begin
  select * into q from public.material_questions where id = new.question_id;
  if not found or new.chosen_index >= jsonb_array_length(q.options) then
    raise exception 'invalid answer' using errcode = '22023';
  end if;
  new.user_id := auth.uid();
  new.correct := (new.chosen_index = q.correct_index);
  new.created_at := now();
  return new;
end $$;
create trigger quiz_attempt_grade before insert on public.quiz_attempts for each row execute function public.quiz_attempt_grade();

revoke all on public.material_questions, public.quiz_attempts from anon, authenticated;
alter table public.material_questions enable row level security;
alter table public.quiz_attempts      enable row level security;

-- السؤال يظهر لمن يرى مادته (RLS المواد داخل الاستعلام الفرعي)
create policy material_questions_read on public.material_questions for select to anon, authenticated
  using (exists (select 1 from public.materials m where m.id = material_id));
create policy material_questions_write on public.material_questions for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy quiz_attempts_own_read on public.quiz_attempts for select to authenticated using (user_id = auth.uid());
create policy quiz_attempts_own_insert on public.quiz_attempts for insert to authenticated
  with check (exists (select 1 from public.material_questions q where q.id = question_id));

grant select on public.material_questions to anon, authenticated;
grant insert, update, delete on public.material_questions to authenticated;
grant select on public.quiz_attempts to authenticated;
grant insert (question_id, chosen_index) on public.quiz_attempts to authenticated;

create trigger material_questions_audit after insert or update or delete on public.material_questions for each row execute function public.audit_row();

-- ---------- ملخصي: النقاط وسلسلة الأيام (لصاحب الحساب فقط) ----------
-- خطوة مكتملة = 10، إجابة صحيحة أولى = 5، مسار مكتمل = 30. اليوم بتوقيت مكة (UTC+3، يناسب الأردن والسعودية).
create function public.my_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  steps_done int; correct int; answered int; paths_done int; streak int := 0; d date; today date;
begin
  if uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  today := (now() at time zone 'Asia/Riyadh')::date;
  select count(*) into steps_done from public.enrollment_steps es join public.enrollments e on e.id = es.enrollment_id
   where e.user_id = uid and es.state = 'completed';
  select count(*) filter (where qa.correct), count(*) into correct, answered from public.quiz_attempts qa where qa.user_id = uid;
  select count(*) into paths_done from public.enrollments e
   where e.user_id = uid
     and (select count(*) from public.steps s where s.version_id = e.version_id) > 0
     and (select count(*) from public.steps s where s.version_id = e.version_id)
       = (select count(*) from public.enrollment_steps es where es.enrollment_id = e.id and es.state = 'completed');
  -- السلسلة: أيام متتالية فيها نشاط، تنتهي اليوم أو أمس (فلا تنكسر قبل نهاية اليوم)
  d := today;
  if not exists (select 1 from public.activity_days(uid) a where a.day = today) then d := today - 1; end if;
  while exists (select 1 from public.activity_days(uid) a where a.day = d) loop
    streak := streak + 1; d := d - 1;
  end loop;
  return jsonb_build_object(
    'points', steps_done * 10 + correct * 5 + paths_done * 30,
    'steps_done', steps_done, 'correct_answers', correct, 'answered', answered, 'paths_done', paths_done,
    'streak_days', streak, 'active_today', exists (select 1 from public.activity_days(uid) a where a.day = today)
  );
end $$;

create function public.activity_days(p_uid uuid) returns table (day date)
language sql stable security definer set search_path = public as $$
  select distinct (es.updated_at at time zone 'Asia/Riyadh')::date from public.enrollment_steps es
    join public.enrollments e on e.id = es.enrollment_id where e.user_id = p_uid and es.state = 'completed'
  union
  select distinct (qa.created_at at time zone 'Asia/Riyadh')::date from public.quiz_attempts qa where qa.user_id = p_uid
$$;

revoke execute on function public.my_progress(), public.activity_days(uuid), public.quiz_attempt_grade() from public, anon, authenticated;
grant execute on function public.my_progress() to authenticated;
