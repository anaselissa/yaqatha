-- ============================================================================
-- يَقَظَة — الهجرة 4: الدوال المساعدة والمشغّلات والإجراءات (RPC) والبحث والعروض
-- ============================================================================

-- ---------- مساعدات الصلاحيات ----------
create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_roles where user_id = auth.uid())
$$;

create function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_roles where user_id = auth.uid() and role = 'manager')
$$;

create function public.require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
end $$;

create function public.require_user() returns uuid
language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return u;
end $$;

-- هل للمستخدم الحالي تسجيل في هذا المسار/الإصدار؟ (دالة مستقلة كي لا يحتاج الزائر صلاحية على enrollments)
create function public.has_enrollment_in_path(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.path_id = p_id and e.user_id = auth.uid())
$$;

create function public.has_enrollment_in_version(v_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.version_id = v_id and e.user_id = auth.uid())
$$;

-- إصدار قابل للقراءة: عام (منشور ومساره منشور) أو للمسجَّل فيه (ما لم يُسحب) أو للفريق
create function public.can_read_version(v_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.path_versions v
      join public.paths p on p.id = v.path_id
     where v.id = v_id
       and ( public.is_staff()
          or (v.status = 'published' and p.status = 'published')
          or (v.status <> 'withdrawn' and exists (
                select 1 from public.enrollments e
                 where e.version_id = v.id and e.user_id = auth.uid())) )
  )
$$;

create function public.can_read_step(s_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_read_version((select version_id from public.steps where id = s_id))
$$;

-- ---------- المشغّلات العامة ----------
create trigger domains_touch   before update on public.domains   for each row execute function public.set_updated_at();
create trigger topics_touch    before update on public.topics    for each row execute function public.set_updated_at();
create trigger needs_touch     before update on public.needs     for each row execute function public.set_updated_at();
create trigger materials_touch before update on public.materials for each row execute function public.set_updated_at();
create trigger paths_touch     before update on public.paths     for each row execute function public.set_updated_at();
create trigger versions_touch  before update on public.path_versions for each row execute function public.set_updated_at();
create trigger steps_touch     before update on public.steps     for each row execute function public.set_updated_at();
create trigger goals_touch     before update on public.goals     for each row execute function public.set_updated_at();
create trigger review_touch    before update on public.content_review for each row execute function public.set_updated_at();

-- ---------- الروابط: منع إعادة استخدام slug وتسجيل التحويلات (R1) ----------
create function public.slug_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare et text := tg_argv[0];
begin
  if exists (select 1 from public.slug_redirects r
              where r.entity_type = et and r.old_slug = new.slug and r.entity_id <> new.id) then
    raise exception 'slug "%" was used before by another item and cannot be reused', new.slug
      using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and new.slug <> old.slug then
    insert into public.slug_redirects (entity_type, old_slug, entity_id)
    values (et, old.slug, new.id)
    on conflict (entity_type, old_slug) do update set entity_id = excluded.entity_id;
    delete from public.slug_redirects where entity_type = et and old_slug = new.slug;
  end if;
  return new;
end $$;

create trigger domains_slug   before insert or update of slug on public.domains   for each row execute function public.slug_guard('domain');
create trigger topics_slug    before insert or update of slug on public.topics    for each row execute function public.slug_guard('topic');
create trigger needs_slug     before insert or update of slug on public.needs     for each row execute function public.slug_guard('need');
create trigger materials_slug before insert or update of slug on public.materials for each row execute function public.slug_guard('material');
create trigger paths_slug     before insert or update of slug on public.paths     for each row execute function public.slug_guard('path');

-- ---------- المواد: شروط النشر ----------
create function public.materials_publish_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if nullif(btrim(coalesce(new.body, '')), '') is null and nullif(btrim(coalesce(new.url, '')), '') is null then
      raise exception 'material needs a body or a url before publishing' using errcode = 'P0001';
    end if;
    if new.type in ('video', 'external_link') and nullif(btrim(coalesce(new.url, '')), '') is null then
      raise exception 'video and external_link materials need a url' using errcode = 'P0001';
    end if;
    -- المصدر الأصلي مطلوب، إلا لما ألّفه فريق يقظة نفسه (توجيه/تمرين/سؤال تفكير)
    if not ( new.source_title is not null or new.source_url is not null
             or (new.nature = 'yaqatha_summary' and new.type in ('guidance', 'exercise', 'reflection')) ) then
      raise exception 'original source (source_title or source_url) is required before publishing' using errcode = 'P0001';
    end if;
    if not (exists (select 1 from public.material_domains where material_id = new.id)
         or exists (select 1 from public.material_topics  where material_id = new.id)
         or exists (select 1 from public.material_needs   where material_id = new.id)) then
      raise exception 'link the material to at least one domain, topic or need before publishing' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger materials_gate before insert or update of status on public.materials
  for each row execute function public.materials_publish_gate();

-- صف مراجعة تلقائي لكل مادة ومسار جديد
create function public.content_review_init() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.content_review (entity_type, entity_id) values (tg_argv[0], new.id)
  on conflict do nothing;
  return new;
end $$;
create trigger materials_review_init after insert on public.materials for each row execute function public.content_review_init('material');
create trigger paths_review_init     after insert on public.paths     for each row execute function public.content_review_init('path');

-- ---------- إصدارات المسارات ----------
create function public.path_versions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(max(version_no), 0) + 1 into new.version_no
    from public.path_versions where path_id = new.path_id;
  if new.status <> 'draft' then
    raise exception 'new versions start as draft' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger path_versions_ins before insert on public.path_versions
  for each row execute function public.path_versions_before_insert();

create function public.path_versions_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and
     (new.version_no <> old.version_no or new.path_id <> old.path_id
      or new.duration_days is distinct from old.duration_days) then
    raise exception 'a published version is immutable (version_no, path_id, duration_days)' using errcode = 'P0001';
  end if;
  if new.status <> old.status
     and (old.status::text || '>' || new.status::text) not in
         ('draft>published', 'published>retired', 'published>withdrawn', 'retired>withdrawn', 'withdrawn>retired') then
    raise exception 'illegal version status transition % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger path_versions_upd before update on public.path_versions
  for each row execute function public.path_versions_guard();

-- الخطوات: بنية الإصدار غير المسودة مجمّدة؛ يُسمح فقط بتصحيح نص العنوان والتعليمات (تصحيح طفيف)
create function public.steps_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare vs public.version_status;
begin
  select status into vs from public.path_versions
   where id = case when tg_op = 'INSERT' then new.version_id else old.version_id end;
  if vs is null or vs = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'steps of a non-draft version cannot be added or removed; create a new version' using errcode = 'P0001';
  end if;
  if new.version_id <> old.version_id or new.step_key <> old.step_key
     or new.position <> old.position or new.type <> old.type then
    raise exception 'only title/instructions may be corrected on a non-draft version' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger steps_guard_trg before insert or update or delete on public.steps
  for each row execute function public.steps_guard();

create function public.step_materials_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare vs public.version_status; sid uuid;
begin
  sid := case when tg_op = 'INSERT' then new.step_id else old.step_id end;
  select v.status into vs from public.steps s join public.path_versions v on v.id = s.version_id where s.id = sid;
  if vs is null or vs = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'DELETE') or new.step_id <> old.step_id or new.position <> old.position then
    raise exception 'step materials of a non-draft version may only be swapped, not added or removed' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger step_materials_guard_trg before insert or update or delete on public.step_materials
  for each row execute function public.step_materials_guard();

-- ---------- الأهداف ----------
create function public.goals_before() returns trigger
language plpgsql as $$
declare n int;
begin
  if tg_op = 'INSERT' then
    select count(*) into n from public.goals where user_id = new.user_id;
    if n >= 100 then
      raise exception 'goal limit reached (100)' using errcode = 'P0001';
    end if;
  else
    if new.status = 'archived' and old.status <> 'archived' then
      new.status_before_archive := old.status;
    elsif old.status = 'archived' and new.status <> 'archived' then
      new.status_before_archive := null;
    end if;
  end if;
  return new;
end $$;
create trigger goals_before_ins before insert on public.goals for each row execute function public.goals_before();
create trigger goals_before_upd before update of status on public.goals for each row execute function public.goals_before();

create function public.restore_goal(p_goal_id uuid) returns void
language plpgsql as $$
begin
  perform public.require_user();
  update public.goals
     set status = coalesce(status_before_archive, 'not_started')
   where id = p_goal_id and user_id = auth.uid() and status = 'archived';
  if not found then
    raise exception 'archived goal not found' using errcode = 'P0002';
  end if;
end $$;

-- ---------- الفريق ----------
create function public.protect_last_manager() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'manager' and (tg_op = 'DELETE' or new.role <> 'manager')
     and not exists (select 1 from public.staff_roles where role = 'manager' and user_id <> old.user_id) then
    raise exception 'cannot remove or demote the last manager' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger staff_last_manager before update or delete on public.staff_roles
  for each row execute function public.protect_last_manager();

create function public.apply_staff_invite(p_user uuid) returns public.app_role
language plpgsql security definer set search_path = public as $$
declare u record; inv record;
begin
  select id, lower(email) as email, email_confirmed_at into u from auth.users where id = p_user;
  if not found or u.email_confirmed_at is null then return null; end if;
  select * into inv from public.staff_invites where email = u.email;
  if not found then
    return (select role from public.staff_roles where user_id = u.id);
  end if;
  insert into public.staff_roles (user_id, email, role, added_by)
  values (u.id, u.email, inv.role, inv.invited_by)
  on conflict (user_id) do nothing;
  delete from public.staff_invites where email = u.email;
  return inv.role;
end $$;

create function public.claim_staff_invite() returns public.app_role
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return public.apply_staff_invite(auth.uid());
end $$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict do nothing;
  perform public.apply_staff_invite(new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- سجل التغييرات (R15) ----------
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; o jsonb; d jsonb; vstatus public.version_status; txt boolean := false;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  -- خطوات الإصدارات المسودة لا تُسجَّل (ضجيج)؛ تُسجَّل تصحيحات ما بعد النشر
  if tg_table_name in ('steps', 'step_materials') then
    select v.status into vstatus
      from public.path_versions v
     where v.id = case tg_table_name
                    when 'steps' then (r ->> 'version_id')::uuid
                    else (select s.version_id from public.steps s where s.id = (r ->> 'step_id')::uuid)
                  end;
    if vstatus is null or vstatus = 'draft' then return null; end if;
  end if;

  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    txt := (o -> 'body' is distinct from r -> 'body') or (o -> 'instructions' is distinct from r -> 'instructions');
    o := o - 'search_tsv' - 'updated_at' - 'body' - 'instructions';
    r := r - 'search_tsv' - 'updated_at' - 'body' - 'instructions';
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o -> n.key, 'new', n.value)), '{}'::jsonb)
      into d
      from jsonb_each(r) n
     where (o -> n.key) is distinct from n.value;
    if txt then d := d || '{"text_changed": true}'::jsonb; end if;
    if d = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then
    d := jsonb_build_object('new', r - 'search_tsv' - 'body' - 'instructions');
  else
    d := jsonb_build_object('old', r - 'search_tsv' - 'body' - 'instructions');
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'user_id', r ->> 'entity_id', r ->> 'email', r ->> 'step_id'), d);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['doors', 'domains', 'topics', 'needs', 'materials', 'paths', 'path_versions',
                           'steps', 'step_materials', 'homepage_items', 'staff_roles', 'staff_invites', 'content_review']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------- إدارة الإصدارات (للفريق فقط؛ حالة الإصدار لا تُعدَّل مباشرة) ----------
create function public.create_draft_version(p_path_id uuid) returns uuid
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

  return nid;
end $$;

create function public.publish_path_version(p_version_id uuid, p_changelog text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.path_versions; cl text;
begin
  perform public.require_staff();
  select * into v from public.path_versions where id = p_version_id for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'only a draft version can be published' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.steps where version_id = v.id) then
    raise exception 'a path version needs at least one step' using errcode = 'P0001';
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

create function public.withdraw_version(p_version_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.path_versions;
begin
  perform public.require_staff();
  select * into v from public.path_versions where id = p_version_id for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.status not in ('published', 'retired') then
    raise exception 'only a published or retired version can be withdrawn' using errcode = 'P0001';
  end if;
  update public.path_versions set status = 'withdrawn', withdrawn_note = p_note where id = v.id;
  if v.status = 'published' then
    update public.paths set status = 'hidden' where id = v.path_id and status = 'published';
  end if;
end $$;

-- أثر إخفاء مادة: أعداد فقط بلا هويات (A2)
create function public.material_impact(p_material_id uuid)
returns table (steps_count bigint, paths_count bigint, saved_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff();
  return query
    select (select count(*) from public.step_materials sm
              join public.steps s on s.id = sm.step_id
              join public.path_versions v on v.id = s.version_id
             where sm.material_id = p_material_id and v.status <> 'draft'),
           (select count(distinct v.path_id) from public.step_materials sm
              join public.steps s on s.id = sm.step_id
              join public.path_versions v on v.id = s.version_id
             where sm.material_id = p_material_id and v.status <> 'draft'),
           (select count(*) from public.saved_materials where material_id = p_material_id);
end $$;

-- ---------- تسجيل المستخدم في المسارات ----------
create function public.start_path(p_path_id uuid)
returns table (enrollment_id uuid, already_active boolean)
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); vid uuid; eid uuid;
begin
  select v.id into vid
    from public.path_versions v join public.paths p on p.id = v.path_id
   where v.path_id = p_path_id and v.status = 'published' and p.status = 'published';
  if vid is null then
    raise exception 'path is not available' using errcode = 'P0002';
  end if;

  insert into public.enrollments (user_id, path_id, version_id)
  values (uid, p_path_id, vid)
  on conflict (user_id, path_id) where status = 'active' do nothing
  returning id into eid;

  if eid is not null then
    return query select eid, false;
  else
    return query select e.id, true from public.enrollments e
                  where e.user_id = uid and e.path_id = p_path_id and e.status = 'active';
  end if;
end $$;

create function public.set_step_state(p_enrollment_id uuid, p_step_id uuid, p_state public.step_state)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); e public.enrollments; vs public.version_status;
begin
  select * into e from public.enrollments where id = p_enrollment_id and user_id = uid;
  if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
  if e.status <> 'active' then raise exception 'enrollment is archived' using errcode = 'P0001'; end if;
  select status into vs from public.path_versions where id = e.version_id;
  if vs = 'withdrawn' then raise exception 'this version was withdrawn' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.steps where id = p_step_id and version_id = e.version_id) then
    raise exception 'step does not belong to this enrollment' using errcode = 'P0002';
  end if;

  insert into public.enrollment_steps (enrollment_id, version_id, step_id, state)
  values (e.id, e.version_id, p_step_id, p_state)
  on conflict (enrollment_id, step_id) do update set state = excluded.state, updated_at = now();

  update public.enrollments set last_step_id = p_step_id where id = e.id;
end $$;

create function public.mark_step_opened(p_enrollment_id uuid, p_step_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  update public.enrollments e set last_step_id = p_step_id
   where e.id = p_enrollment_id and e.user_id = uid and e.status = 'active'
     and exists (select 1 from public.steps s where s.id = p_step_id and s.version_id = e.version_id);
  if not found then raise exception 'enrollment or step not found' using errcode = 'P0002'; end if;
end $$;

create function public.archive_enrollment(p_enrollment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  update public.enrollments set status = 'archived', archived_at = now(), archive_reason = 'user'
   where id = p_enrollment_id and user_id = uid and status = 'active';
  if not found then raise exception 'active enrollment not found' using errcode = 'P0002'; end if;
end $$;

-- معاينة الانتقال: ما سيُنقل وما هو جديد وما سيُزال (F10)
create function public.plan_migration(p_enrollment_id uuid)
returns table (step_key uuid, kind text, title text, "position" int, state public.step_state)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_user(); e public.enrollments; tv public.path_versions;
begin
  select * into e from public.enrollments where id = p_enrollment_id and user_id = uid;
  if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
  select v.* into tv from public.path_versions v join public.paths p on p.id = v.path_id
   where v.path_id = e.path_id and v.status = 'published' and p.status in ('published', 'hidden');
  if not found then raise exception 'no published version available' using errcode = 'P0002'; end if;

  return query
    select coalesce(ns.step_key, os.step_key),
           case when ns.id is not null and os.id is not null then 'carried'
                when ns.id is not null then 'new' else 'removed' end,
           coalesce(ns.title, os.title),
           coalesce(ns.position, os.position),
           case when os.id is not null then coalesce(es.state, 'not_started'::public.step_state)
                else 'not_started'::public.step_state end
      from (select * from public.steps where version_id = e.version_id) os
      full join (select * from public.steps where version_id = tv.id) ns on ns.step_key = os.step_key
      left join public.enrollment_steps es on es.enrollment_id = e.id and es.step_id = os.id
     order by 4;
end $$;

create function public.migrate_enrollment(p_enrollment_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); e public.enrollments; tv public.path_versions;
        old_no int; nid uuid; new_last uuid;
begin
  select * into e from public.enrollments where id = p_enrollment_id and user_id = uid for update;
  if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;

  if e.status = 'archived' then          -- تنفيذ متكافئ: أعد التسجيل البديل إن وُجد
    select id into nid from public.enrollments where migrated_from = e.id;
    if nid is not null then return nid; end if;
    raise exception 'enrollment is archived' using errcode = 'P0001';
  end if;

  select v.* into tv from public.path_versions v join public.paths p on p.id = v.path_id
   where v.path_id = e.path_id and v.status = 'published' and p.status in ('published', 'hidden');
  if not found then raise exception 'no published version available' using errcode = 'P0002'; end if;
  select version_no into old_no from public.path_versions where id = e.version_id;
  if tv.version_no <= old_no then raise exception 'already on the latest version' using errcode = 'P0001'; end if;

  select ns.id into new_last
    from public.steps os join public.steps ns on ns.version_id = tv.id and ns.step_key = os.step_key
   where os.id = e.last_step_id;

  -- أرشفة القديم أولًا (الفهرس الفريد على التسجيل النشط)، ثم إنشاء الجديد، كل ذلك ذرّيًا
  update public.enrollments set status = 'archived', archived_at = now(), archive_reason = 'migrated'
   where id = e.id;

  insert into public.enrollments (user_id, path_id, version_id, migrated_from, last_step_id)
  values (uid, e.path_id, tv.id, e.id, new_last) returning id into nid;

  insert into public.enrollment_steps (enrollment_id, version_id, step_id, state)
  select nid, tv.id, ns.id, es.state
    from public.enrollment_steps es
    join public.steps os on os.id = es.step_id
    join public.steps ns on ns.version_id = tv.id and ns.step_key = os.step_key
   where es.enrollment_id = e.id;

  update public.goal_enrollments set enrollment_id = nid where enrollment_id = e.id;
  return nid;
end $$;

create function public.restart_enrollment(p_enrollment_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user(); e public.enrollments; vid uuid; nid uuid;
begin
  select * into e from public.enrollments where id = p_enrollment_id and user_id = uid for update;
  if not found then raise exception 'enrollment not found' using errcode = 'P0002'; end if;
  if e.status <> 'active' then raise exception 'enrollment is archived' using errcode = 'P0001'; end if;

  select v.id into vid from public.path_versions v join public.paths p on p.id = v.path_id
   where v.path_id = e.path_id and v.status = 'published' and p.status = 'published';
  if vid is null then raise exception 'path is not available' using errcode = 'P0002'; end if;

  update public.enrollments set status = 'archived', archived_at = now(), archive_reason = 'restarted'
   where id = e.id;
  insert into public.enrollments (user_id, path_id, version_id) values (uid, e.path_id, vid) returning id into nid;
  update public.goal_enrollments set enrollment_id = nid where enrollment_id = e.id;
  return nid;
end $$;

-- ---------- العروض ----------
create view public.paths_current with (security_invoker = true) as
select p.id as path_id, p.slug, p.change_type,
       v.id as version_id, v.version_no, v.title, v.description, v.purpose,
       v.duration_days, v.published_at
  from public.paths p
  join public.path_versions v on v.path_id = p.id and v.status = 'published'
 where p.status = 'published';

-- التقدم: الإجمالي والمكتمل والخطوة التالية (آخر خطوة فُتحت إن لم تكتمل، وإلا أول غير مكتملة)
create view public.enrollment_progress with (security_invoker = true) as
select e.id as enrollment_id,
       (select count(*) from public.steps s where s.version_id = e.version_id) as total_steps,
       (select count(*) from public.enrollment_steps es
         where es.enrollment_id = e.id and es.state = 'completed') as completed_steps,
       (select s.id
          from public.steps s
          left join public.enrollment_steps es on es.step_id = s.id and es.enrollment_id = e.id
         where s.version_id = e.version_id and coalesce(es.state, 'not_started') <> 'completed'
         order by (s.id = e.last_step_id) desc, s.position
         limit 1) as resume_step_id
  from public.enrollments e;

-- ---------- البحث العربي العام (يعرض المنشور فقط) ----------
create function public.search_content(q text, max_results int default 30)
returns table (kind text, id uuid, slug text, title text, description text, rank real)
language sql stable as $$
  with words as (
    select w
      from regexp_split_to_table(
             btrim(regexp_replace(public.search_norm(q), '[^[:alnum:]]+', ' ', 'g')), ' ') w
     where w <> ''
     limit 8
  ),
  tq as (select to_tsquery('simple', string_agg(w || ':*', ' & ')) as t from words)
  select * from (
    select 'need'::text, n.id, n.slug, n.title, n.description, ts_rank(n.search_tsv, tq.t)
      from public.needs n, tq where n.status = 'published' and n.search_tsv @@ tq.t
    union all
    select 'topic', tp.id, tp.slug, tp.title, tp.description, ts_rank(tp.search_tsv, tq.t)
      from public.topics tp, tq where tp.status = 'published' and tp.search_tsv @@ tq.t
    union all
    select 'path', p.id, p.slug, v.title, v.description, ts_rank(v.search_tsv, tq.t)
      from public.paths p
      join public.path_versions v on v.path_id = p.id and v.status = 'published', tq
     where p.status = 'published' and v.search_tsv @@ tq.t
    union all
    select 'material', m.id, m.slug, m.title, m.description, ts_rank(m.search_tsv, tq.t)
      from public.materials m, tq where m.status = 'published' and m.search_tsv @@ tq.t
  ) r(kind, id, slug, title, description, rank)
  order by rank desc, title
  limit least(greatest(max_results, 1), 50)
$$;
