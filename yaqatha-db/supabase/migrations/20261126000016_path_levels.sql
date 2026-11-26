-- ============================================================================
-- يَقَظَة — الهجرة 16: مستويات المسارات (قرارات أنس، 26 نوفمبر)
-- • تمهيدي / أساسي / متقدم على كل إصدار (اعتمدها محمد). يقدّره المحرر، ولا يُنشر إصدار بلا مستوى.
-- • الإصدارات المنشورة والسابقة تأخذ «تمهيدي»، ويغيّرها المحرر (المستوى بيان وصفي، يُعدَّل حتى بعد النشر).
-- • روابط «ما بعد المسار» صار لها نوع: المستوى التالي، أو مسار قريب.
-- • لا قفل: المستوى لا يمنع أحدًا من بدء أي مسار.
-- إضافات فقط، آمنة للتطبيق على الإنتاج.
-- ============================================================================

create type public.path_level as enum ('intro', 'basic', 'advanced');

alter table public.path_versions add column level public.path_level;
update public.path_versions set level = 'intro' where status <> 'draft';
grant insert (level), update (level) on public.path_versions to authenticated;

alter table public.path_next add column kind text not null default 'related' check (kind in ('next_level', 'related'));
grant update (kind, position) on public.path_next to authenticated;

-- النشر: الشروط السابقة (الهجرة 15) + المستوى
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
  if v.level is null then raise exception 'a path version needs a level' using errcode = 'P0001'; end if;
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

-- الإصدار الجديد ينسخ المستوى أيضًا
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

  insert into public.path_versions (path_id, title, description, purpose, duration_days, level)
  values (p_path_id, src.title, src.description, src.purpose, src.duration_days, src.level)
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

-- المستوى في عرض المسارات المنشورة (عمود جديد في آخره؛ الصلاحيات تبقى)
create or replace view public.paths_current with (security_invoker = true) as
select p.id as path_id, p.slug, p.change_type,
       v.id as version_id, v.version_no, v.title, v.description, v.purpose,
       v.duration_days, v.published_at, v.level
  from public.paths p
  join public.path_versions v on v.path_id = p.id and v.status = 'published'
 where p.status = 'published';
