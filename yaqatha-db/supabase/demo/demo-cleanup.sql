-- ============================================================================
-- يَقَظَة — إزالة المحتوى التجريبي كله (كل ما رابطه يبدأ بـ demo-)
-- • يحذف: المواد والمسارات والسلسلة التجريبية، وعناصرها في الصفحة الرئيسية، وأسئلتها.
-- • ويحذف تقدّم من جرّبها (التسجيل في المسارات التجريبية، والمحفوظات، وربطها بالأهداف) — كلها بيانات تجربة.
-- • ثم يعيد إلى «مسودة» كل احتياج أو مجال لم يبقَ له محتوى منشور (القاعدة: لا يُنشر احتياج بلا محتوى).
-- • لا يمس أي محتوى آخر. آمن للتكرار.
-- التطبيق: Supabase ← SQL Editor ← الصق الملف كاملًا ← Run.
-- ============================================================================
begin;
delete from public.goal_materials  where material_id in (select id from public.materials where slug like 'demo-%');
delete from public.saved_materials where material_id in (select id from public.materials where slug like 'demo-%');
delete from public.enrollments     where path_id in (select id from public.paths where slug like 'demo-%');
delete from public.paths     where slug like 'demo-%';
delete from public.series    where slug like 'demo-%';
delete from public.materials where slug like 'demo-%';

update public.needs n set status = 'draft'
 where n.status = 'published'
   and not exists (select 1 from public.path_needs pn join public.paths p on p.id = pn.path_id where pn.need_id = n.id and p.status = 'published')
   and not exists (select 1 from public.material_needs mn join public.materials m on m.id = mn.material_id where mn.need_id = n.id and m.status = 'published');
update public.domains d set status = 'draft'
 where d.status = 'published'
   and not exists (select 1 from public.needs n where n.domain_id = d.id and n.status = 'published')
   and not exists (select 1 from public.material_domains md join public.materials m on m.id = md.material_id where md.domain_id = d.id and m.status = 'published')
   and not exists (select 1 from public.path_domains pd join public.paths p on p.id = pd.path_id where pd.domain_id = d.id and p.status = 'published');

select (select count(*) from public.materials where slug like 'demo-%') as demo_materials_left,
       (select count(*) from public.paths where slug like 'demo-%') as demo_paths_left,
       (select count(*) from public.needs where status = 'published') as published_needs;
commit;
