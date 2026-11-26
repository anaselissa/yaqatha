-- ============================================================================
-- يَقَظَة — الهجرة 18: «واجهة الموقع» تُدار من اللوحة بلا كود (اعتمدها محمد، 26 نوفمبر)
-- • عبارات «أحسنت» ونصيحة اليوم: للمدير والمحرر.
-- • الصفحات النصية (عن يقظة، الخصوصية، الشروط) وروابط التواصل: للمدير.
-- • الموقع يعمل بلا صفوف (يعرض النصوص الافتراضية من الكود)، فالجداول تبدأ فارغة
--   ما عدا «أحسنت» تُنسخ من الكود كما هي.
-- • كل تعديل يُسجَّل في سجل التغييرات (من ومتى). إضافات فقط، آمنة للتطبيق على الإنتاج.
-- ============================================================================

-- ---------- 1) «أحسنت» ونصيحة اليوم ----------
create table public.cheers (
  id         uuid primary key default gen_random_uuid(),
  text       text not null check (char_length(btrim(text)) between 1 and 300),
  source     text check (source is null or char_length(source) <= 200),
  position   int  not null default 1,
  status     public.publish_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.daily_tips (
  id         uuid primary key default gen_random_uuid(),
  text       text not null check (char_length(btrim(text)) between 1 and 500),
  source     text check (source is null or char_length(source) <= 200),
  position   int  not null default 1,
  status     public.publish_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger cheers_touch before update on public.cheers for each row execute function public.set_updated_at();
create trigger daily_tips_touch before update on public.daily_tips for each row execute function public.set_updated_at();

-- ---------- 2) الصفحات النصية ----------
create table public.site_pages (
  slug       text primary key check (slug in ('about', 'privacy', 'terms')),
  title      text not null check (char_length(btrim(title)) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 60000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
create function public.site_pages_stamp() returns trigger
language plpgsql as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger site_pages_stamp before insert or update on public.site_pages for each row execute function public.site_pages_stamp();

-- ---------- 3) روابط التواصل ----------
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check
  check (key in ('team_whatsapp', 'mentorship_open', 'women_section_open', 'mentorship_response_days', 'exam_pass_percent',
                 'community_whatsapp_url', 'instagram_url'));
insert into public.app_settings (key, value) values ('community_whatsapp_url', '""'), ('instagram_url', '""') on conflict (key) do nothing;

-- ---------- 4) الصلاحيات ----------
revoke all on public.cheers, public.daily_tips, public.site_pages from anon, authenticated;
alter table public.cheers enable row level security;
alter table public.daily_tips enable row level security;
alter table public.site_pages enable row level security;

create policy cheers_read on public.cheers for select to anon, authenticated using (status = 'published' or (select public.is_staff()));
create policy cheers_write on public.cheers for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy daily_tips_read on public.daily_tips for select to anon, authenticated using (status = 'published' or (select public.is_staff()));
create policy daily_tips_write on public.daily_tips for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy site_pages_read on public.site_pages for select to anon, authenticated using (true);
create policy site_pages_write on public.site_pages for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));

grant select on public.cheers, public.daily_tips, public.site_pages to anon, authenticated;
grant insert, update, delete on public.cheers, public.daily_tips to authenticated;
grant insert (slug, title, body), update (title, body) on public.site_pages to authenticated;

create trigger cheers_audit after insert or update or delete on public.cheers for each row execute function public.audit_row();
create trigger daily_tips_audit after insert or update or delete on public.daily_tips for each row execute function public.audit_row();
create trigger site_pages_audit after insert or update or delete on public.site_pages for each row execute function public.audit_row();

-- روابط التواصل يقرؤها الجميع (تظهر في الموقع)، ويعدّلها المدير كبقية الإعدادات
create function public.public_links() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'whatsapp', nullif((select value #>> '{}' from public.app_settings where key = 'community_whatsapp_url'), ''),
    'instagram', nullif((select value #>> '{}' from public.app_settings where key = 'instagram_url'), ''))
$$;
revoke execute on function public.public_links(), public.site_pages_stamp() from public;
grant execute on function public.public_links() to anon, authenticated;

-- ---------- 5) «أحسنت» من الكود كما هي ----------
insert into public.cheers (text, source, position) values
  ('أحبّ الأعمال إلى الله أدومها وإن قلّ.', 'رواه البخاري 6464، ومسلم 783', 1),
  ('﴿وَالَّذِينَ جَاهَدُوا فِينَا لَنَهْدِيَنَّهُمْ سُبُلَنَا﴾', 'العنكبوت: 69', 2),
  ('خطوة صغيرة اليوم، وأخرى غدًا. هكذا يُبنى الطريق.', null, 3),
  ('﴿إِنَّا لَا نُضِيعُ أَجْرَ مَنْ أَحْسَنَ عَمَلًا﴾', 'الكهف: 30', 4),
  ('فسدّدوا وقاربوا وأبشروا.', 'رواه البخاري 39', 5),
  ('﴿فَمَن يَعْمَلْ مِثْقَالَ ذَرَّةٍ خَيْرًا يَرَهُ﴾', 'الزلزلة: 7', 6),
  ('﴿وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ﴾', 'النجم: 39', 7),
  ('﴿إِنَّ اللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا مَا بِأَنفُسِهِمْ﴾', 'الرعد: 11', 8);
