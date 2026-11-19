-- ============================================================================
-- بيانات تطوير فقط — لا تُطبَّق على الإنتاج أبدًا.
-- كل العناوين تبدأ بـ «[تجريبي]» ونصوصها بنائية بلا أي مضمون ديني، لاختبار العرض فقط.
-- ============================================================================
update public.domains set status = 'published' where slug in ('worship', 'self-discipline', 'character', 'family-relations');
update public.needs set status = 'published' where slug in
  ('prayer-consistency', 'repentance', 'faith-and-certainty', 'anger-control', 'quit-sin-or-habit', 'honor-parents', 'improve-character');

insert into public.topics (slug, title, description, domain_id, status)
select v.slug, v.title, 'موضوع تجريبي لاختبار العرض.', d.id, 'published'
from (values ('anger', '[تجريبي] الغضب', 'character'), ('prayer', '[تجريبي] الصلاة', 'worship'), ('parents', '[تجريبي] بر الوالدين', 'family-relations')) v(slug, title, dom)
join public.domains d on d.slug = v.dom;

insert into public.need_topics select n.id, t.id from public.needs n, public.topics t
 where (n.slug, t.slug) in (('anger-control', 'anger'), ('prayer-consistency', 'prayer'), ('honor-parents', 'parents'));

-- المواد
insert into public.materials (slug, title, description, type, body, url, source_title, source_url, author, nature) values
 ('dev-article-anger', '[تجريبي] مقال لاختبار العرض: خطوات عملية لضبط الانفعال',
  'مقال تجريبي طويل نسبيًا لاختبار الطباعة والعناوين والقوائم.', 'article',
  E'## لماذا هذا العنوان؟\n\nهذا نص تجريبي لاختبار **عرض المقال** وليس محتوى حقيقيًا. يحتوي على فقرات وقوائم وروابط.\n\n### قائمة نقطية\n\n- العنصر الأول من القائمة التجريبية.\n- العنصر الثاني، وهو أطول قليلًا ليختبر التفاف الأسطر على الشاشات الصغيرة.\n- العنصر الثالث.\n\n### قائمة مرقمة\n\n1. الخطوة الأولى التجريبية.\n2. الخطوة الثانية التجريبية.\n\n> اقتباس تجريبي لاختبار شكل الاقتباس داخل المقال.\n\nرابط خارجي تجريبي: [مثال](https://example.org/).\n\nفقرة أخيرة تحتوي أرقامًا مثل 2026 وكلمة English لاختبار الاتجاه المزدوج.',
  null, 'كتاب تجريبي (بيانات تطوير)', null, 'مؤلف تجريبي', 'original_source'),
 ('dev-video-prayer', '[تجريبي] فيديو لاختبار المشغّل المؤجَّل', 'فيديو تجريبي (مادة مفتوحة المصدر) لاختبار التحميل بالنقر.', 'video',
  null, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'قناة تجريبية', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'محاضر تجريبي', 'original_source'),
 ('dev-link-parents', '[تجريبي] رابط خارجي لاختبار البطاقة', 'مصدر خارجي تجريبي.', 'external_link',
  null, 'https://example.org/', 'موقع تجريبي', 'https://example.org/', null, 'original_source'),
 ('dev-guidance-time', '[تجريبي] توجيه عملي من فريق يقظة', 'توجيه تجريبي أعده الفريق (تلخيص أو توجيه).', 'guidance',
  E'### توجيه تجريبي\n\nنص تجريبي قصير لاختبار نوع «توجيه عملي».', null, null, null, null, 'yaqatha_summary'),
 ('dev-exercise-anger', '[تجريبي] تمرين لاختبار العرض', 'تمرين تجريبي.', 'exercise',
  E'#### التمرين\n\n1. اكتب جملة تجريبية.\n2. اقرأها بصوت عالٍ.', null, null, null, null, 'yaqatha_summary'),
 ('dev-hidden', '[تجريبي] مادة سيُخفى نشرها', 'تُستخدم لاختبار «غير متاحة حاليًا».', 'guidance',
  'نص تجريبي.', null, null, null, null, 'yaqatha_summary'),
 ('dev-draft', '[تجريبي] مسودة لا يجوز أن تظهر', 'يجب ألا تظهر للعامة.', 'guidance',
  'نص تجريبي.', null, null, null, null, 'yaqatha_summary');

insert into public.material_needs (material_id, need_id)
select m.id, n.id from public.materials m join public.needs n on (m.slug, n.slug) in
  (('dev-article-anger','anger-control'), ('dev-exercise-anger','anger-control'), ('dev-guidance-time','improve-character'),
   ('dev-video-prayer','prayer-consistency'), ('dev-link-parents','honor-parents'), ('dev-hidden','anger-control'), ('dev-draft','anger-control'));
insert into public.material_topics (material_id, topic_id)
select m.id, t.id from public.materials m join public.topics t on (m.slug, t.slug) in
  (('dev-article-anger','anger'), ('dev-exercise-anger','anger'), ('dev-video-prayer','prayer'), ('dev-link-parents','parents'));
insert into public.material_domains (material_id, domain_id)
select m.id, d.id from public.materials m join public.domains d on (m.slug, d.slug) in
  (('dev-article-anger','character'), ('dev-video-prayer','worship'), ('dev-link-parents','family-relations'), ('dev-guidance-time','character'));

-- مواد إضافية لاختبار الترقيم
insert into public.materials (slug, title, description, type, body, source_title, nature)
select 'dev-bulk-' || g, '[تجريبي] مادة رقم ' || g, 'مادة تجريبية لاختبار الترقيم.', 'article', 'نص تجريبي.', 'مصدر تجريبي', 'original_source'
from generate_series(1, 14) g;
insert into public.material_domains select m.id, d.id from public.materials m, public.domains d where m.slug like 'dev-bulk-%' and d.slug = 'worship';

update public.materials set status = 'published' where slug <> 'dev-draft';
update public.materials set status = 'hidden' where slug = 'dev-hidden';

-- المسارات
insert into public.paths (slug, change_type) values ('dev-anger-7days', 'acquire_good_deed'), ('dev-open-path', 'increase_knowledge');
insert into public.path_versions (path_id, title, description, purpose, duration_days)
select id, '[تجريبي] سبعة أيام لاختبار المسارات', 'مسار تجريبي بمدة محددة.', 'اختبار عرض المسار وخطواته.', 7 from public.paths where slug = 'dev-anger-7days';
insert into public.path_versions (path_id, title, description, purpose, duration_days)
select id, '[تجريبي] مسار مفتوح بلا مدة', 'مسار تجريبي مفتوح.', 'اختبار المسار المفتوح.', null from public.paths where slug = 'dev-open-path';

insert into public.steps (version_id, position, type, title, instructions)
select v.id, s.pos, s.t::public.step_type, s.title, s.ins
from public.path_versions v join public.paths p on p.id = v.path_id
join (values
  ('dev-anger-7days', 1, 'read',       'اقرأ المقال التجريبي', 'تعليمات تجريبية للخطوة الأولى: اقرأ المادة المرتبطة ثم انتقل إلى التالية.'),
  ('dev-anger-7days', 2, 'watch',      'شاهد الفيديو التجريبي', 'تعليمات تجريبية للخطوة الثانية.'),
  ('dev-anger-7days', 3, 'exercise',   'طبّق التمرين', 'تعليمات تجريبية لخطوة تمرين.'),
  ('dev-anger-7days', 4, 'reflection', 'سؤال للتفكير', 'ما الذي لاحظته أثناء هذه الأيام؟ (سؤال تجريبي).'),
  ('dev-open-path',   1, 'read',       'ابدأ بالقراءة', 'تعليمات تجريبية.'),
  ('dev-open-path',   2, 'guidance',   'توجيه عملي', 'تعليمات تجريبية.'),
  ('dev-open-path',   3, 'review',     'راجع تجربتك', 'تعليمات تجريبية.')
) s(slug, pos, t, title, ins) on s.slug = p.slug;

insert into public.step_materials (step_id, material_id)
select st.id, m.id from public.steps st
join public.path_versions v on v.id = st.version_id join public.paths p on p.id = v.path_id
join public.materials m on (p.slug, st.position, m.slug) in
  (('dev-anger-7days', 1, 'dev-article-anger'), ('dev-anger-7days', 2, 'dev-video-prayer'), ('dev-anger-7days', 2, 'dev-hidden'),
   ('dev-anger-7days', 3, 'dev-exercise-anger'), ('dev-open-path', 1, 'dev-article-anger'), ('dev-open-path', 2, 'dev-guidance-time'));

insert into public.path_needs select p.id, n.id from public.paths p, public.needs n where (p.slug, n.slug) in
  (('dev-anger-7days','anger-control'), ('dev-open-path','improve-character'), ('dev-open-path','anger-control'));
insert into public.path_domains select p.id, d.id from public.paths p, public.domains d where (p.slug, d.slug) in
  (('dev-anger-7days','character'), ('dev-open-path','character'));

-- نشر v1 ثم إصدار 2 بملخص تغييرات (محاكاة ما يفعله المحرر)
update public.path_versions set status = 'published', published_at = now() - interval '10 days'
 where id in (select v.id from public.path_versions v join public.paths p on p.id = v.path_id where p.slug in ('dev-anger-7days', 'dev-open-path'));
update public.paths set status = 'published' where slug in ('dev-anger-7days', 'dev-open-path');

insert into public.path_versions (path_id, title, description, purpose, duration_days)
select p.id, v.title, v.description, v.purpose, v.duration_days from public.path_versions v join public.paths p on p.id = v.path_id where p.slug = 'dev-anger-7days';
insert into public.steps (version_id, step_key, position, type, title, instructions)
select v2.id, s.step_key, s.position, s.type, s.title, s.instructions
from public.steps s join public.path_versions v1 on v1.id = s.version_id and v1.version_no = 1
join public.paths p on p.id = v1.path_id and p.slug = 'dev-anger-7days'
join public.path_versions v2 on v2.path_id = p.id and v2.version_no = 2;
insert into public.step_materials select s2.id, sm.material_id, sm.position
from public.step_materials sm join public.steps s1 on s1.id = sm.step_id
join public.path_versions v1 on v1.id = s1.version_id and v1.version_no = 1
join public.paths p on p.id = v1.path_id and p.slug = 'dev-anger-7days'
join public.path_versions v2 on v2.path_id = p.id and v2.version_no = 2
join public.steps s2 on s2.version_id = v2.id and s2.step_key = s1.step_key;
update public.path_versions set status = 'retired' where version_no = 1 and path_id = (select id from public.paths where slug = 'dev-anger-7days');
update public.path_versions set status = 'published', published_at = now() - interval '2 days',
  changelog = 'تحديث تجريبي: صُحّحت صياغة الخطوات (بيانات تطوير).'
 where version_no = 2 and path_id = (select id from public.paths where slug = 'dev-anger-7days');

insert into public.homepage_items (section, path_id, position) select 'start_here', id, 1 from public.paths where slug = 'dev-open-path';
insert into public.homepage_items (section, path_id, position) select 'featured_paths', id, 1 from public.paths where slug = 'dev-anger-7days';
insert into public.homepage_items (section, material_id, position) select 'featured_materials', id, row_number() over (order by slug)
  from public.materials where slug in ('dev-article-anger', 'dev-video-prayer', 'dev-guidance-time');

-- مادة غُيّر رابطها (لاختبار تحويل 301)
insert into public.materials (slug, title, description, type, body, source_title, nature)
values ('dev-moved-old', '[تجريبي] مادة تغيّر رابطها', 'لاختبار التحويل الدائم.', 'article', 'نص تجريبي.', 'مصدر تجريبي', 'original_source');
insert into public.material_needs select m.id, n.id from public.materials m, public.needs n where m.slug = 'dev-moved-old' and n.slug = 'anger-control';
update public.materials set status = 'published' where slug = 'dev-moved-old';
update public.materials set slug = 'dev-moved' where slug = 'dev-moved-old';
