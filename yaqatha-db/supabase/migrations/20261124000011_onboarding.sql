-- ============================================================================
-- يَقَظَة — الهجرة 11: «ابدأ من هنا» — أسئلة تعريفية تقترح على الزائر بداية مناسبة
-- إضافات فقط. الإجابات لا تُحفظ أبدًا: تُحسب النتيجة من الاختيارات في الطلب نفسه.
-- القرار: الأسئلة عن المجال والحال، لا عن تفاصيل الذنوب. يعدّلها الفريق من اللوحة.
-- ============================================================================

create table public.onboarding_questions (
  id         uuid primary key default gen_random_uuid(),
  position   int  not null default 1,
  prompt     text not null check (char_length(btrim(prompt)) between 1 and 300),
  hint       text check (hint is null or char_length(hint) <= 300),
  status     public.publish_status not null default 'published',
  created_at timestamptz not null default now()
);

-- كل خيار يرجّح احتياجًا (أو لا شيء) بوزن
create table public.onboarding_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.onboarding_questions(id) on delete cascade,
  position    int  not null default 1,
  label       text not null check (char_length(btrim(label)) between 1 and 200),
  need_id     uuid references public.needs(id) on delete set null,
  weight      int  not null default 1 check (weight between 0 and 5)
);
create index onboarding_options_idx on public.onboarding_options (question_id, position);

revoke all on public.onboarding_questions, public.onboarding_options from anon, authenticated;
alter table public.onboarding_questions enable row level security;
alter table public.onboarding_options   enable row level security;

create policy onboarding_questions_read on public.onboarding_questions for select to anon, authenticated
  using (status = 'published' or (select public.is_staff()));
create policy onboarding_questions_write on public.onboarding_questions for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy onboarding_options_read on public.onboarding_options for select to anon, authenticated
  using (exists (select 1 from public.onboarding_questions q where q.id = question_id));
create policy onboarding_options_write on public.onboarding_options for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

grant select on public.onboarding_questions, public.onboarding_options to anon, authenticated;
grant insert, update, delete on public.onboarding_questions, public.onboarding_options to authenticated;

create trigger onboarding_questions_audit after insert or update or delete on public.onboarding_questions for each row execute function public.audit_row();
create trigger onboarding_options_audit   after insert or update or delete on public.onboarding_options   for each row execute function public.audit_row();

-- ---------- أسئلة افتراضية (يعدّلها الفريق أو يحذفها من اللوحة) ----------
-- دالة لأن ترتيب التطبيق يختلف: على الإنتاج الاحتياجات موجودة فتُنشأ الأسئلة هنا؛
-- وفي التطوير والاختبار تُستدعى من seed.sql بعد إنشاء الاحتياجات. لا تفعل شيئًا إن وُجدت أسئلة.
create function public.seed_default_onboarding() returns void
language plpgsql security definer set search_path = public as $$
declare q1 uuid; q2 uuid; q3 uuid;
begin
  if exists (select 1 from public.onboarding_questions) or not exists (select 1 from public.needs) then return; end if;
  insert into public.onboarding_questions (position, prompt, hint) values
    (1, 'ما الذي يشغلك أكثر هذه الأيام؟', 'اختر الأقرب إليك، لا يوجد جواب خاطئ') returning id into q1;
  insert into public.onboarding_questions (position, prompt) values
    (2, 'كيف حال صلاتك هذه الفترة؟') returning id into q2;
  insert into public.onboarding_questions (position, prompt) values
    (3, 'ما الذي تحتاجه أكثر الآن؟') returning id into q3;

  insert into public.onboarding_options (question_id, position, label, need_id, weight)
  select q1, v.pos, v.label, (select id from public.needs where slug = v.slug), 3 from (values
    (1, 'علاقتي بالله: أشعر بالبُعد أو الفتور', 'faith-and-certainty'),
    (2, 'ذنب أو عادة أريد أن أتركها', 'quit-sin-or-habit'),
    (3, 'غضبي أو أخلاقي مع الناس', 'anger-control'),
    (4, 'علاقتي بأهلي', 'honor-parents'),
    (5, 'وقتي وشبابي يضيعان', 'invest-time-and-youth'),
    (6, 'أريد أن أتعلم ديني', 'learn-religion-with-insight')
  ) as v(pos, label, slug);

  insert into public.onboarding_options (question_id, position, label, need_id, weight)
  select q2, v.pos, v.label, (select id from public.needs where slug = v.slug), v.w from (values
    (1, 'أحافظ عليها والحمد لله', 'adhkar-and-worship', 1),
    (2, 'تفوتني أحيانًا', 'prayer-consistency', 2),
    (3, 'متقطعة كثيرًا، وأريد أن أبدأ من جديد', 'prayer-consistency', 4)
  ) as v(pos, label, slug, w);

  insert into public.onboarding_options (question_id, position, label, need_id, weight)
  select q3, v.pos, v.label, (select id from public.needs where slug = v.slug), v.w from (values
    (1, 'أن أرجع إلى الله وأبدأ صفحة جديدة', 'repentance', 2),
    (2, 'خطوات عملية قصيرة ألتزم بها', null, 0),
    (3, 'أن أفهم وأتعلم', 'learn-religion-with-insight', 2),
    (4, 'رفقة تعينني', 'righteous-company', 2)
  ) as v(pos, label, slug, w);
end $$;
revoke execute on function public.seed_default_onboarding() from public, anon, authenticated;
select public.seed_default_onboarding();
