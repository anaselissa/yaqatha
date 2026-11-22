-- ============================================================================
-- فحص أمان مشروع يَقَظَة بعد التطبيق. شغّله في Supabase → SQL Editor.
-- كل صف نتيجته ok = false يدل على مشكلة يجب معالجتها قبل الإطلاق.
-- ============================================================================
with
-- 1) كل جداول public عليها RLS
t1 as (
  select 'RLS مفعّل على كل الجداول' as check,
         coalesce(string_agg(c.relname, ', '), '') as detail,
         count(*) = 0 as ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
),
-- 2) anon لا يملك إلا SELECT، وعلى جداول المحتوى العام فقط
t2 as (
  select 'anon: قراءة المحتوى العام فقط' as check,
         coalesce(string_agg(table_name || ':' || privilege_type, ', '), '') as detail,
         count(*) = 0 as ok
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
    and not (privilege_type = 'SELECT' and table_name in (
      'doors','domains','topics','needs','need_topics','materials','material_domains','material_topics',
      'material_needs','paths','path_domains','path_needs','path_versions','steps','step_materials',
      'homepage_items','slug_redirects','paths_current','series','series_items','path_suggested_goals','path_next','app_settings'))
),
-- 3) الدوال القابلة للاستدعاء من anon هي المساعدة فقط
t3 as (
  select 'anon: دوال مسموحة فقط' as check,
         coalesce(string_agg(p.proname, ', '), '') as detail,
         count(*) = 0 as ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('can_read_step','can_read_version','has_enrollment_in_path','has_enrollment_in_version',
                          'is_manager','is_staff','normalize_ar','search_content','search_norm','search_vec')
),
-- 4) دوال المستخدم: authenticated فقط وليس anon؛ ودوال الفريق تتحقق من الدور داخليًا
t4 as (
  select 'دوال الكتابة غير متاحة لـ anon' as check,
         coalesce(string_agg(p.proname, ', '), '') as detail,
         count(*) = 0 as ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('start_path','set_step_state','mark_step_opened','archive_enrollment','plan_migration',
      'migrate_enrollment','restart_enrollment','restore_goal','claim_staff_invite','create_draft_version',
      'publish_path_version','withdraw_version','material_impact','delete_my_account','reorder_steps','apply_staff_invite',
      'handle_new_user','require_staff')
    and (has_function_privilege('anon', p.oid, 'execute')
         or (p.proname in ('apply_staff_invite','handle_new_user','require_staff')
             and has_function_privilege('authenticated', p.oid, 'execute')))
),
-- 5) العروض تحترم RLS (security_invoker)
t5 as (
  select 'العروض بصلاحيات المستدعي (security_invoker)' as check,
         coalesce(string_agg(c.relname, ', '), '') as detail,
         count(*) = 0 as ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce((select option_value = 'true' from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
),
-- 6) المستخدم المسجَّل لا يكتب مباشرة في جداول التسجيل والتقدم
t6 as (
  select 'لا كتابة مباشرة على enrollments/enrollment_steps' as check,
         coalesce(string_agg(table_name || ':' || privilege_type, ', '), '') as detail,
         count(*) = 0 as ok
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
    and table_name in ('enrollments', 'enrollment_steps') and privilege_type <> 'SELECT'
),
-- 7) يوجد مدير واحد على الأقل (تنبيه وليس خطأ أمني)
t7 as (
  select 'يوجد مدير واحد على الأقل' as check,
         (select count(*) from public.staff_roles where role = 'manager')::text || ' مدير' as detail,
         exists (select 1 from public.staff_roles where role = 'manager') as ok
),
-- 8) لا بيانات تطوير في الإنتاج
t8 as (
  select 'لا بيانات تطوير (عناوين [تجريبي])' as check,
         count(*)::text || ' عنصر' as detail,
         count(*) = 0 as ok
  from (select title from public.materials where title like '%[تجريبي]%'
        union all select title from public.path_versions where title like '%[تجريبي]%') x
)
select * from t1 union all select * from t2 union all select * from t3 union all select * from t4
union all select * from t5 union all select * from t6 union all select * from t7 union all select * from t8;
