-- ============================================================================
-- يَقَظَة — الهجرة 3: بيانات المستخدم (الملف، التسجيل في المسارات، الأهداف، المحفوظات)
-- ============================================================================

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- تسجيل المستخدم في مسار: مثبّت على إصدار محدد (R3)
create table public.enrollments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  path_id        uuid not null references public.paths(id),
  version_id     uuid not null,
  status         public.enrollment_status not null default 'active',
  started_at     timestamptz not null default now(),
  archived_at    timestamptz,
  archive_reason text check (archive_reason in ('migrated', 'restarted', 'user')),
  migrated_from  uuid references public.enrollments(id) on delete set null,
  last_step_id   uuid,
  unique (id, version_id),
  -- النسخة يجب أن تتبع المسار نفسه
  foreign key (version_id, path_id) references public.path_versions(id, path_id),
  -- آخر خطوة يجب أن تتبع الإصدار نفسه (لا تُفحص حين تكون null)
  foreign key (last_step_id, version_id) references public.steps(id, version_id),
  check ((status = 'archived') = (archived_at is not null))
);
-- تسجيل نشط واحد لكل مسار لكل مستخدم (R6)
create unique index enrollments_one_active on public.enrollments (user_id, path_id) where status = 'active';
create index enrollments_user_idx    on public.enrollments (user_id);
create index enrollments_version_idx on public.enrollments (version_id);
create index enrollments_migrated_idx on public.enrollments (migrated_from);

-- حالة الخطوات: غياب الصف = «لم تبدأ»
create table public.enrollment_steps (
  enrollment_id uuid not null,
  version_id    uuid not null,
  step_id       uuid not null,
  state         public.step_state not null,
  updated_at    timestamptz not null default now(),
  primary key (enrollment_id, step_id),
  foreign key (enrollment_id, version_id) references public.enrollments(id, version_id) on delete cascade,
  foreign key (step_id, version_id)       references public.steps(id, version_id)
);

create table public.goals (
  id                   uuid primary key default gen_random_uuid(),   -- يجوز أن يولّده العميل (حفظ متكافئ)
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title                text not null check (char_length(btrim(title)) between 1 and 120),
  description          text check (description is null or char_length(description) <= 2000),
  domain_id            uuid references public.domains(id) on delete set null,
  target_date          date,
  status               public.goal_status not null default 'not_started',
  status_before_archive public.goal_status,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id, status);

-- علاقة متعددة إلى متعددة عبر «التسجيل» لا عبر المسار المجرد (R3, R4)
create table public.goal_enrollments (
  goal_id       uuid not null references public.goals(id)       on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (goal_id, enrollment_id)
);
create index goal_enrollments_enr_idx on public.goal_enrollments (enrollment_id);

create table public.goal_materials (
  goal_id     uuid not null references public.goals(id)     on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (goal_id, material_id)
);

create table public.saved_materials (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (user_id, material_id)
);
create index saved_materials_mat_idx on public.saved_materials (material_id);

create table public.material_reports (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  reporter_id uuid default auth.uid() references auth.users(id) on delete set null,
  note        text check (note is null or char_length(note) <= 1000),
  status      public.report_status not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz
);
create index material_reports_open_idx on public.material_reports (status, created_at);
