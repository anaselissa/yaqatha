-- ============================================================================
-- يَقَظَة — الهجرة 15: امتحان آخر المسار (قرار محمد، 26 نوفمبر)
-- • خطوة من نوع «exam» آخر كل مسار، ولا يُنشر إصدار جديد بدونها (5 إلى 10 أسئلة).
-- • الأسئلة لا يقرؤها المستخدم من الجدول (حتى لا تُكشف الإجابات)، بل من دالة تعيدها بلا إجابات.
-- • التصحيح في القاعدة فقط. لا تكتمل خطوة الامتحان إلا بمحاولة ناجحة. المحاولات بلا حد.
-- • نسبة النجاح إعداد في اللوحة (exam_pass_percent، تبدأ 70).
-- • المسارات المنشورة قبل هذه الهجرة تبقى كما هي حتى يُنشر لها إصدار جديد.
-- إضافات فقط، آمنة للتطبيق على الإنتاج.
-- ============================================================================

alter type public.step_type add value if not exists 'exam';

-- ---------- 1) نسبة النجاح ----------
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check
  check (key in ('team_whatsapp', 'mentorship_open', 'women_section_open', 'mentorship_response_days', 'exam_pass_percent'));
insert into public.app_settings (key, value) values ('exam_pass_percent', '70') on conflict (key) do nothing;

create function public.exam_pass_percent() returns int
language sql stable security definer set search_path = public as $$
  select least(100, greatest(1, coalesce((select (value #>> '{}')::int from public.app_settings where key = 'exam_pass_percent'), 70)))
$$;

-- ---------- 2) أسئلة الامتحان ----------
create table public.exam_questions (
  id                 uuid primary key default gen_random_uuid(),
  step_id            uuid not null references public.steps(id) on delete cascade,
  position           int  not null default 1,
  prompt             text not null check (char_length(btrim(prompt)) between 1 and 500),
  options            jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5),
  correct_index      int  not null check (correct_index >= 0),
  explanation        text check (explanation is null or char_length(explanation) <= 2000),
  material_id        uuid references public.materials(id) on delete set null,   -- «راجع هذه المادة» في النتيجة
  source_question_id uuid references public.material_questions(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (correct_index < jsonb_array_length(options))
);
create index exam_questions_idx on public.exam_questions (step_id, position);
create trigger exam_questions_touch before update on public.exam_questions for each row execute function public.set_updated_at();

-- الأسئلة لخطوة امتحان فقط. في الإصدار المنشور يُسمح بتصحيح النصوص فقط، لا إضافة ولا حذف ولا تغيير الإجابة.
create function public.exam_questions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; vs public.version_status;
begin
  select s.type::text, v.status into st, vs
    from public.steps s join public.path_versions v on v.id = s.version_id
   where s.id = case when tg_op = 'DELETE' then old.step_id else new.step_id end;
  if tg_op <> 'DELETE' and st is distinct from 'exam' then
    raise exception 'questions belong to an exam step only' using errcode = 'P0001';
  end if;
  if vs is null or vs = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'DELETE') or new.step_id <> old.step_id or new.correct_index <> old.correct_index
     or jsonb_array_length(new.options) <> jsonb_array_length(old.options) then
    raise exception 'exam questions of a published version may only be corrected in wording' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger exam_questions_guard_trg before insert or update or delete on public.exam_questions
  for each row execute function public.exam_questions_guard();

revoke all on public.exam_questions from anon, authenticated;
alter table public.exam_questions enable row level security;
create policy exam_questions_staff on public.exam_questions for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
grant select, insert, update, delete on public.exam_questions to authenticated;
create trigger exam_questions_audit after insert or update or delete on public.exam_questions for each row execute function public.audit_row();

-- ---------- 3) المحاولات (يقرأ المستخدم محاولاته فقط، ولا يكتبها إلا عبر submit_exam) ----------
create table public.exam_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  step_id       uuid not null references public.steps(id) on delete cascade,
  score         int not null,
  total         int not null,
  passed        boolean not null,
  answers       jsonb not null,
  created_at    timestamptz not null default now()
);
create index exam_attempts_idx on public.exam_attempts (user_id, step_id, created_at desc);
revoke all on public.exam_attempts from anon, authenticated;
alter table public.exam_attempts enable row level security;
create policy exam_attempts_own_read on public.exam_attempts for select to authenticated using (user_id = auth.uid());
grant select on public.exam_attempts to authenticated;

-- ---------- 4) لا تكتمل خطوة الامتحان إلا بمحاولة ناجحة ----------
-- النجاح يُعرف بمفتاح الخطوة الثابت بين الإصدارات (step_key)، فينتقل مع ترقية التسجيل لإصدار أحدث.
create function public.exam_completion_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; k uuid; uid uuid;
begin
  if new.state <> 'completed' then return new; end if;
  select s.type::text, s.step_key into st, k from public.steps s where s.id = new.step_id;
  if st is distinct from 'exam' then return new; end if;
  select user_id into uid from public.enrollments where id = new.enrollment_id;
  if not exists (select 1 from public.exam_attempts a join public.steps s on s.id = a.step_id
                  where a.user_id = uid and a.passed and s.step_key = k) then
    raise exception 'exam not passed' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger exam_completion_guard_trg before insert or update on public.enrollment_steps
  for each row execute function public.exam_completion_guard();

-- ---------- 5) أسئلة الامتحان للمستخدم (بلا الإجابات) ----------
create function public.exam_for(p_enrollment_id uuid, p_step_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); e public.enrollments; n int; pct int; best public.exam_attempts;
begin
  select * into e from public.enrollments where id = p_enrollment_id and user_id = uid;
  if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.steps s where s.id = p_step_id and s.version_id = e.version_id and s.type::text = 'exam') then
    raise exception 'exam not found' using errcode = 'P0002';
  end if;
  select count(*) into n from public.exam_questions where step_id = p_step_id;
  pct := public.exam_pass_percent();
  select * into best from public.exam_attempts where user_id = uid and step_id = p_step_id
   order by passed desc, score desc, created_at desc limit 1;
  return jsonb_build_object(
    'total', n,
    'pass_percent', pct,
    'required', ceil(n * pct / 100.0)::int,
    'best', case when best.id is null then null else jsonb_build_object('score', best.score, 'total', best.total, 'passed', best.passed) end,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', q.options) order by random())
                             from public.exam_questions q where q.step_id = p_step_id), '[]'::jsonb));
end $$;

-- ---------- 6) التصحيح ----------
-- p_answers: {"<question_id>": <رقم الخيار الأصلي>, ...}. كل الأسئلة مطلوبة.
create function public.submit_exam(p_enrollment_id uuid, p_step_id uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); e public.enrollments; n int; score int; req int; ok boolean; aid uuid;
begin
  select * into e from public.enrollments where id = p_enrollment_id and user_id = uid;
  if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
  if e.status <> 'active' then raise exception 'enrollment is archived' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.steps s where s.id = p_step_id and s.version_id = e.version_id and s.type::text = 'exam') then
    raise exception 'exam not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'invalid answers' using errcode = '22023'; end if;
  -- حدّ معقول: 20 محاولة في 10 دقائق
  if (select count(*) from public.exam_attempts where user_id = uid and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'rate limited' using errcode = 'P0001';
  end if;

  select count(*) into n from public.exam_questions where step_id = p_step_id;
  if n = 0 then raise exception 'exam has no questions' using errcode = 'P0001'; end if;
  if exists (select 1 from public.exam_questions q where q.step_id = p_step_id
              and (jsonb_typeof(p_answers -> q.id::text) is distinct from 'number'
                   or (p_answers ->> q.id::text)::int not between 0 and jsonb_array_length(q.options) - 1)) then
    raise exception 'answer every question' using errcode = '22023';
  end if;

  select count(*) filter (where (p_answers ->> q.id::text)::int = q.correct_index) into score
    from public.exam_questions q where q.step_id = p_step_id;

  req := ceil(n * public.exam_pass_percent() / 100.0)::int;
  ok := score >= req;
  insert into public.exam_attempts (user_id, enrollment_id, step_id, score, total, passed, answers)
  values (uid, e.id, p_step_id, score, n, ok, p_answers) returning id into aid;

  if ok then
    insert into public.enrollment_steps (enrollment_id, version_id, step_id, state)
    values (e.id, e.version_id, p_step_id, 'completed')
    on conflict (enrollment_id, step_id) do update set state = 'completed', updated_at = now();
    update public.enrollments set last_step_id = p_step_id where id = e.id;
  end if;

  return jsonb_build_object('attempt_id', aid, 'score', score, 'total', n, 'required', req, 'passed', ok);
end $$;

-- مراجعة محاولة (لصاحبها فقط): كل سؤال بإجابته والإجابة الصحيحة والشرح ومادة المراجعة
create function public.exam_result(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); a public.exam_attempts;
begin
  select * into a from public.exam_attempts where id = p_attempt_id and user_id = uid;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'score', a.score, 'total', a.total, 'passed', a.passed,
    'required', ceil(a.total * public.exam_pass_percent() / 100.0)::int,
    'enrollment_id', a.enrollment_id, 'step_id', a.step_id,
    'results', coalesce((select jsonb_agg(jsonb_build_object(
           'id', q.id, 'prompt', q.prompt, 'options', q.options,
           'chosen', (a.answers ->> q.id::text)::int, 'correct_index', q.correct_index,
           'correct', (a.answers ->> q.id::text)::int = q.correct_index,
           'explanation', q.explanation,
           'material', case when m.id is null then null else jsonb_build_object('slug', m.slug, 'title', m.title) end
         ) order by q.position)
      from public.exam_questions q left join public.materials m on m.id = q.material_id and m.status = 'published'
     where q.step_id = a.step_id), '[]'::jsonb));
end $$;

-- ---------- 7) النشر: امتحان واحد، آخر خطوة، 5 إلى 10 أسئلة ----------
create or replace function public.publish_path_version(p_version_id uuid, p_changelog text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.path_versions; cl text; ex record; n int;
begin
  perform public.require_staff();
  select * into v from public.path_versions where id = p_version_id for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'only a draft version can be published' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.steps where version_id = v.id) then
    raise exception 'a path version needs at least one step' using errcode = 'P0001';
  end if;
  if (select count(*) from public.steps where version_id = v.id and type::text = 'exam') <> 1 then
    raise exception 'a path version needs exactly one exam step' using errcode = 'P0001';
  end if;
  select s.id, s.position into ex from public.steps s where s.version_id = v.id and s.type::text = 'exam';
  if ex.position <> (select max(position) from public.steps where version_id = v.id) then
    raise exception 'the exam must be the last step' using errcode = 'P0001';
  end if;
  select count(*) into n from public.exam_questions where step_id = ex.id;
  if n not between 5 and 10 then
    raise exception 'the exam needs 5 to 10 questions' using errcode = 'P0001';
  end if;
  cl := nullif(btrim(coalesce(p_changelog, v.changelog, '')), '');
  if v.version_no > 1 and cl is null then
    raise exception 'a changelog is required when publishing a new version' using errcode = 'P0001';
  end if;

  update public.path_versions set status = 'retired'
   where path_id = v.path_id and status = 'published';
  update public.path_versions set status = 'published', published_at = now(), changelog = cl
   where id = v.id;
  update public.paths set status = 'published' where id = v.path_id and status = 'draft';
end $$;

-- ---------- 8) الإصدار الجديد ينسخ أسئلة الامتحان ----------
create or replace function public.create_draft_version(p_path_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare src public.path_versions; nid uuid;
begin
  perform public.require_staff();
  select * into src from public.path_versions
   where path_id = p_path_id and status <> 'draft'
   order by version_no desc limit 1;
  if not found then
    raise exception 'no published version to copy from; create the first version directly' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.path_versions where path_id = p_path_id and status = 'draft') then
    raise exception 'a draft version already exists for this path' using errcode = '23505';
  end if;

  insert into public.path_versions (path_id, title, description, purpose, duration_days)
  values (p_path_id, src.title, src.description, src.purpose, src.duration_days)
  returning id into nid;

  insert into public.steps (version_id, step_key, position, type, title, instructions)
  select nid, step_key, position, type, title, instructions from public.steps where version_id = src.id;

  insert into public.step_materials (step_id, material_id, position)
  select sn.id, sm.material_id, sm.position
    from public.steps so
    join public.step_materials sm on sm.step_id = so.id
    join public.steps sn on sn.version_id = nid and sn.step_key = so.step_key
   where so.version_id = src.id;

  insert into public.exam_questions (step_id, position, prompt, options, correct_index, explanation, material_id, source_question_id)
  select sn.id, q.position, q.prompt, q.options, q.correct_index, q.explanation, q.material_id, q.source_question_id
    from public.steps so
    join public.exam_questions q on q.step_id = so.id
    join public.steps sn on sn.version_id = nid and sn.step_key = so.step_key
   where so.version_id = src.id;

  return nid;
end $$;

-- ---------- 9) المشرف يرى نتيجة الامتحان (ضمن موافقة مشاركة التقدّم الموجودة) ----------
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
               'last_activity', coalesce((select max(es.updated_at) from public.enrollment_steps es where es.enrollment_id = e.id), e.started_at),
               'exam', (select jsonb_build_object('score', a.score, 'total', a.total, 'passed', a.passed)
                          from public.exam_attempts a where a.enrollment_id = e.id
                         order by a.passed desc, a.score desc, a.created_at desc limit 1)
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

-- ---------- 10) الصلاحيات ----------
revoke execute on function public.exam_pass_percent(), public.exam_questions_guard(), public.exam_completion_guard(),
  public.exam_for(uuid, uuid), public.submit_exam(uuid, uuid, jsonb), public.exam_result(uuid) from public, anon, authenticated;
grant execute on function public.exam_for(uuid, uuid), public.submit_exam(uuid, uuid, jsonb), public.exam_result(uuid) to authenticated;
