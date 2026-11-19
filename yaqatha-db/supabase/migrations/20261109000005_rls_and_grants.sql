-- ============================================================================
-- يَقَظَة — الهجرة 5: سياسات RLS والصلاحيات
-- المبدأ: لا شيء مسموح إلا بمنح صريح. الكتابة على بيانات المستخدم الحساسة عبر RPC فقط.
-- ============================================================================

-- 1) إزالة كل منح سابقة (وتلك التي تضيفها Supabase افتراضيًا)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- 2) تفعيل RLS على كل الجداول
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================================
-- المحتوى العام: المنشور للجميع، والكل للفريق
-- ============================================================================
create policy doors_read on public.doors for select to anon, authenticated using (true);
create policy doors_write on public.doors for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create policy domains_read on public.domains for select to anon, authenticated
  using (status = 'published' or (select public.is_staff()));
create policy domains_write on public.domains for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy topics_read on public.topics for select to anon, authenticated
  using (status = 'published' or (select public.is_staff()));
create policy topics_write on public.topics for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy needs_read on public.needs for select to anon, authenticated
  using (status = 'published' or (select public.is_staff()));
create policy needs_write on public.needs for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy need_topics_read on public.need_topics for select to anon, authenticated
  using (exists (select 1 from public.needs n where n.id = need_id and (n.status = 'published' or (select public.is_staff()))));
create policy need_topics_write on public.need_topics for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy materials_read on public.materials for select to anon, authenticated
  using (status = 'published' or (select public.is_staff()));
create policy materials_write on public.materials for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy material_domains_read on public.material_domains for select to anon, authenticated
  using (exists (select 1 from public.materials m where m.id = material_id and (m.status = 'published' or (select public.is_staff()))));
create policy material_domains_write on public.material_domains for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy material_topics_read on public.material_topics for select to anon, authenticated
  using (exists (select 1 from public.materials m where m.id = material_id and (m.status = 'published' or (select public.is_staff()))));
create policy material_topics_write on public.material_topics for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy material_needs_read on public.material_needs for select to anon, authenticated
  using (exists (select 1 from public.materials m where m.id = material_id and (m.status = 'published' or (select public.is_staff()))));
create policy material_needs_write on public.material_needs for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy content_review_staff on public.content_review for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- المسارات: العام يرى المنشور فقط؛ المسجَّل يرى مساره حتى لو أُوقف البدء الجديد
create policy paths_read on public.paths for select to anon, authenticated
  using (status = 'published' or (select public.is_staff())
         or public.has_enrollment_in_path(id));
create policy paths_write on public.paths for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy path_domains_read on public.path_domains for select to anon, authenticated
  using (exists (select 1 from public.paths p where p.id = path_id));
create policy path_domains_write on public.path_domains for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy path_needs_read on public.path_needs for select to anon, authenticated
  using (exists (select 1 from public.paths p where p.id = path_id));
create policy path_needs_write on public.path_needs for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- صف الإصدار نفسه يراه المسجَّل فيه حتى لو سُحب (ليظهر له إشعار السحب)، أما الخطوات فلا
create policy path_versions_read on public.path_versions for select to anon, authenticated
  using ((select public.is_staff())
         or (status = 'published' and exists (select 1 from public.paths p where p.id = path_id and p.status = 'published'))
         or public.has_enrollment_in_version(id));
create policy path_versions_write on public.path_versions for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy steps_read on public.steps for select to anon, authenticated
  using (public.can_read_version(version_id));
create policy steps_write on public.steps for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy step_materials_read on public.step_materials for select to anon, authenticated
  using (public.can_read_step(step_id));
create policy step_materials_write on public.step_materials for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy homepage_read on public.homepage_items for select to anon, authenticated
  using ((select public.is_staff())
         or (path_id is not null and exists (select 1 from public.paths p where p.id = path_id and p.status = 'published'))
         or (material_id is not null and exists (select 1 from public.materials m where m.id = material_id and m.status = 'published')));
create policy homepage_write on public.homepage_items for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy slug_redirects_read on public.slug_redirects for select to anon, authenticated using (true);

-- ============================================================================
-- الفريق والتدقيق
-- ============================================================================
create policy staff_roles_read on public.staff_roles for select to authenticated
  using (user_id = auth.uid() or (select public.is_manager()));
create policy staff_roles_write on public.staff_roles for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy staff_invites_manager on public.staff_invites for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy audit_manager_read on public.audit_log for select to authenticated
  using ((select public.is_manager()));

-- ============================================================================
-- بيانات المستخدم: كل مستخدم يرى بياناته فقط
-- ============================================================================
create policy profiles_own_read   on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy enrollments_own_read on public.enrollments for select to authenticated using (user_id = auth.uid());
create policy enrollment_steps_own_read on public.enrollment_steps for select to authenticated
  using (exists (select 1 from public.enrollments e where e.id = enrollment_id and e.user_id = auth.uid()));

create policy goals_own on public.goals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy goal_enrollments_own on public.goal_enrollments for all to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
          and exists (select 1 from public.enrollments e where e.id = enrollment_id and e.user_id = auth.uid()));

create policy goal_materials_own on public.goal_materials for all to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
          and exists (select 1 from public.materials m where m.id = material_id and m.status = 'published'));

create policy saved_own_read   on public.saved_materials for select to authenticated using (user_id = auth.uid());
create policy saved_own_insert on public.saved_materials for insert to authenticated
  with check (user_id = auth.uid()
          and exists (select 1 from public.materials m where m.id = material_id and m.status = 'published'));
create policy saved_own_delete on public.saved_materials for delete to authenticated using (user_id = auth.uid());

create policy reports_insert on public.material_reports for insert to authenticated
  with check (reporter_id = auth.uid()
          and exists (select 1 from public.materials m where m.id = material_id and m.status = 'published'));
create policy reports_read on public.material_reports for select to authenticated
  using (reporter_id = auth.uid() or (select public.is_staff()));
create policy reports_staff_update on public.material_reports for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- ============================================================================
-- المنح (GRANT): الأعمدة الحساسة محجوبة (status الإصدار، user_id، ...)
-- ============================================================================
grant usage on schema public to anon, authenticated;

-- قراءة المحتوى العام
grant select on public.doors, public.domains, public.topics, public.needs, public.need_topics,
  public.materials, public.material_domains, public.material_topics, public.material_needs,
  public.paths, public.path_domains, public.path_needs, public.path_versions,
  public.steps, public.step_materials, public.homepage_items, public.slug_redirects,
  public.paths_current
  to anon, authenticated;

-- كتابة الفريق (RLS تقصرها على الفريق). لا حذف للمواد ولا للمسارات ولا للتصنيفات: الإخفاء فقط.
grant update (title, description, sort_order) on public.doors to authenticated;
grant insert, update on public.domains, public.topics, public.needs, public.materials to authenticated;
grant insert, delete on public.need_topics, public.material_domains, public.material_topics,
  public.material_needs, public.path_domains, public.path_needs to authenticated;
grant insert (slug, status, change_type), update (slug, status, change_type) on public.paths to authenticated;
grant insert (path_id, title, description, purpose, duration_days, changelog) on public.path_versions to authenticated;
grant update (title, description, purpose, duration_days, changelog) on public.path_versions to authenticated;
grant insert, update, delete on public.steps, public.step_materials to authenticated;
grant select on public.content_review to authenticated;
grant update (review_status, internal_note) on public.content_review to authenticated;
grant insert, update, delete on public.homepage_items to authenticated;
grant select, insert, update, delete on public.staff_roles, public.staff_invites to authenticated;
grant select on public.audit_log to authenticated;

-- بيانات المستخدم
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.enrollments, public.enrollment_steps, public.enrollment_progress to authenticated;
grant select, delete on public.goals to authenticated;
grant insert (id, title, description, domain_id, target_date, status) on public.goals to authenticated;
grant update (title, description, domain_id, target_date, status) on public.goals to authenticated;
grant select, insert, delete on public.goal_enrollments, public.goal_materials, public.saved_materials to authenticated;
grant select on public.material_reports to authenticated;
grant insert (material_id, note) on public.material_reports to authenticated;
grant update (status, resolved_by, resolved_at) on public.material_reports to authenticated;

-- ============================================================================
-- الدوال: منح صريح فقط
-- ============================================================================
grant execute on function public.normalize_ar(text), public.search_norm(text),
  public.search_vec(text, text, text), public.is_staff(), public.is_manager(),
  public.can_read_version(uuid), public.can_read_step(uuid),
  public.has_enrollment_in_path(uuid), public.has_enrollment_in_version(uuid), public.require_user(),
  public.search_content(text, int)
  to anon, authenticated;

grant execute on function
  public.start_path(uuid), public.set_step_state(uuid, uuid, public.step_state),
  public.mark_step_opened(uuid, uuid), public.archive_enrollment(uuid),
  public.plan_migration(uuid), public.migrate_enrollment(uuid), public.restart_enrollment(uuid),
  public.restore_goal(uuid), public.claim_staff_invite(),
  public.create_draft_version(uuid), public.publish_path_version(uuid, text),
  public.withdraw_version(uuid, text), public.material_impact(uuid)
  to authenticated;
