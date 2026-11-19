-- ============================================================================
-- يَقَظَة — البيانات الأولية: الأبواب الأربعة والمجالات والاحتياجات المعتمدة في PRD.
-- المجالات والاحتياجات تُنشأ «مسودة» ولا تظهر للجمهور حتى يُنشر لها محتوى حقيقي (R10).
-- ============================================================================
insert into public.doors (id, slug, title, description, sort_order) values
  (1, 'closer-to-allah',  'اقترب من الله',            'تقوية الصلة بالله: الصلاة والتوبة والإيمان والقرآن والأذكار.', 1),
  (2, 'change-yourself',  'غيّر من نفسك',             'التخلص من الذنوب والعادات السيئة وضبط النفس وتحسين الأخلاق.',   2),
  (3, 'fix-your-life',    'أصلح حياتك وعلاقاتك',      'البر والصحبة والتعامل مع الناس واستثمار الوقت والمسؤوليات.',    3),
  (4, 'learn-and-benefit','تعلّم وانفع غيرك',         'العلم والوعي والدعوة وخدمة المجتمع والأمة.',                    4);

insert into public.domains (slug, title, sort_order) values
  ('worship',           'العبادة والصلة بالله',            1),
  ('self-discipline',   'ضبط النفس وترك المحرمات',         2),
  ('character',         'الأخلاق',                         3),
  ('family-relations',  'الأسرة والعلاقات',                4),
  ('time-and-life',     'الوقت والحياة العملية',           5),
  ('knowledge-awareness','العلم والوعي',                   6),
  ('dawah-service',     'الدعوة وخدمة المجتمع',            7);

insert into public.needs (slug, door_id, domain_id, change_type, title, sort_order)
select v.slug, v.door, d.id, v.ct::public.change_type, v.title, v.ord
from (values
  ('prayer-consistency',            1, 'worship',            'perform_duty',      'أريد أن أحافظ على صلاتي وأحسّنها', 1),
  ('repentance',                    1, 'worship',            'perform_duty',      'أريد أن أتوب وأعود إلى الله', 2),
  ('faith-and-certainty',           1, 'worship',            'acquire_good_deed', 'أريد أن أقوّي إيماني ويقيني', 3),
  ('quran-relationship',            1, 'worship',            'acquire_good_deed', 'أريد أن تكون علاقتي بالقرآن أقوى', 4),
  ('adhkar-and-worship',            1, 'worship',            'acquire_good_deed', 'أريد أن ألتزم بالأذكار والطاعات', 5),
  ('quit-sin-or-habit',             2, 'self-discipline',    'quit_haram',        'أريد أن أتخلص من ذنب أو عادة سيئة', 1),
  ('control-desires',               2, 'self-discipline',    'quit_haram',        'أريد أن أتحكم في شهواتي وأحفظ نفسي', 2),
  ('anger-control',                 2, 'character',          'acquire_good_deed', 'أريد أن أضبط غضبي وانفعالاتي', 3),
  ('improve-character',             2, 'character',          'acquire_good_deed', 'أريد أن أتخلص من الصفات السيئة وأحسّن أخلاقي', 4),
  ('honor-parents',                 3, 'family-relations',   'perform_duty',      'أريد أن أكون بارًا بوالديّ وأحسّن علاقتي بأهلي', 1),
  ('righteous-company',             3, 'family-relations',   'acquire_good_deed', 'أريد أن أختار صحبة صالحة', 2),
  ('dealing-with-people',           3, 'character',          'acquire_good_deed', 'أريد أن أحسّن تعاملي مع الناس', 3),
  ('invest-time-and-youth',         3, 'time-and-life',      'acquire_good_deed', 'أريد أن أستثمر وقتي وشبابي فيما ينفع', 4),
  ('future-and-responsibilities',   3, 'time-and-life',      'perform_duty',      'أريد أن أتعامل مع المستقبل ومسؤولياتي بوعي', 5),
  ('learn-religion-with-insight',   4, 'knowledge-awareness','increase_knowledge','أريد أن أتعلم ديني على بصيرة', 1),
  ('understand-whats-happening',    4, 'knowledge-awareness','increase_knowledge','أريد أن أفهم ما يحدث حولي', 2),
  ('awareness-truth-vs-falsehood',  4, 'knowledge-awareness','increase_knowledge','أريد أن أزيد وعيي وأميّز الحق من الباطل', 3),
  ('start-dawah',                   4, 'dawah-service',      'acquire_good_deed', 'أريد أن أبدأ في الدعوة إلى الله ونشر الخير', 4),
  ('serve-community-and-ummah',     4, 'dawah-service',      'acquire_good_deed', 'أريد أن أساهم في خدمة مجتمعي وأمتي', 5)
) as v(slug, door, dom, ct, title, ord)
join public.domains d on d.slug = v.dom;
