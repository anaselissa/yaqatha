-- ============================================================================
-- اختبارات قاعدة بيانات يَقَظَة: RLS، الإصدارات، التسجيل، الأهداف، البحث، الإدارة.
-- تعمل داخل معاملة وتُلغى في النهاية. أي إخفاق يوقف السكربت برسالة FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

create schema test;
create function test.add_exam(v uuid, n int default 5) returns uuid language plpgsql as $$
declare sid uuid;
begin
  update public.path_versions set level = coalesce(level, 'intro') where id = v;
  insert into public.steps (version_id, position, type, title)
  values (v, (select coalesce(max(position), 0) + 1 from public.steps where version_id = v), 'exam', 'الامتحان') returning id into sid;
  insert into public.exam_questions (step_id, position, prompt, options, correct_index)
  select sid, g, 'سؤال ' || g, '["أ","ب","ج"]'::jsonb, 0 from generate_series(1, n) g;
  return sid;
end $$;
create function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'ok   - %', msg;
  else raise exception 'FAIL - %', msg; end if;
end $$;
create function test.throws(stmt text, msg text, expect text default null) returns void language plpgsql as $$
declare m text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics m = message_text;
    if expect is not null and m not ilike '%' || expect || '%' then
      raise exception 'FAIL - % (wrong error: %)', msg, m;
    end if;
    raise notice 'ok   - % [%]', msg, m;
    return;
  end;
  raise exception 'FAIL - % (expected an error, statement succeeded)', msg;
end $$;
create function test.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
create function test.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;
create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;
create function test.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
grant usage on schema test to anon, authenticated;

\set mgr '11111111-1111-1111-1111-111111111111'
\set edt '22222222-2222-2222-2222-222222222222'
\set ua  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set ub  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

-- ---------- 1. بيانات أولية ----------
insert into auth.users (id, email, email_confirmed_at) values
  (:'mgr', 'mgr@y.test', now()), (:'edt', 'edt@y.test', now()),
  (:'ua', 'ua@y.test', now()),   (:'ub', 'ub@y.test', now());
insert into public.staff_roles (user_id, email, role) values
  (:'mgr', 'mgr@y.test', 'manager'), (:'edt', 'edt@y.test', 'editor');
select test.ok((select count(*) from public.profiles) = 4, 'profile rows created for new users');

-- ---------- 2. الزائر (anon) ----------
select test.as_anon();
select test.ok((select count(*) from public.doors) = 4, 'anon sees the 4 doors');
select test.ok((select count(*) from public.needs) = 0, 'anon sees no draft needs');
select test.ok((select count(*) from public.domains) = 0, 'anon sees no draft domains');
select test.throws('select * from public.goals', 'anon cannot read goals', 'permission denied');
select test.throws('select * from public.enrollments', 'anon cannot read enrollments', 'permission denied');
select test.throws('select * from public.content_review', 'anon cannot read review status', 'permission denied');
select test.throws('select * from public.audit_log', 'anon cannot read audit log', 'permission denied');
select test.throws($$insert into public.materials (slug, title, type) values ('anon-x', 'x', 'article')$$, 'anon cannot insert materials', 'permission denied');
select test.throws($$select * from public.start_path(gen_random_uuid())$$, 'anon cannot call start_path', 'permission denied');
select test.ok((select count(*) from public.search_content('')) = 0, 'empty search returns nothing');
select test.ok((select count(*) from public.search_content($$' & | ! ( ) :* \ $$)) = 0, 'hostile search string is harmless');

-- ---------- 3. المستخدم العادي لا يكتب محتوى ----------
select test.as_user(:'ua');
select test.throws($$insert into public.materials (slug, title, type) values ('ua-x', 'x', 'article')$$, 'regular user cannot insert materials', 'row-level security');
select test.ok(test.affected($$update public.needs set status = 'published'$$) = 0, 'regular user cannot publish needs (0 rows affected)');
select test.throws($$select public.publish_path_version(gen_random_uuid())$$, 'regular user cannot publish versions', 'staff only');

-- ---------- 4. المحرر ينشئ المحتوى ----------
select test.as_user(:'edt');
update public.domains set status = 'published' where slug in ('self-discipline', 'worship');
update public.needs   set status = 'published' where slug in ('anger-control', 'faith-and-certainty');

insert into public.materials (slug, title, description, type, body, source_title, nature)
values ('anger-basics', 'الغَضَب في الإسلام', 'مدخل إلى ضبط الغضب', 'article', 'نص المقال السري عن الغضب', 'كتاب تجريبي', 'original_source')
returning id as m1 \gset
insert into public.materials (slug, title, type, body, source_title)
values ('second-draft', 'مادة ثانية', 'article', 'نص', 'مصدر') returning id as m2 \gset

select test.throws(format($$update public.materials set status = 'published' where id = %L$$, :'m2'),
  'cannot publish a material with no domain/topic/need link', 'link the material');
insert into public.material_needs (material_id, need_id) select :'m1', id from public.needs where slug = 'anger-control';
insert into public.material_needs (material_id, need_id) select :'m2', id from public.needs where slug = 'anger-control';

insert into public.materials (slug, title, type, body) values ('no-source', 'بلا مصدر', 'article', 'نص') returning id as m3 \gset
insert into public.material_needs (material_id, need_id) select :'m3', id from public.needs where slug = 'anger-control';
select test.throws(format($$update public.materials set status = 'published' where id = %L$$, :'m3'),
  'cannot publish a quoted article without a source', 'original source');
insert into public.materials (slug, title, type, body, source_title) values ('video-no-url', 'فيديو', 'video', 'نص', 'مصدر') returning id as m4 \gset
select test.throws(format($$update public.materials set status = 'published' where id = %L$$, :'m4'),
  'cannot publish a video without a url', 'need a url');
select test.throws($$insert into public.materials (slug, title, type, url) values ('bad-url', 'x', 'external_link', 'javascript:alert(1)')$$,
  'non-http urls are rejected');
select test.throws($$insert into public.materials (slug, title, type) values ('Bad Slug', 'x', 'article')$$, 'invalid slug rejected');

update public.materials set status = 'published' where id = :'m1';
select test.ok((select review_status = 'experimental' from public.content_review where entity_id = :'m1'), 'review row auto-created as experimental');

select test.as_anon();
select test.ok((select count(*) from public.materials) = 1, 'anon sees only the published material');
select test.ok((select count(*) from public.material_needs) = 1, 'anon sees links only of published materials');
select test.as_user(:'ub');
select test.ok((select count(*) from public.content_review) = 0, 'non-staff cannot see review status rows');

-- ---------- 5. الحفظ والإخفاء والأثر ----------
select test.as_user(:'ua');
insert into public.saved_materials (material_id) values (:'m1');
insert into public.saved_materials (material_id) values (:'m1') on conflict do nothing;
select test.ok((select count(*) from public.saved_materials) = 1, 'saving twice is idempotent');
select test.throws(format($$insert into public.saved_materials (material_id) values (%L)$$, :'m2'), 'cannot save an unpublished material', 'row-level security');

select test.as_user(:'edt');
select test.ok((select saved_count from public.material_impact(:'m1')) = 1, 'material_impact counts saves');
select test.as_user(:'ua');
select test.throws(format($$select * from public.material_impact(%L)$$, :'m1'), 'users cannot call material_impact', 'staff only');

select test.as_user(:'edt');
update public.materials set status = 'hidden' where id = :'m1';
select test.as_anon();
select test.ok((select count(*) from public.materials where id = :'m1') = 0, 'hidden material invisible to anon');
select test.as_user(:'ua');
select test.ok((select count(*) from public.saved_materials) = 1, 'saved row survives hiding (nothing deleted)');
select test.ok((select count(*) from public.materials where id = :'m1') = 0, '…but the material itself is hidden from the user');
select test.as_user(:'edt');
update public.materials set status = 'published' where id = :'m1';
select test.ok((select count(*) from public.materials where id = :'m1') = 1, 'un-hiding restores visibility');
select test.throws(format($$delete from public.materials where id = %L$$, :'m1'), 'materials cannot be deleted', 'permission denied');

-- تغيير slug
update public.materials set slug = 'anger-in-islam' where id = :'m1';
select test.as_anon();
select test.ok((select entity_id = :'m1' from public.slug_redirects where entity_type = 'material' and old_slug = 'anger-basics'), 'slug change leaves a redirect');
select test.as_user(:'edt');
select test.throws(format($$update public.materials set slug = 'anger-basics' where id = %L$$, :'m2'), 'old slug cannot be reused', 'cannot be reused');

-- ---------- 6. مسار وإصدار 1 ----------
insert into public.paths (slug) values ('anger-7days') returning id as p1 \gset
insert into public.path_versions (path_id, title, description, duration_days)
values (:'p1', 'سبعة أيام لضبط الغضب', 'مسار عملي', 7) returning id as v1 \gset
select test.ok((select version_no = 1 from public.path_versions where id = :'v1'), 'first version gets number 1');
select test.throws(format($$select public.publish_path_version(%L)$$, :'v1'), 'cannot publish a version without steps', 'at least one step');
insert into public.steps (version_id, position, type, title) values (:'v1', 1, 'read', 'اقرأ') returning id as s1, step_key as k1 \gset
insert into public.steps (version_id, position, type, title) values (:'v1', 2, 'exercise', 'طبّق') returning id as s2, step_key as k2 \gset
insert into public.step_materials (step_id, material_id) values (:'s1', :'m1');
insert into public.path_needs (path_id, need_id) select :'p1', id from public.needs where slug = 'anger-control';
select test.throws(format($$update public.path_versions set status = 'published' where id = %L$$, :'v1'), 'versions cannot be published by direct UPDATE', 'permission denied');
select test.add_exam(:'v1') as ex1 \gset
select public.publish_path_version(:'v1');

select test.as_anon();
select test.ok((select count(*) from public.paths_current where slug = 'anger-7days') = 1, 'published path appears in paths_current');
select test.ok((select count(*) from public.steps where version_id = :'v1') = 3, 'anon reads steps of the published version');
select test.ok((select count(*) from public.step_materials) = 1, 'anon reads step materials');

select test.as_user(:'edt');
select test.throws(format($$insert into public.steps (version_id, position, type, title) values (%L, 3, 'read', 'x')$$, :'v1'), 'cannot add steps to a published version', 'cannot be added');
select test.throws(format($$update public.steps set position = 9 where id = %L$$, :'s1'), 'cannot reorder a published version', 'only title');
select test.throws(format($$delete from public.steps where id = %L$$, :'s2'), 'cannot delete steps of a published version', 'cannot be added or removed');
update public.steps set title = 'اقرأ المقال' where id = :'s1';
select test.ok(true, 'minor correction (title) on a published version is allowed');
insert into public.homepage_items (section, path_id) values ('start_here', :'p1');
select test.throws($$insert into public.homepage_items (section) values ('featured_paths')$$, 'homepage item needs a target');

-- ---------- 7. التسجيل والتقدم والأهداف ----------
select test.as_user(:'ua');
select enrollment_id as ea, already_active as dup1 from public.start_path(:'p1') \gset
select enrollment_id as ea_again, already_active as dup2 from public.start_path(:'p1') \gset
select test.ok(not :'dup1'::boolean and :'dup2'::boolean and :'ea' = :'ea_again', 'start_path is idempotent: one active enrollment');
select test.as_user(:'ub');
select enrollment_id as eb from public.start_path(:'p1') \gset
select test.ok((select count(*) from public.enrollments) = 1, 'user B sees only their own enrollment');
select test.throws(format($$select public.set_step_state(%L, %L, 'completed')$$, :'ea', :'s1'), 'user B cannot change user A progress', 'enrollment not found');

select test.as_user(:'ua');
select public.set_step_state(:'ea', :'s1', 'completed');
select test.ok((select completed_steps = 1 and total_steps = 3 and resume_step_id = :'s2' from public.enrollment_progress where enrollment_id = :'ea'), 'progress 1/2 and next step is step 2');
select public.set_step_state(:'ea', :'s1', 'in_progress');
select test.ok((select completed_steps = 0 and resume_step_id = :'s1' from public.enrollment_progress where enrollment_id = :'ea'), 'reopening a step is allowed and resumes there');
select public.set_step_state(:'ea', :'s1', 'completed');
select public.mark_step_opened(:'ea', :'s2');
select test.throws($$update public.enrollments set status = 'archived'$$, 'users cannot write enrollments directly', 'permission denied');
select test.throws(format($$insert into public.enrollment_steps values (%L, %L, %L, 'completed')$$, :'ea', :'v1', :'s1'), 'users cannot write enrollment_steps directly', 'permission denied');

-- أهداف
insert into public.goals (id, title, description) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'أضبط غضبي', 'وصف') returning id as g1 \gset
insert into public.goals (id, title) values (:'g1', 'مكرر') on conflict (id) do nothing;
select test.ok((select count(*) from public.goals) = 1 and (select title from public.goals) = 'أضبط غضبي', 'goal save with client id is idempotent');
select test.throws($$insert into public.goals (title) values ('   ')$$, 'blank goal title rejected');
select test.throws($$update public.goals set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'goal owner cannot be changed', 'permission denied');
insert into public.goal_enrollments (goal_id, enrollment_id) values (:'g1', :'ea');
select test.throws(format($$insert into public.goal_enrollments (goal_id, enrollment_id) values (%L, %L)$$, :'g1', :'eb'), 'cannot link a goal to another user''s enrollment', 'row-level security');
insert into public.goal_materials (goal_id, material_id) values (:'g1', :'m1');
update public.goals set status = 'in_progress' where id = :'g1';
update public.goals set status = 'archived' where id = :'g1';
select test.ok((select status_before_archive = 'in_progress' from public.goals), 'archiving remembers the previous status');
select public.restore_goal(:'g1');
select test.ok((select status = 'in_progress' and status_before_archive is null from public.goals), 'restore returns the previous status');
insert into public.goals (title) select 'bulk ' || g from generate_series(1, 99) g;
select test.throws($$insert into public.goals (title) values ('one too many')$$, 'goal limit of 100 enforced', 'goal limit');
delete from public.goals where title like 'bulk %';

select test.as_user(:'ub');
select test.ok((select count(*) from public.goals) = 0, 'user B cannot see user A goals');
select test.ok(test.affected($$update public.goals set title = 'hacked'$$) = 0, 'user B cannot update user A goals');
select test.ok(test.affected($$delete from public.goals$$) = 0, 'user B cannot delete user A goals');

-- بلاغات
select test.as_user(:'ua');
insert into public.material_reports (material_id, note) values (:'m1', 'الرابط لا يعمل');
select test.as_user(:'ub');
select test.ok((select count(*) from public.material_reports) = 0, 'reports are private to the reporter');
select test.ok(test.affected($$update public.material_reports set status = 'resolved'$$) = 0, 'users cannot resolve reports');
select test.as_user(:'edt');
select test.ok((select count(*) from public.material_reports) = 1, 'staff see reports');

-- ---------- 8. إصدار جديد: ثبات تجربة من بدأ الإصدار 1 ----------
select public.create_draft_version(:'p1') as v2 \gset
select test.ok((select count(*) from public.steps where version_id = :'v2') = 3, 'draft v2 clones the steps');
select test.ok((select count(*) from public.step_materials sm join public.steps s on s.id = sm.step_id where s.version_id = :'v2') = 1, 'draft v2 clones step materials');
select test.throws(format($$select public.create_draft_version(%L)$$, :'p1'), 'only one draft version at a time', 'draft version already exists');
delete from public.steps where version_id = :'v2' and step_key = :'k2';
update public.steps set position = 10 where version_id = :'v2' and type = 'exam';
insert into public.steps (version_id, position, type, title) values (:'v2', 2, 'watch', 'شاهد');
insert into public.steps (version_id, position, type, title) values (:'v2', 3, 'review', 'راجع');
select test.throws(format($$select public.publish_path_version(%L)$$, :'v2'), 'new version needs a changelog', 'changelog is required');
select public.publish_path_version(:'v2', 'أضفنا خطوتين وحذفنا التمرين القديم');

select test.as_super();
select test.ok((select status = 'retired' from public.path_versions where id = :'v1') and (select status = 'published' from public.path_versions where id = :'v2'), 'v1 retired, v2 published');
select test.as_user(:'ua');
select test.ok((select version_id = :'v1' from public.enrollments where id = :'ea'), 'user A stays on v1 after v2 is published');
select test.ok((select completed_steps = 1 and total_steps = 3 from public.enrollment_progress where enrollment_id = :'ea'), 'user A progress unchanged (1/3)');
select test.ok((select count(*) from public.steps where version_id = :'v1') = 3, 'user A can still read their v1 steps');
select test.as_anon();
select test.ok((select count(*) from public.steps where version_id = :'v1') = 0, 'anon cannot read retired v1 steps');
select test.ok((select count(*) from public.steps where version_id = :'v2') = 4, 'anon reads the 4 steps of v2');
select test.ok((select version_no = 2 from public.paths_current where slug = 'anger-7days'), 'paths_current shows v2');

-- ---------- 9. الانتقال إلى الإصدار الجديد ----------
select test.as_user(:'ua');
select test.ok((select count(*) filter (where kind = 'carried') = 2 and count(*) filter (where kind = 'new') = 2 and count(*) filter (where kind = 'removed') = 1 from public.plan_migration(:'ea')), 'migration plan: 2 carried (incl. exam), 2 new, 1 removed');
select public.migrate_enrollment(:'ea') as ea2 \gset
select test.ok(public.migrate_enrollment(:'ea') = :'ea2'::uuid, 'migrate_enrollment is idempotent');
select test.ok((select version_id = :'v2' and status = 'active' and migrated_from = :'ea' from public.enrollments where id = :'ea2'), 'new enrollment is on v2');
select test.ok((select status = 'archived' and archive_reason = 'migrated' from public.enrollments where id = :'ea'), 'old enrollment archived, not deleted');
select test.ok((select completed_steps = 1 and total_steps = 4 from public.enrollment_progress where enrollment_id = :'ea2'), 'carried progress: 1/4 on v2');
select test.ok((select count(*) from public.enrollment_steps where enrollment_id = :'ea') = 1, 'old enrollment progress preserved');
select test.ok((select enrollment_id = :'ea2' from public.goal_enrollments where goal_id = :'g1'), 'goal link moved to the new enrollment');
select test.ok((select already_active and enrollment_id = :'ea2' from public.start_path(:'p1')), 'start_path now returns the migrated enrollment');
select test.throws(format($$select public.set_step_state(%L, %L, 'completed')$$, :'ea', :'s1'), 'archived enrollment is read-only', 'archived');
select test.throws(format($$select public.set_step_state(%L, %L, 'completed')$$, :'ea2', :'s1'), 'cannot set a step from another version', 'does not belong');
select test.as_user(:'ub');
select test.throws(format($$select public.migrate_enrollment(%L)$$, :'ea'), 'user B cannot migrate user A enrollment', 'not found');
select test.ok((select version_id = :'v1' from public.enrollments where id = :'eb'), 'user B unaffected, still on v1');
select public.restart_enrollment(:'eb') as eb2 \gset
select test.ok((select archive_reason = 'restarted' from public.enrollments where id = :'eb') and (select version_id = :'v2' from public.enrollments where id = :'eb2'), 'restart archives the old and starts fresh on latest');
select test.ok((select count(*) from public.enrollment_steps where enrollment_id = :'eb2') = 0, 'restarted enrollment starts empty');

-- ---------- 10. البحث العربي ----------
select test.as_super();
select test.ok(public.normalize_ar('الغَضَبـ إِيمَان ٣ أمة') = 'الغضب ايمان 3 امه', 'normalize_ar: tashkeel, tatweel, hamza, digits, taa marbuta');
update public.needs set status = 'published' where slug = 'faith-and-certainty';
select test.as_anon();
select test.ok(exists (select 1 from public.search_content('غضب') where kind = 'material'), 'search "غضب" finds a title written with tashkeel and "ال"');
select test.ok(exists (select 1 from public.search_content('الغضب') where kind = 'need'), 'search "الغضب" finds the need');
select test.ok(exists (select 1 from public.search_content('غضب') where kind = 'path'), 'search finds the path via its published version');
select test.ok(exists (select 1 from public.search_content('ايمان') where kind = 'need'), 'search "ايمان" finds "إيمان"');
select test.ok(exists (select 1 from public.search_content('اضب') where kind = 'need'), 'prefix search works');
select test.ok(not exists (select 1 from public.search_content('صلاتي')), 'draft needs are not searchable');
select test.ok(not exists (select 1 from public.search_content('ثانية')), 'draft materials are not searchable');
select test.ok(exists (select 1 from public.search_content('السري') where kind = 'material'), 'search also matches the article body');
select test.ok((select count(*) from public.search_content('غضب', 1)) = 1, 'max_results honoured');

-- ---------- 11. سحب إصدار / إيقاف مسار ----------
select test.as_anon();
select test.ok((select count(*) from public.homepage_items) = 1, 'anon sees homepage item of a published path');
select test.as_user(:'edt');
select public.withdraw_version(:'v2', 'خطأ في المحتوى');
select test.as_super();
select test.ok((select status = 'hidden' from public.paths where id = :'p1'), 'withdrawing the published version hides the path from new starts');
select test.as_anon();
select test.ok((select count(*) from public.paths_current) = 0, 'anon no longer sees the path');
select test.ok((select count(*) from public.homepage_items) = 0, 'homepage item disappears with its path');
select test.as_user(:'ua');
select test.ok((select count(*) from public.paths where id = :'p1') = 1, 'enrolled user still sees the path row');
select test.ok((select status = 'withdrawn' from public.path_versions where id = :'v2'), 'enrolled user sees the withdrawn version (for the notice)');
select test.ok((select count(*) from public.steps where version_id = :'v2') = 0, 'withdrawn version steps are hidden from the user');
select test.ok((select count(*) from public.enrollment_steps where enrollment_id = :'ea2') = 1, 'progress is preserved after withdrawal');
select test.throws(format($$select public.set_step_state(%L, %L, 'completed')$$, :'ea2', :'s1'), 'cannot change state on a withdrawn version', 'withdrawn');
select test.as_user(:'ub');
select test.throws(format($$select * from public.start_path(%L)$$, :'p1'), 'cannot start a hidden path', 'not available');

-- ---------- 12. الفريق والدعوات ----------
select test.as_user(:'edt');
select test.ok((select count(*) from public.staff_roles) = 1, 'editor sees only their own staff row');
select test.throws($$insert into public.staff_roles (user_id, email, role) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x@y.test', 'manager')$$, 'editor cannot grant roles', 'row-level security');
select test.throws($$insert into public.staff_invites (email, role) values ('x@y.test', 'editor')$$, 'editor cannot invite', 'row-level security');
select test.ok((select count(*) from public.audit_log) = 0, 'editor cannot read the audit log');
select test.as_user(:'mgr');
select test.ok((select count(*) from public.staff_roles) = 2, 'manager sees the team');
insert into public.staff_invites (email, role) values ('newbie@y.test', 'editor');
select test.throws(format($$delete from public.staff_roles where user_id = %L$$, :'mgr'), 'last manager cannot be deleted', 'last manager');
select test.throws(format($$update public.staff_roles set role = 'editor' where user_id = %L$$, :'mgr'), 'last manager cannot be demoted', 'last manager');
select test.as_super();
insert into auth.users (id, email, email_confirmed_at) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'newbie@y.test', now());
select test.ok((select role = 'editor' from public.staff_roles where email = 'newbie@y.test'), 'invite applied automatically on first login');
select test.ok(not exists (select 1 from public.staff_invites where email = 'newbie@y.test'), 'invite consumed');
insert into public.staff_invites (email, role) values ('late@y.test', 'editor');
insert into auth.users (id, email) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'late@y.test');
select test.ok(not exists (select 1 from public.staff_roles where email = 'late@y.test'), 'invite NOT applied to an unconfirmed email');
update auth.users set email_confirmed_at = now() where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select test.as_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select test.ok(public.claim_staff_invite() = 'editor', 'claim_staff_invite applies the invite after confirmation');

-- ---------- 13. سجل التغييرات ----------
select test.as_user(:'mgr');
select test.ok(exists (select 1 from public.audit_log where entity_type = 'materials' and action = 'update' and details ? 'status'), 'audit logs material status changes');
select test.ok(exists (select 1 from public.audit_log where entity_type = 'path_versions' and details ? 'status'), 'audit logs version publishing');
select test.ok(exists (select 1 from public.audit_log where entity_type = 'steps' and action = 'update'), 'audit logs post-publish step corrections');
select test.ok(not exists (select 1 from public.audit_log where entity_type = 'steps' and action = 'insert'), 'draft step edits are not logged (noise)');
select test.ok(not exists (select 1 from public.audit_log where details::text like '%المقال السري%'), 'audit never stores full body text');
select test.ok(exists (select 1 from public.audit_log where entity_type = 'staff_roles'), 'audit logs role changes');

-- ---------- 14. سلامة البيانات وحذف الحساب ----------
select test.as_super();
select test.throws(format($$insert into public.enrollment_steps values (%L, %L, %L, 'completed')$$, :'eb2', :'v2', :'s1'), 'FK blocks a step from another version', 'foreign key');
select test.throws(format($$update public.enrollments set last_step_id = %L where id = %L$$, :'s1', :'eb2'), 'FK blocks last_step from another version', 'foreign key');
select test.throws(format($$insert into public.enrollments (user_id, path_id, version_id) values (%L, %L, %L)$$, :'ub', :'p1', :'v1'), 'only one active enrollment per user+path', 'duplicate key');

delete from auth.users where id = :'ua';
select test.ok(not exists (select 1 from public.goals where user_id = :'ua')
           and not exists (select 1 from public.enrollments where user_id = :'ua')
           and not exists (select 1 from public.saved_materials where user_id = :'ua')
           and not exists (select 1 from public.profiles where id = :'ua'), 'account deletion removes all personal data');
select test.ok(exists (select 1 from public.material_reports where material_id = :'m1' and reporter_id is null), 'reports are kept anonymised after account deletion');
select test.ok(exists (select 1 from public.materials where id = :'m1'), 'public content untouched by account deletion');
select test.throws(format($$delete from auth.users where id = %L$$, :'mgr'), 'deleting the last manager account is blocked', 'last manager');


-- ---------- 15. حذف المستخدم لحسابه (delete_my_account) ----------
select test.as_anon();
select test.throws($$select public.delete_my_account()$$, 'anon cannot call delete_my_account', 'permission denied');
select test.as_user(:'mgr');
select test.throws($$select public.delete_my_account()$$, 'the last manager cannot delete their own account', 'last manager');
select test.as_user(:'ub');
select public.delete_my_account();
select test.as_super();
select test.ok(not exists (select 1 from auth.users where id = :'ub')
           and not exists (select 1 from public.enrollments where user_id = :'ub')
           and not exists (select 1 from public.profiles where id = :'ub'), 'delete_my_account removes the caller and all their data');
select test.ok(exists (select 1 from auth.users where id = :'edt'), 'other users are untouched');

-- ---------- 16. إعادة ترتيب الخطوات (reorder_steps) ----------
select test.as_user(:'edt');
insert into public.paths (slug) values ('reorder-path') returning id as rp \gset
insert into public.path_versions (path_id, title) values (:'rp', 'مسار للترتيب') returning id as rv \gset
insert into public.steps (version_id, position, type, title) values (:'rv', 1, 'read', 'أ') returning id as ra \gset
insert into public.steps (version_id, position, type, title) values (:'rv', 2, 'read', 'ب') returning id as rb \gset
insert into public.steps (version_id, position, type, title) values (:'rv', 3, 'read', 'ج') returning id as rc \gset
set constraints all immediate;
select test.throws(format($$update public.steps set position = 2 where id = %L$$, :'ra'), 'a lone position swap collides when checked at statement end (why the RPC exists)', 'duplicate key');
set constraints all deferred;
select public.reorder_steps(:'rv', array[:'rc', :'ra', :'rb']::uuid[]);
select test.ok((select string_agg(title, '' order by position) from public.steps where version_id = :'rv') = 'جأب', 'reorder_steps reorders in one transaction');
select test.throws(format($$select public.reorder_steps(%L, array[%L]::uuid[])$$, :'rv', :'ra'), 'list must contain every step', 'exactly once');
select test.throws(format($$select public.reorder_steps(%L, array[%L,%L,%L]::uuid[])$$, :'rv', :'ra', :'ra', :'rb'), 'duplicates rejected', 'exactly once');
select test.throws(format($$select public.reorder_steps(%L, array[%L,%L,%L]::uuid[])$$, :'rv', :'ra', :'rb', gen_random_uuid()), 'foreign step ids rejected', 'exactly once');
select test.as_user(:'ua');
select test.throws(format($$select public.reorder_steps(%L, array[]::uuid[])$$, :'rv'), 'non-staff cannot reorder', 'staff only');
select test.as_user(:'edt');
select test.add_exam(:'rv');
select public.publish_path_version(:'rv');
select test.throws(format($$select public.reorder_steps(%L, array[%L,%L,%L]::uuid[])$$, :'rv', :'ra', :'rb', :'rc'), 'a published version cannot be reordered', 'only a draft');

-- ---------- 17. السلاسل وختام المسار (الهجرة 8) ----------
select test.as_user(:'edt');
insert into public.materials (slug, title, type, url, source_title) values ('ep-one', 'الحلقة 1', 'video', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'قناة') returning id as e1 \gset
insert into public.materials (slug, title, type, url, source_title) values ('ep-two', 'الحلقة 2', 'video', 'https://www.youtube.com/watch?v=bbbbbbbbbbb', 'قناة') returning id as e2 \gset
insert into public.material_needs (material_id, need_id) select m, (select id from public.needs where slug = 'anger-control') from unnest(array[:'e1', :'e2']::uuid[]) m;
update public.materials set status = 'published' where id = :'e1';
insert into public.series (slug, title) values ('test-series', 'سلسلة اختبار') returning id as sr \gset
insert into public.series_items (series_id, material_id, position) values (:'sr', :'e1', 1), (:'sr', :'e2', 2);
select test.as_anon();
select test.ok(not exists (select 1 from public.series where id = :'sr'), 'draft series hidden from visitors');
select test.ok(not exists (select 1 from public.series_items where series_id = :'sr'), 'items of a draft series hidden');
select test.throws($$insert into public.series (slug, title) values ('x-anon', 'x')$$, 'visitor cannot create a series');
select test.as_user(:'ua');
select test.throws($$insert into public.series (slug, title) values ('x-user', 'x')$$, 'plain user cannot create a series');
select test.as_user(:'edt');
update public.series set status = 'published' where id = :'sr';
select test.as_anon();
select test.ok((select count(*) from public.series_items where series_id = :'sr') = 1, 'published series shows published episodes only (draft episode hidden)');
select test.as_user(:'edt');
select test.throws(format($$delete from public.series where id = %L$$, :'sr'), 'series cannot be deleted (hide/archive instead)', 'permission denied');

-- ختام المسار: أهداف مقترحة ومسار تالٍ
insert into public.paths (slug) values ('end-a') returning id as pa \gset
insert into public.paths (slug) values ('end-b') returning id as pb \gset
insert into public.path_versions (path_id, title) values (:'pa', 'مسار أ') returning id as va \gset
insert into public.steps (version_id, position, type, title) values (:'va', 1, 'read', 'خطوة');
insert into public.path_suggested_goals (path_id, title, position) values (:'pa', 'صلاة الفجر في المسجد', 1);
insert into public.path_next (path_id, next_path_id) values (:'pa', :'pb');
select test.throws(format($$insert into public.path_next (path_id, next_path_id) values (%L, %L)$$, :'pa', :'pa'), 'a path cannot be its own next path', 'check');
select test.as_anon();
select test.ok(not exists (select 1 from public.path_suggested_goals where path_id = :'pa'), 'suggested goals of an unpublished path are hidden');
select test.as_user(:'edt');
select test.add_exam(:'va');
select public.publish_path_version(:'va');
select test.as_anon();
select test.ok(exists (select 1 from public.path_suggested_goals where path_id = :'pa'), 'suggested goals visible once the path is published');
select test.ok(not exists (select 1 from public.path_next where path_id = :'pa'), 'an unpublished next path is not suggested');
select test.throws(format($$insert into public.path_suggested_goals (path_id, title) values (%L, 'x')$$, :'pa'), 'visitor cannot add suggested goals');
select test.as_user(:'ua');
select test.ok(test.affected(format($$delete from public.path_next where path_id = %L$$, :'pa')) = 0, 'plain user cannot delete next paths (RLS: zero rows)');
select test.as_super();
select test.ok(exists (select 1 from public.audit_log where entity_type = 'path_suggested_goals'), 'suggested goals are audited');

-- ---------- 18. المتابعة المباشرة والإعدادات وأرقام الأثر (الهجرة 9) ----------
select test.as_super();
\set mt '99999999-0000-4000-8000-000000000001'
insert into auth.users (id, email, email_confirmed_at) values (:'mt', 'Mentor@Y.test', now());
\set uc '99999999-0000-4000-8000-000000000002'
insert into auth.users (id, email, email_confirmed_at) values (:'uc', 'uc@y.test', now());
\set ur '99999999-0000-4000-8000-000000000003'
insert into auth.users (id, email, email_confirmed_at) values (:'ur', 'ur@y.test', now());
select test.as_anon();
select test.ok((select value from public.app_settings where key = 'mentorship_open') = 'true'::jsonb, 'visitors can read public settings');
select test.throws($$update public.app_settings set value = 'false' where key = 'mentorship_open'$$, 'visitor cannot change settings');
select test.throws($$insert into public.mentorship_requests (name, phone, topic, gender) values ('x', '0790000000', 'prayer', 'male')$$, 'visitor cannot submit a request');
select test.as_user(:'ur');
select test.ok(test.affected($$update public.app_settings set value = 'false' where key = 'mentorship_open'$$) = 0, 'plain user cannot change settings (RLS: zero rows)');
insert into public.mentorship_requests (name, phone, topic, gender) values ('أحمد', '+962 79 000 0000', 'prayer', 'male') returning id as rq \gset
select test.ok((select status from public.mentorship_requests where id = :'rq') = 'new', 'request starts as new');
select test.throws($$insert into public.mentorship_requests (name, phone, topic, gender) values ('ثانٍ', '0790000001', 'faith', 'male')$$, 'one open request per user', 'duplicate');
select test.throws($$insert into public.mentorship_requests (name, topic, gender) values ('x', 'faith', 'male')$$, 'a contact method is required', 'check');
select test.throws($$insert into public.mentorship_requests (name, phone, topic, gender) values ('x', 'call me', 'faith', 'male')$$, 'phone format validated', 'check');
select test.ok(test.affected(format($$update public.mentorship_requests set status = 'closed' where id = %L$$, :'rq')) = 0, 'requester cannot change status (RLS: zero rows)');
select test.as_user(:'edt');
select test.ok(not exists (select 1 from public.mentorship_requests where id = :'rq'), 'a content editor cannot see phone numbers');
select test.ok((public.admin_stats() ->> 'requests_new')::int >= 1, 'staff see aggregate stats (counts only)');
select test.ok(not (public.admin_stats() ? 'phone') and jsonb_typeof(public.admin_stats() -> 'paths') = 'array', 'stats carry no identities');
select test.as_user(:'ur');
select test.throws($$select public.admin_stats()$$, 'plain user cannot read stats', 'staff only');
select test.as_user(:'mt');
select test.ok(not public.is_mentor(), 'not a mentor before being added');
select test.as_user(:'mgr');
insert into public.mentors (email) values ('mentor@y.test');
select test.ok(exists (select 1 from public.mentorship_requests where id = :'rq'), 'manager sees all requests');
update public.mentorship_requests set assigned_to = '  Mentor@Y.test ' where id = :'rq';
select test.ok((select assigned_to from public.mentorship_requests where id = :'rq') = 'mentor@y.test', 'assignment normalised to lower-case email');
select test.as_user(:'mt');
select test.ok(public.is_mentor(), 'mentor recognised by verified Google email');
select test.ok(exists (select 1 from public.mentorship_requests where id = :'rq'), 'assigned mentor sees the request');
update public.mentorship_requests set status = 'contacted', staff_note = 'تم الاتصال' where id = :'rq';
select test.ok((select status from public.mentorship_requests where id = :'rq') = 'contacted', 'mentor updates status and note');
select test.throws(format($$update public.mentorship_requests set assigned_to = 'other@y.test' where id = %L$$, :'rq'), 'mentor cannot reassign', 'only a manager');
select test.as_user(:'mgr');
update public.app_settings set value = 'false' where key = 'mentorship_open';
select test.as_user(:'uc');
select test.throws($$insert into public.mentorship_requests (name, phone, topic, gender) values ('x', '0790000002', 'prayer', 'male')$$, 'requests rejected while closed', 'closed');
select test.as_user(:'mgr');
update public.app_settings set value = 'true' where key = 'mentorship_open';
select test.as_user(:'uc');
select test.throws($$insert into public.mentorship_requests (name, phone, topic, gender) values ('x', '0790000002', 'prayer', 'female')$$, 'women section closed by default', 'women section');
select test.as_user(:'ur');
select test.ok(test.affected(format($$delete from public.mentorship_requests where id = %L$$, :'rq')) = 1, 'requester can withdraw (delete) their request');
select test.as_super();
select test.ok(not exists (select 1 from public.audit_log where entity_type = 'mentorship_requests'), 'requests (with phone numbers) are never audited');

-- ---------- 19. أسئلة المواد والنقاط (الهجرة 10) ----------
select test.as_user(:'edt');
insert into public.materials (slug, title, type, body, source_title) values ('quiz-mat', 'مادة بأسئلة', 'article', 'نص', 'كتاب') returning id as qm \gset
insert into public.material_needs (material_id, need_id) values (:'qm', (select id from public.needs where slug = 'anger-control'));
insert into public.material_questions (material_id, prompt, options, correct_index, explanation)
  values (:'qm', 'ما الصواب؟', '["أ","ب","ج"]', 1, 'لأن ب') returning id as qq \gset
select test.throws(format($$insert into public.material_questions (material_id, prompt, options, correct_index) values (%L, 'x', '["أ","ب"]', 2)$$, :'qm'), 'correct index must point to an option', 'check');
select test.as_anon();
select test.ok(not exists (select 1 from public.material_questions where id = :'qq'), 'questions of a draft material are hidden');
select test.as_user(:'edt');
update public.materials set status = 'published' where id = :'qm';
select test.as_anon();
select test.ok(exists (select 1 from public.material_questions where id = :'qq'), 'questions visible with their published material');
select test.throws(format($$insert into public.material_questions (material_id, prompt, options, correct_index) values (%L, 'x', '["أ","ب"]', 0)$$, :'qm'), 'visitor cannot add questions');
select test.as_user(:'ur');
select test.throws(format($$insert into public.quiz_attempts (question_id, chosen_index, correct) values (%L, 0, true)$$, :'qq'), 'client cannot send correctness', 'permission denied');
insert into public.quiz_attempts (question_id, chosen_index) values (:'qq', 0);
select test.ok((select correct from public.quiz_attempts where question_id = :'qq') = false, 'correctness is graded by the database');
select test.throws(format($$insert into public.quiz_attempts (question_id, chosen_index) values (%L, 1)$$, :'qq'), 'first answer counts (no retry farming)', 'duplicate');
select test.throws(format($$insert into public.quiz_attempts (question_id, chosen_index) values (%L, 9)$$, :'qq'), 'out-of-range answer rejected', 'invalid answer');
select test.ok((public.my_progress() ->> 'answered')::int = 1 and (public.my_progress() ->> 'correct_answers')::int = 0, 'my_progress counts own answers');
select test.ok((public.my_progress() ->> 'streak_days')::int >= 1 and (public.my_progress() ->> 'active_today')::boolean, 'answering today starts a streak');
select test.as_user(:'uc');
select test.ok(not exists (select 1 from public.quiz_attempts), 'nobody else sees my answers');
select test.ok((public.my_progress() ->> 'points')::int = 0, 'another user has their own (zero) points');
select test.as_anon();
select test.throws($$select public.my_progress()$$, 'visitors have no progress', 'permission denied');

-- ---------- 20. الأسئلة التعريفية (الهجرة 11) ----------
select test.as_anon();
select test.ok((select count(*) from public.onboarding_questions where branch = 'fix') = 3, 'default onboarding questions are public');
select test.ok((select count(*) from public.onboarding_options where need_id is not null) >= 10, 'default options map to seeded needs');
select test.throws($$insert into public.onboarding_questions (prompt) values ('x')$$, 'visitor cannot add onboarding questions');
select test.as_user(:'edt');
update public.onboarding_questions set status = 'hidden' where position = 3 and branch = 'fix';
select test.as_anon();
select test.ok((select count(*) from public.onboarding_questions where branch = 'fix') = 2, 'hidden question disappears for visitors');
select test.ok(not exists (select 1 from public.onboarding_options o join public.onboarding_questions q on q.id = o.question_id where q.position = 3 and q.branch = 'fix'), 'and its options too');
select test.as_super();
select test.ok(not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name like 'onboarding_answer%'), 'answers are never stored (no table for them)');

-- ---------- 21. فرعا «من أين أبدأ» واحتياج السنن (الهجرة 12) ----------
select test.as_anon();
select test.ok((select count(*) from public.onboarding_questions where branch = 'grow') = 3, 'grow branch has its default questions');
select test.ok((select count(distinct branch) from public.onboarding_questions) = 2, 'both branches exist');
select test.as_super();
select test.ok(exists (select 1 from public.needs where slug = 'revive-sunnah' and door_id = 1 and change_type = 'acquire_good_deed'), 'sunnah need exists under «closer to Allah»');
select test.ok((select status from public.needs where slug = 'revive-sunnah') = 'draft', 'new need starts as draft (published from the panel when it has content)');
select test.ok(exists (select 1 from public.onboarding_options o join public.needs n on n.id = o.need_id where n.slug = 'revive-sunnah'), 'grow options point to the sunnah need');
select public.seed_grow_onboarding();
select test.ok((select count(*) from public.onboarding_questions where branch = 'grow') = 3, 'seeding again adds nothing (idempotent)');
select test.throws($$insert into public.onboarding_questions (branch, prompt) values ('other', 'x')$$, 'unknown branch rejected', 'check');
select test.as_user(:'edt');
insert into public.onboarding_questions (branch, position, prompt) values ('grow', 9, 'سؤال من المحرر');
select test.ok(exists (select 1 from public.onboarding_questions where prompt = 'سؤال من المحرر' and branch = 'grow'), 'editor can add a grow question');
select test.as_anon();
select test.throws($$select public.seed_grow_onboarding()$$, 'visitors cannot run the seeding function', 'permission denied');

-- ---------- 22. الأهداف اليومية، ونوع البلاغ، ومشاركة التقدّم (الهجرة 13) ----------
select test.as_user(:'ur');
insert into public.goals (title, kind, days) values ('الفجر في المسجد', 'daily', 30) returning id as gd \gset
insert into public.goals (title) values ('هدف لمرة واحدة') returning id as go \gset
select test.ok((select kind from public.goals where id = :'go') = 'once', 'old-style goals default to once');
select test.throws($$insert into public.goals (title, kind, days) values ('x', 'once', 5)$$, 'days only for daily goals', 'check');
insert into public.goal_checkins (goal_id, day) values (:'gd', current_date);
select test.ok((select done from public.goal_checkins where goal_id = :'gd' and day = current_date), 'checkin defaults to done');
insert into public.goal_checkins (goal_id, day, done) values (:'gd', current_date, false)
  on conflict (goal_id, day) do update set done = excluded.done;
select test.ok(not (select done from public.goal_checkins where goal_id = :'gd' and day = current_date), 'same day can be changed (upsert)');
select test.throws(format($$insert into public.goal_checkins (goal_id, day) values (%L, current_date - 5)$$, :'gd'), 'far past days rejected', 'out of range');
select test.throws(format($$insert into public.goal_checkins (goal_id, day) values (%L, current_date)$$, :'go'), 'once goals take no checkins', 'only daily');
select test.as_user(:'uc');
select test.ok(not exists (select 1 from public.goal_checkins), 'nobody else sees my checkins');
select test.throws(format($$insert into public.goal_checkins (goal_id, day) values (%L, current_date - 1)$$, :'gd'), 'cannot check in on someone else''s goal');
select test.as_anon();
select test.throws($$select * from public.goal_checkins$$, 'visitors cannot read checkins', 'permission denied');
select test.as_user(:'ur');
delete from public.goals where id = :'gd';
select test.as_super();
select test.ok(not exists (select 1 from public.goal_checkins where goal_id = :'gd'), 'checkins go with their goal');

select test.as_user(:'ur');
insert into public.material_reports (material_id, kind, note) values (:'qm', 'broken_link', null);
select test.throws(format($$insert into public.material_reports (material_id, kind) values (%L, 'spam')$$, :'qm'), 'unknown report kind rejected', 'check');

select test.as_user(:'uc');
insert into public.mentorship_requests (name, phone, topic, gender) values ('سعد', '0790000009', 'prayer', 'male') returning id as rq2 \gset
select public.start_path((select id from public.paths where status = 'published' limit 1));
select test.as_user(:'mgr');
update public.mentorship_requests set assigned_to = 'mentor@y.test' where id = :'rq2';
select test.as_user(:'mt');
select test.ok(public.mentee_progress(:'rq2') is null, 'no sharing by default');
select test.as_user(:'uc');
select test.ok(public.set_share_progress(true), 'user turns sharing on for their open request');
select test.ok(test.affected(format($$update public.mentorship_requests set status = 'closed' where id = %L$$, :'rq2')) = 0, 'still cannot change anything else on the request');
select test.as_user(:'mt');
select test.ok(jsonb_array_length(public.mentee_progress(:'rq2') -> 'paths') >= 1, 'assigned mentor sees progress once shared');
select test.ok(public.mentee_progress(:'rq2') -> 'goals' = 'null'::jsonb, 'goals stay hidden without their own consent');
select test.ok(not (public.mentee_progress(:'rq2') -> 'paths' -> 0 ? 'note') and (public.mentee_progress(:'rq2') -> 'paths' -> 0 ? 'done'), 'progress only: no notes');
select test.as_user(:'edt');
select test.throws(format($$select public.mentee_progress(%L)$$, :'rq2'), 'an editor (not assigned) cannot read it', 'not allowed');
select test.as_user(:'ur');
select test.throws(format($$select public.mentee_progress(%L)$$, :'rq2'), 'another user cannot read it', 'not allowed');
select test.as_user(:'uc');
select public.set_share_progress(false);
select test.as_user(:'mt');
select test.ok(public.mentee_progress(:'rq2') is null, 'turning it off hides it again');
select test.as_anon();
select test.throws(format($$select public.mentee_progress(%L)$$, :'rq2'), 'visitors cannot call it', 'permission denied');

-- ---------- 23. مشاركة العادات اليومية، وحدّ الإرسال (الهجرة 14) ----------
select test.as_user(:'uc');
insert into public.goals (title, kind, days) values ('ورد يومي', 'daily', 30) returning id as gu \gset
insert into public.goal_checkins (goal_id, day) values (:'gu', current_date);
select test.ok(public.set_share_goals(true), 'user turns goal sharing on');
select test.as_user(:'mt');
select test.ok(public.mentee_progress(:'rq2') -> 'paths' = 'null'::jsonb and jsonb_array_length(public.mentee_progress(:'rq2') -> 'goals') = 1, 'goals shared, paths not');
select test.ok((public.mentee_progress(:'rq2') -> 'goals' -> 0 ->> 'done')::int = 1 and not (public.mentee_progress(:'rq2') -> 'goals' -> 0 ? 'description'), 'goal: title and counts only');
select test.as_user(:'uc');
select public.set_share_goals(false);
select test.as_user(:'mt');
select test.ok(public.mentee_progress(:'rq2') is null, 'both off: nothing');
select test.as_user(:'uc');
select test.throws($$select * from public.rate_events$$, 'users cannot read the rate log', 'permission denied');
select test.as_user(:'ur');
do $$ begin for i in 1..12 loop
  begin insert into public.material_reports (material_id, note) select id, 'r' from public.materials where status = 'published' limit 1;
  exception when others then if sqlerrm <> 'rate limited' then raise; end if; end;
end loop; end $$;
select test.as_super();
select test.ok((select count(*) from public.material_reports where reporter_id = :'ur' and created_at > now() - interval '1 hour') <= 10, 'reports capped at 10 an hour');

-- ---------- 24. امتحان آخر المسار (الهجرة 15) ----------
select test.as_user(:'edt');
insert into public.paths (slug) values ('exam-path') returning id as xp \gset
insert into public.path_versions (path_id, title, level) values (:'xp', 'مسار بامتحان', 'basic') returning id as xv \gset
insert into public.steps (version_id, position, type, title) values (:'xv', 1, 'read', 'اقرأ') returning id as xs1 \gset
select test.throws(format($$select public.publish_path_version(%L)$$, :'xv'), 'no exam: cannot publish', 'exactly one exam');
select test.add_exam(:'xv', 4) as xe \gset
select test.throws(format($$select public.publish_path_version(%L)$$, :'xv'), 'fewer than 5 questions: cannot publish', '5 to 10');
insert into public.exam_questions (step_id, position, prompt, options, correct_index) values (:'xe', 5, 'سؤال 5', '["أ","ب"]', 1);
select test.throws(format($$insert into public.exam_questions (step_id, prompt, options, correct_index) values (%L, 'x', '["أ","ب"]', 0)$$, :'xs1'), 'questions only on an exam step', 'exam step only');
update public.steps set position = 9 where id = :'xe';
update public.steps set position = 10 where id = :'xs1';
select test.throws(format($$select public.publish_path_version(%L)$$, :'xv'), 'exam must be last', 'last step');
update public.steps set position = 1 where id = :'xs1';
select public.publish_path_version(:'xv');
select test.throws(format($$delete from public.exam_questions where step_id = %L$$, :'xe'), 'published exam questions cannot be removed', 'only be corrected');
select test.throws(format($$update public.exam_questions set correct_index = 1 where step_id = %L and position = 1$$, :'xe'), 'published answer key cannot change', 'only be corrected');
update public.exam_questions set prompt = 'سؤال 1 (مصحح)' where step_id = :'xe' and position = 1;
select test.ok((select prompt = 'سؤال 1 (مصحح)' from public.exam_questions where step_id = :'xe' and position = 1), 'wording can be corrected after publishing');

select test.as_user(:'uc');
select enrollment_id as xen from public.start_path(:'xp') \gset
select test.ok((select count(*) from public.exam_questions) = 0, 'users cannot read the question table (answers)');
select test.ok((select jsonb_array_length(public.exam_for(:'xen', :'xe') -> 'questions') = 5
                and not (public.exam_for(:'xen', :'xe') -> 'questions' -> 0 ? 'correct_index')
                and (public.exam_for(:'xen', :'xe') ->> 'required')::int = 4), 'exam_for: 5 questions, no answers, 4 required at 70%');
select test.throws(format($$select public.set_step_state(%L, %L, 'completed')$$, :'xen', :'xe'), 'exam step cannot be marked completed by hand', 'exam not passed');
select public.set_step_state(:'xen', :'xe', 'in_progress');
select test.throws(format($$select public.submit_exam(%L, %L, '{}')$$, :'xen', :'xe'), 'every question must be answered', 'answer every question');
select test.ok(not (public.submit_exam(:'xen', :'xe', (select jsonb_object_agg(id, 1) from (select (q ->> 'id') as id from jsonb_array_elements(public.exam_for(:'xen', :'xe') -> 'questions') q) x)) ->> 'passed')::boolean,
  'wrong answers: not passed');
select test.ok((select coalesce(state::text, '') <> 'completed' from public.enrollment_steps where enrollment_id = :'xen' and step_id = :'xe'), 'failed attempt leaves the step open');
select test.ok((public.submit_exam(:'xen', :'xe', (select jsonb_object_agg(id, 0)
               from (select (q ->> 'id') as id from jsonb_array_elements(public.exam_for(:'xen', :'xe') -> 'questions') q) x)) ->> 'score')::int = 4,
  'graded in the database: 4 of 5 (question 5 answer is 1)');
select test.ok((select state = 'completed' from public.enrollment_steps where enrollment_id = :'xen' and step_id = :'xe'), 'passing completes the exam step');
select id as xa from public.exam_attempts where passed limit 1 \gset
select public.exam_result(:'xa') as xr \gset
select test.ok(jsonb_array_length(:'xr'::jsonb -> 'results') = 5 and (:'xr'::jsonb -> 'results' -> 4 ->> 'correct_index')::int = 1 and (:'xr'::jsonb ->> 'score')::int = 4, 'exam_result reviews my attempt with the answer key');
select test.ok((select count(*) from public.exam_attempts) = 2, 'user sees own attempts');
select test.throws($$insert into public.exam_attempts (user_id, enrollment_id, step_id, score, total, passed, answers) values (auth.uid(), gen_random_uuid(), gen_random_uuid(), 5, 5, true, '{}')$$, 'attempts cannot be forged', 'permission denied');
select test.as_user(:'ur');
select test.ok((select count(*) from public.exam_attempts) = 0, 'others cannot see my attempts');
select test.throws(format($$select public.exam_for(%L, %L)$$, :'xen', :'xe'), 'cannot open someone else''s exam', 'not found');
select test.throws(format($$select public.exam_result(%L)$$, :'xa'), 'cannot read someone else''s result', 'not found');

select test.as_user(:'edt');
select public.create_draft_version(:'xp') as xv2 \gset
select test.ok((select count(*) from public.exam_questions q join public.steps s on s.id = q.step_id where s.version_id = :'xv2') = 5, 'new draft copies the exam questions');
select test.as_user(:'mgr');
update public.app_settings set value = '100' where key = 'exam_pass_percent';
select test.as_user(:'uc');
select test.ok((public.exam_for(:'xen', :'xe') ->> 'required')::int = 5, 'pass percent comes from settings');

-- ---------- 25. مستويات المسارات (الهجرة 16) ----------
select test.as_user(:'edt');
insert into public.paths (slug) values ('level-path') returning id as lp \gset
insert into public.path_versions (path_id, title) values (:'lp', 'بلا مستوى') returning id as lv \gset
insert into public.steps (version_id, position, type, title) values (:'lv', 1, 'read', 'اقرأ');
select test.add_exam(:'lv') as lx \gset
update public.path_versions set level = null where id = :'lv';
select test.throws(format($$select public.publish_path_version(%L)$$, :'lv'), 'no level: cannot publish', 'needs a level');
update public.path_versions set level = 'advanced' where id = :'lv';
select public.publish_path_version(:'lv');
update public.path_versions set level = 'basic' where id = :'lv';
select test.ok((select level = 'basic' from public.path_versions where id = :'lv'), 'level can be adjusted after publishing');
select public.create_draft_version(:'lp') as lv2 \gset
select test.ok((select level = 'basic' from public.path_versions where id = :'lv2'), 'new draft copies the level');
insert into public.path_next (path_id, next_path_id, kind) values (:'lp', :'xp', 'next_level');
select test.throws(format($$insert into public.path_next (path_id, next_path_id, kind) values (%L, %L, 'other')$$, :'xp', :'lp'), 'path_next kind is constrained', 'check');
select test.as_anon();
select test.ok((select level = 'basic' from public.path_versions where id = :'lv'), 'visitors read the level');
select test.ok((select kind = 'next_level' from public.path_next where path_id = :'lp'), 'visitors read the link kind');
select test.as_user(:'uc');
update public.path_versions set level = 'intro' where id = :'lv';
select test.ok((select level = 'basic' from public.path_versions where id = :'lv'), 'users cannot change levels');

-- ---------- 26. رفع المحتوى بالجملة (الهجرة 17) ----------
select test.as_user(:'edt');
select $j${
  "format": "yaqatha-content/1",
  "path": { "slug": "imp-fajr", "title": "الفجر المستورد", "level": "intro", "change_type": "perform_duty", "duration_days": 3,
    "needs": ["prayer-consistency"], "domain": "worship",
    "steps": [ { "type": "read", "title": "اقرأ", "materials": ["imp-why"] }, { "type": "exercise", "title": "طبّق", "materials": ["imp-how"] } ],
    "exam_questions": [
      {"prompt":"س1","options":["أ","ب"],"correct_index":0,"material":"imp-why"},{"prompt":"س2","options":["أ","ب"],"correct_index":1},
      {"prompt":"س3","options":["أ","ب"],"correct_index":0},{"prompt":"س4","options":["أ","ب"],"correct_index":0},{"prompt":"س5","options":["أ","ب","ج"],"correct_index":2}],
    "suggested_goals": [{"title":"الفجر 7 أيام"}],
    "next_paths": [{"slug":"imp-next","kind":"next_level"}],
    "review_note": "راجع الحديث الثاني" },
  "materials": [
    {"slug":"imp-why","title":"لماذا","type":"article","body":"نص","needs":["prayer-consistency"],"domain":"worship",
     "questions":[{"prompt":"ق","options":["x","y"],"correct_index":0}], "review_note":"تحقق من التخريج"},
    {"slug":"imp-how","title":"كيف","type":"exercise","body":"نص"} ]
}$j$ as imp \gset
select public.import_content(:'imp'::jsonb) as dry \gset
select test.ok((:'dry'::jsonb ->> 'dry_run')::boolean and (:'dry'::jsonb ->> 'materials_new')::int = 2 and (:'dry'::jsonb ->> 'exam_questions')::int = 5
               and (:'dry'::jsonb -> 'path' ->> 'steps')::int = 2, 'dry run reports the real result');
select test.ok((select count(*) from public.materials where slug like 'imp-%') = 0 and (select count(*) from public.paths where slug = 'imp-fajr') = 0, 'dry run changes nothing');
select public.import_content(:'imp'::jsonb, false) as res \gset
select test.ok((select status = 'draft' from public.paths where slug = 'imp-fajr')
               and (select bool_and(status = 'draft') from public.materials where slug like 'imp-%'), 'everything lands as draft');
select test.ok((select string_agg(s.type::text, ',' order by s.position) from public.steps s join public.path_versions v on v.id = s.version_id join public.paths p on p.id = v.path_id where p.slug = 'imp-fajr') = 'read,exercise,exam', 'exam appended as the last step');
select test.ok((select level = 'intro' from public.path_versions v join public.paths p on p.id = v.path_id where p.slug = 'imp-fajr'), 'level imported');
select test.ok((select internal_note = 'تحقق من التخريج' from public.content_review cr join public.materials m on m.id = cr.entity_id where m.slug = 'imp-why'), 'review note kept for the reviewer');
select test.ok((select count(*) from public.pending_path_links) = 1, 'unknown next path is kept pending');
select public.import_content(:'imp'::jsonb, false) as res2 \gset
select test.ok((:'res2'::jsonb ->> 'materials_updated')::int = 2 and :'res2'::jsonb -> 'path' = 'null'::jsonb, 're-import updates draft materials and leaves the existing path');
select test.throws($$select public.import_content('{"format":"yaqatha-content/1","path":{"slug":"imp-bad","title":"x","level":"intro","steps":[{"type":"read","title":"a","materials":["nope"]}],"exam_questions":[{"prompt":"1","options":["a","b"],"correct_index":0},{"prompt":"2","options":["a","b"],"correct_index":0},{"prompt":"3","options":["a","b"],"correct_index":0},{"prompt":"4","options":["a","b"],"correct_index":0},{"prompt":"5","options":["a","b"],"correct_index":0}]},"materials":[{"slug":"imp-orphan","title":"y","type":"article"}]}', false)$$,
  'a file with an error imports nothing', 'غير معرّفة');
select test.ok((select count(*) from public.materials where slug = 'imp-orphan') = 0, 'all or nothing per file');
select test.throws($$select public.import_content('{"format":"yaqatha-content/1","path":{"slug":"imp-x","title":"x","level":"intro","steps":[{"type":"read","title":"a"}],"exam_questions":[]}}')$$, 'exam questions required', '5 إلى 10');
select test.as_user(:'uc');
select test.throws($$select public.import_content('{}')$$, 'users cannot import', 'staff');

select 'ALL TESTS PASSED' as result;
rollback;
