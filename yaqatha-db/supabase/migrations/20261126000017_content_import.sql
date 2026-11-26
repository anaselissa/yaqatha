-- ============================================================================
-- يَقَظَة — الهجرة 17: رفع المحتوى بالجملة (صيغة yaqatha-content/1، انظر docs/CONTENT_IMPORT_FORMAT.md)
-- • import_content(ملف، فحص فقط؟): الملف كله أو لا شيء. الفحص يجري الاستيراد كاملًا ثم يتراجع عنه،
--   فيُظهر النتيجة الحقيقية بلا أي تغيير.
-- • كل ما يُرفع مسودة، وحالة المراجعة «تجريبي»، وreview_note تُحفظ ملاحظة داخلية للمراجع.
-- • مادة موجودة مسودة تُحدَّث؛ منشورة لا تُمسّ. مسار موجود لا يُعاد إنشاؤه.
-- • «المسار التالي» غير الموجود يُحفظ معلّقًا ويُربط حين يُرفع.
-- • للمدير والمحرر فقط. إضافات فقط، آمنة للتطبيق على الإنتاج.
-- ============================================================================

create table public.pending_path_links (
  path_id   uuid not null references public.paths(id) on delete cascade,
  next_slug text not null,
  kind      text not null default 'related' check (kind in ('next_level', 'related')),
  created_at timestamptz not null default now(),
  primary key (path_id, next_slug)
);
revoke all on public.pending_path_links from anon, authenticated;
alter table public.pending_path_links enable row level security;
create policy pending_links_staff on public.pending_path_links for select to authenticated using ((select public.is_staff()));
grant select on public.pending_path_links to authenticated;

-- الاستيراد الفعلي (داخلي: لا يُستدعى مباشرة)
create function public.import_content_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w text[] := '{}';
  m jsonb; s jsonb; q jsonb; g jsonb; nx jsonb;
  mid uuid; pid uuid; vid uuid; sid uuid; nid uuid; did uuid;
  st public.publish_status; slug_ text; t text; i int; k int;
  mats_new int := 0; mats_upd int := 0; mats_skip int := 0; qs int := 0; exq int := 0; nsteps int := 0;
  pth jsonb := p -> 'path'; ptitle text; plevel text;
  slug_re constant text := '^[a-z0-9]+(-[a-z0-9]+)*$';
begin
  if p ->> 'format' is distinct from 'yaqatha-content/1' then
    raise exception 'الصيغة غير معروفة: يجب أن يكون "format" هو "yaqatha-content/1"' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p -> 'materials', '[]')) <> 'array' then
    raise exception '"materials" يجب أن تكون قائمة' using errcode = 'P0001';
  end if;

  -- ---------- المواد ----------
  for m in select * from jsonb_array_elements(coalesce(p -> 'materials', '[]')) loop
    slug_ := m ->> 'slug';
    if slug_ is null or slug_ !~ slug_re or length(slug_) > 80 then
      raise exception 'مادة بمعرّف غير صالح: «%» (حروف إنجليزية صغيرة وأرقام وشرطة)', coalesce(slug_, '؟') using errcode = 'P0001';
    end if;
    if nullif(btrim(m ->> 'title'), '') is null then raise exception 'المادة «%» بلا عنوان', slug_ using errcode = 'P0001'; end if;
    if (m ->> 'type') is null or (m ->> 'type') not in (select unnest(enum_range(null::public.material_type))::text) then
      raise exception 'المادة «%»: نوع غير معروف «%»', slug_, coalesce(m ->> 'type', '') using errcode = 'P0001';
    end if;
    if (m ->> 'nature') is not null and (m ->> 'nature') not in ('original_source', 'yaqatha_summary') then
      raise exception 'المادة «%»: nature غير معروفة «%»', slug_, m ->> 'nature' using errcode = 'P0001';
    end if;

    select id, status into mid, st from public.materials where slug = slug_;
    if mid is not null and st <> 'draft' then
      mats_skip := mats_skip + 1;
      w := w || format('المادة «%s» منشورة: لم تُمسّ (عدّلها من اللوحة إن لزم)', slug_);
      continue;
    end if;
    if mid is null then
      insert into public.materials (slug, title, description, type, body, url, source_title, source_url, author, nature, status)
      values (slug_, btrim(m ->> 'title'), nullif(m ->> 'description', ''), (m ->> 'type')::public.material_type, nullif(m ->> 'body', ''),
              nullif(m ->> 'url', ''), nullif(m ->> 'source_title', ''), nullif(m ->> 'source_url', ''), nullif(m ->> 'author', ''),
              coalesce(nullif(m ->> 'nature', ''), 'yaqatha_summary')::public.content_nature, 'draft')
      returning id into mid;
      mats_new := mats_new + 1;
    else
      update public.materials set title = btrim(m ->> 'title'), description = nullif(m ->> 'description', ''), type = (m ->> 'type')::public.material_type,
             body = nullif(m ->> 'body', ''), url = nullif(m ->> 'url', ''), source_title = nullif(m ->> 'source_title', ''),
             source_url = nullif(m ->> 'source_url', ''), author = nullif(m ->> 'author', ''),
             nature = coalesce(nullif(m ->> 'nature', ''), 'yaqatha_summary')::public.content_nature
       where id = mid;
      delete from public.material_questions where material_id = mid;
      delete from public.material_needs where material_id = mid;
      delete from public.material_domains where material_id = mid;
      mats_upd := mats_upd + 1;
      w := w || format('المادة «%s» كانت مسودة: حُدّثت', slug_);
    end if;

    for t in select jsonb_array_elements_text(coalesce(m -> 'needs', '[]')) loop
      select id into nid from public.needs where slug = t;
      if nid is null then raise exception 'المادة «%»: احتياج غير معروف «%»', slug_, t using errcode = 'P0001'; end if;
      insert into public.material_needs (material_id, need_id) values (mid, nid) on conflict do nothing;
    end loop;
    if nullif(m ->> 'domain', '') is not null then
      select id into did from public.domains where slug = m ->> 'domain';
      if did is null then raise exception 'المادة «%»: مجال غير معروف «%»', slug_, m ->> 'domain' using errcode = 'P0001'; end if;
      insert into public.material_domains (material_id, domain_id) values (mid, did) on conflict do nothing;
    end if;

    i := 0;
    for q in select * from jsonb_array_elements(coalesce(m -> 'questions', '[]')) loop
      i := i + 1;
      if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') not between 2 and 5
         or (q ->> 'correct_index') is null or (q ->> 'correct_index')::int not between 0 and jsonb_array_length(q -> 'options') - 1
         or nullif(btrim(q ->> 'prompt'), '') is null then
        raise exception 'المادة «%»: السؤال % غير صالح (2 إلى 5 خيارات، وcorrect_index يبدأ من 0)', slug_, i using errcode = 'P0001';
      end if;
      insert into public.material_questions (material_id, position, prompt, options, correct_index, explanation)
      values (mid, i, btrim(q ->> 'prompt'), q -> 'options', (q ->> 'correct_index')::int, nullif(q ->> 'explanation', ''));
      qs := qs + 1;
    end loop;

    if nullif(m ->> 'review_note', '') is not null then
      update public.content_review set internal_note = left(m ->> 'review_note', 2000), review_status = 'experimental'
       where entity_type = 'material' and entity_id = mid;
    end if;
  end loop;

  -- ---------- المسار ----------
  if pth is not null and jsonb_typeof(pth) = 'object' then
    slug_ := pth ->> 'slug';
    if slug_ is null or slug_ !~ slug_re or length(slug_) > 80 then
      raise exception 'مسار بمعرّف غير صالح: «%»', coalesce(slug_, '؟') using errcode = 'P0001';
    end if;
    ptitle := nullif(btrim(pth ->> 'title'), '');
    if ptitle is null then raise exception 'المسار «%» بلا عنوان', slug_ using errcode = 'P0001'; end if;
    plevel := pth ->> 'level';
    if plevel is null or plevel not in ('intro', 'basic', 'advanced') then
      raise exception 'المسار «%»: المستوى مطلوب (intro أو basic أو advanced)', slug_ using errcode = 'P0001';
    end if;
    if (pth ->> 'change_type') is not null and (pth ->> 'change_type') not in (select unnest(enum_range(null::public.change_type))::text) then
      raise exception 'المسار «%»: change_type غير معروف «%»', slug_, pth ->> 'change_type' using errcode = 'P0001';
    end if;
    if jsonb_typeof(pth -> 'exam_questions') is distinct from 'array' or jsonb_array_length(pth -> 'exam_questions') not between 5 and 10 then
      raise exception 'المسار «%»: الامتحان يحتاج من 5 إلى 10 أسئلة (exam_questions)، والموجود %', slug_,
        coalesce(jsonb_array_length(case when jsonb_typeof(pth -> 'exam_questions') = 'array' then pth -> 'exam_questions' end), 0) using errcode = 'P0001';
    end if;
    if jsonb_typeof(pth -> 'steps') is distinct from 'array' or jsonb_array_length(pth -> 'steps') = 0 then
      raise exception 'المسار «%» بلا خطوات', slug_ using errcode = 'P0001';
    end if;

    select id into pid from public.paths where slug = slug_;
    if pid is not null then
      w := w || format('المسار «%s» موجود: لم يُعد إنشاؤه (عدّله من صفحته)', slug_);
      ptitle := null;
    else
      insert into public.paths (slug, change_type, status) values (slug_, nullif(pth ->> 'change_type', '')::public.change_type, 'draft')
      returning id into pid;
      insert into public.path_versions (path_id, title, description, purpose, duration_days, level)
      values (pid, ptitle, nullif(pth ->> 'description', ''), nullif(pth ->> 'purpose', ''),
              nullif(pth ->> 'duration_days', '')::int, plevel::public.path_level)
      returning id into vid;

      k := 0;
      for s in select * from jsonb_array_elements(pth -> 'steps') loop
        k := k + 1;
        if (s ->> 'type') is null or (s ->> 'type') not in ('watch', 'read', 'guidance', 'exercise', 'reflection', 'review') then
          raise exception 'المسار «%»: نوع الخطوة % غير معروف «%»', slug_, k, coalesce(s ->> 'type', '') using errcode = 'P0001';
        end if;
        if nullif(btrim(s ->> 'title'), '') is null then raise exception 'المسار «%»: الخطوة % بلا عنوان', slug_, k using errcode = 'P0001'; end if;
        insert into public.steps (version_id, position, type, title, instructions)
        values (vid, k, (s ->> 'type')::public.step_type, btrim(s ->> 'title'), nullif(s ->> 'instructions', ''))
        returning id into sid;
        i := 0;
        for t in select jsonb_array_elements_text(coalesce(s -> 'materials', '[]')) loop
          i := i + 1;
          select id into mid from public.materials where slug = t;
          if mid is null then raise exception 'المسار «%»: الخطوة % تشير إلى مادة غير معرّفة «%»', slug_, k, t using errcode = 'P0001'; end if;
          insert into public.step_materials (step_id, material_id, position) values (sid, mid, i) on conflict do nothing;
        end loop;
      end loop;
      nsteps := k;

      -- الامتحان آخر خطوة
      insert into public.steps (version_id, position, type, title)
      values (vid, k + 1, 'exam'::public.step_type, 'الامتحان') returning id into sid;
      i := 0;
      for q in select * from jsonb_array_elements(pth -> 'exam_questions') loop
        i := i + 1;
        if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') not between 2 and 5
           or (q ->> 'correct_index') is null or (q ->> 'correct_index')::int not between 0 and jsonb_array_length(q -> 'options') - 1
           or nullif(btrim(q ->> 'prompt'), '') is null then
          raise exception 'المسار «%»: سؤال الامتحان % غير صالح (2 إلى 5 خيارات، وcorrect_index يبدأ من 0)', slug_, i using errcode = 'P0001';
        end if;
        mid := null;
        if nullif(q ->> 'material', '') is not null then
          select id into mid from public.materials where slug = q ->> 'material';
          if mid is null then w := w || format('سؤال الامتحان %s: المادة «%s» غير موجودة، فلن يظهر رابط المراجعة', i, q ->> 'material'); end if;
        end if;
        insert into public.exam_questions (step_id, position, prompt, options, correct_index, explanation, material_id)
        values (sid, i, btrim(q ->> 'prompt'), q -> 'options', (q ->> 'correct_index')::int, nullif(q ->> 'explanation', ''), mid);
        exq := exq + 1;
      end loop;

      for t in select jsonb_array_elements_text(coalesce(pth -> 'needs', '[]')) loop
        select id into nid from public.needs where slug = t;
        if nid is null then raise exception 'المسار «%»: احتياج غير معروف «%»', slug_, t using errcode = 'P0001'; end if;
        insert into public.path_needs (path_id, need_id) values (pid, nid) on conflict do nothing;
      end loop;
      if nullif(pth ->> 'domain', '') is not null then
        select id into did from public.domains where slug = pth ->> 'domain';
        if did is null then raise exception 'المسار «%»: مجال غير معروف «%»', slug_, pth ->> 'domain' using errcode = 'P0001'; end if;
        insert into public.path_domains (path_id, domain_id) values (pid, did) on conflict do nothing;
      end if;

      i := 0;
      for g in select * from jsonb_array_elements(coalesce(pth -> 'suggested_goals', '[]')) loop
        i := i + 1;
        if nullif(btrim(g ->> 'title'), '') is not null then
          insert into public.path_suggested_goals (path_id, title, description, position) values (pid, btrim(g ->> 'title'), nullif(g ->> 'description', ''), i);
        end if;
      end loop;

      i := 0;
      for nx in select * from jsonb_array_elements(coalesce(pth -> 'next_paths', '[]')) loop
        i := i + 1;
        t := nx ->> 'slug';
        if t is null then continue; end if;
        select id into nid from public.paths where slug = t;
        if nid is not null and nid <> pid then
          insert into public.path_next (path_id, next_path_id, position, kind)
          values (pid, nid, i, case when nx ->> 'kind' = 'next_level' then 'next_level' else 'related' end) on conflict do nothing;
        elsif nid is null then
          insert into public.pending_path_links (path_id, next_slug, kind)
          values (pid, t, case when nx ->> 'kind' = 'next_level' then 'next_level' else 'related' end) on conflict do nothing;
          w := w || format('المسار التالي «%s» غير موجود بعد: يُربط حين يُرفع', t);
        end if;
      end loop;

      -- روابط معلّقة كانت تنتظر هذا المسار
      insert into public.path_next (path_id, next_path_id, position, kind)
      select l.path_id, pid, 100, l.kind from public.pending_path_links l where l.next_slug = slug_
      on conflict do nothing;
      delete from public.pending_path_links where next_slug = slug_;

      if nullif(pth ->> 'review_note', '') is not null then
        update public.content_review set internal_note = left(pth ->> 'review_note', 2000), review_status = 'experimental'
         where entity_type = 'path' and entity_id = pid;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'path', case when ptitle is null then null else jsonb_build_object('id', pid, 'slug', pth ->> 'slug', 'title', ptitle, 'level', plevel, 'steps', nsteps) end,
    'materials_new', mats_new, 'materials_updated', mats_upd, 'materials_skipped', mats_skip,
    'questions', qs, 'exam_questions', exq,
    'warnings', to_jsonb(w));
end $$;

-- الواجهة: فحص (الافتراضي) أو رفع
create function public.import_content(p jsonb, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.require_staff();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'الملف ليس JSON صالحًا' using errcode = 'P0001'; end if;
  if not p_dry_run then
    return public.import_content_apply(p) || jsonb_build_object('dry_run', false);
  end if;
  begin
    r := public.import_content_apply(p);
    raise exception 'dry run' using errcode = 'YQ001';
  exception when sqlstate 'YQ001' then
    return r || jsonb_build_object('dry_run', true);
  end;
end $$;

revoke execute on function public.import_content_apply(jsonb), public.import_content(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_content(jsonb, boolean) to authenticated;
