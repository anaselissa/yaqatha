-- ============================================================================
-- يَقَظَة — الهجرة 12: «من أين أبدأ» بفرعين، واحتياج السنن والنوافل
-- إضافات فقط، وآمنة للتطبيق مرة واحدة على الإنتاج.
--   الفرع fix  = «في شيء أريد أن أُصلحه» (الأسئلة الحالية كلها تنتقل إليه تلقائيًا)
--   الفرع grow = «أريد أن أزداد من الخير وأتقرّب أكثر» (أسئلة افتراضية جديدة يعدّلها الفريق)
-- ============================================================================

alter table public.onboarding_questions
  add column branch text not null default 'fix' check (branch in ('fix', 'grow'));
create index onboarding_questions_branch_idx on public.onboarding_questions (branch, position);

-- الاحتياج الجديد + أسئلة فرع grow. دالة لأن ترتيب التطبيق يختلف (في التطوير تُستدعى من seed.sql بعد الأبواب والمجالات).
-- لا تفعل شيئًا إن وُجد ما تنشئه. الاحتياج يُنشأ «مسودة» كغيره، ويُنشر من اللوحة حين يكون له محتوى.
create function public.seed_grow_onboarding() returns void
language plpgsql security definer set search_path = public as $$
declare q1 uuid; q2 uuid; q3 uuid;
begin
  if not exists (select 1 from public.doors where id = 1) or not exists (select 1 from public.domains where slug = 'worship') then return; end if;

  insert into public.needs (slug, door_id, domain_id, change_type, title, sort_order)
  select 'revive-sunnah', 1, d.id, 'acquire_good_deed', 'أريد أن أُحيي السنن والنوافل', 6
  from public.domains d where d.slug = 'worship'
  on conflict (slug) do nothing;

  if exists (select 1 from public.onboarding_questions where branch = 'grow') then return; end if;

  insert into public.onboarding_questions (branch, position, prompt, hint) values
    ('grow', 1, 'ما الخير الذي تحب أن تزيد منه؟', 'اختر الأقرب إلى قلبك الآن') returning id into q1;
  insert into public.onboarding_questions (branch, position, prompt) values
    ('grow', 2, 'كيف حالك مع الفرائض هذه الفترة؟') returning id into q2;
  insert into public.onboarding_questions (branch, position, prompt) values
    ('grow', 3, 'ما الذي يعينك أكثر على الثبات؟') returning id into q3;

  insert into public.onboarding_options (question_id, position, label, need_id, weight)
  select q1, v.pos, v.label, (select id from public.needs where slug = v.slug), 3 from (values
    (1, 'السنن والنوافل: الرواتب، الوتر، الضحى، الصيام', 'revive-sunnah'),
    (2, 'القرآن: ورد يومي وتدبّر', 'quran-relationship'),
    (3, 'الأذكار والدعاء', 'adhkar-and-worship'),
    (4, 'أن أتعلم ديني', 'learn-religion-with-insight'),
    (5, 'نفع الناس ونشر الخير', 'start-dawah')
  ) as v(pos, label, slug);

  -- الفرائض أولًا: من يقصّر فيها نقترح عليه المحافظة قبل النوافل، بلطف
  insert into public.onboarding_options (question_id, position, label, need_id, weight)
  select q2, v.pos, v.label, (select id from public.needs where slug = v.slug), v.w from (values
    (1, 'أحافظ عليها والحمد لله', 'revive-sunnah', 1),
    (2, 'أحافظ غالبًا، وأحيانًا أقصّر', 'prayer-consistency', 2)
  ) as v(pos, label, slug, w);

  insert into public.onboarding_options (question_id, position, label, need_id, weight)
  select q3, v.pos, v.label, (select id from public.needs where slug = v.slug), v.w from (values
    (1, 'عمل قليل أداوم عليه كل يوم', null, 0),
    (2, 'أن أفهم فضل العمل وأجره', 'learn-religion-with-insight', 1),
    (3, 'رفقة تعينني', 'righteous-company', 2)
  ) as v(pos, label, slug, w);
end $$;
revoke execute on function public.seed_grow_onboarding() from public, anon, authenticated;
select public.seed_grow_onboarding();
