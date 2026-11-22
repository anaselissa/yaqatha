-- ============================================================================
-- يَقَظَة — الهجرة 8: السلاسل، وختام المسار (أهداف مقترحة ومسارات تالية)
-- إضافات فقط: لا تعديل ولا حذف لأي جدول أو بيانات موجودة. آمنة للتطبيق على الإنتاج.
-- ============================================================================

-- ---------- السلاسل: مجموعة مرتبة من المواد (حلقات شيخ على يوتيوب مثلًا) ----------
create table public.series (
  id          uuid primary key default gen_random_uuid(),
  slug        public.slug_t not null unique,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  author      text check (author is null or char_length(author) <= 200),
  source_url  text check (source_url is null or source_url ~* '^https?://'),
  status      public.publish_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.series_items (
  series_id   uuid not null references public.series(id)    on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  position    int  not null check (position > 0),
  primary key (series_id, material_id)
);
create index series_items_order_idx    on public.series_items (series_id, position);
create index series_items_material_idx on public.series_items (material_id);

create trigger series_touch before update on public.series for each row execute function public.set_updated_at();

-- ---------- ختام المسار ----------
-- أهداف يقترحها الفريق لمن أكمل المسار (مثل «صلاة الفجر في المسجد»)؛ يتبنّاها المستخدم هدفًا شخصيًا بنقرة
create table public.path_suggested_goals (
  id          uuid primary key default gen_random_uuid(),
  path_id     uuid not null references public.paths(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  position    int  not null default 1,
  created_at  timestamptz not null default now()
);
create index path_suggested_goals_idx on public.path_suggested_goals (path_id, position);

-- المسارات المقترحة بعد إكمال المسار (أعمق في الطريق نفسه، أو قريب منه)
create table public.path_next (
  path_id      uuid not null references public.paths(id) on delete cascade,
  next_path_id uuid not null references public.paths(id) on delete cascade,
  position     int  not null default 1,
  primary key (path_id, next_path_id),
  check (path_id <> next_path_id)
);

-- ---------- الصلاحيات: لا شيء إلا بمنح صريح (Supabase تمنح الجداول الجديدة افتراضيًا) ----------
revoke all on public.series, public.series_items, public.path_suggested_goals, public.path_next from anon, authenticated;
alter table public.series               enable row level security;
alter table public.series_items         enable row level security;
alter table public.path_suggested_goals enable row level security;
alter table public.path_next            enable row level security;

create policy series_read on public.series for select to anon, authenticated
  using (status = 'published' or (select public.is_staff()));
create policy series_write on public.series for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- الحلقة تظهر إن كانت السلسلة والمادة كلتاهما ظاهرتين للقارئ (RLS الجدولين تُطبَّق داخل الاستعلام الفرعي)
create policy series_items_read on public.series_items for select to anon, authenticated
  using (exists (select 1 from public.series s where s.id = series_id)
         and exists (select 1 from public.materials m where m.id = material_id));
create policy series_items_write on public.series_items for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy path_suggested_goals_read on public.path_suggested_goals for select to anon, authenticated
  using (exists (select 1 from public.paths p where p.id = path_id));
create policy path_suggested_goals_write on public.path_suggested_goals for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy path_next_read on public.path_next for select to anon, authenticated
  using (exists (select 1 from public.paths p where p.id = path_id)
         and exists (select 1 from public.paths p where p.id = next_path_id and (p.status = 'published' or (select public.is_staff()))));
create policy path_next_write on public.path_next for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

grant select on public.series, public.series_items, public.path_suggested_goals, public.path_next to anon, authenticated;
-- لا حذف للسلسلة نفسها (إخفاء وأرشفة فقط، مثل المواد)؛ حلقاتها وأهداف المسار وروابطه تُحذف وتُعدَّل
grant insert, update on public.series to authenticated;
grant insert, update, delete on public.series_items, public.path_suggested_goals, public.path_next to authenticated;

-- ---------- سجل التغييرات ----------
create trigger series_audit               after insert or update or delete on public.series               for each row execute function public.audit_row();
create trigger series_items_audit         after insert or update or delete on public.series_items         for each row execute function public.audit_row();
create trigger path_suggested_goals_audit after insert or update or delete on public.path_suggested_goals for each row execute function public.audit_row();
create trigger path_next_audit            after insert or update or delete on public.path_next            for each row execute function public.audit_row();
