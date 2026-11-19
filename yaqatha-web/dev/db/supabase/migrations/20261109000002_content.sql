-- ============================================================================
-- يَقَظَة — الهجرة 2: التصنيف والمواد والمسارات والإدارة
-- لا تحمل جداول المحتوى العام أي عمود يكشف هوية المحررين (المؤلفون في audit_log).
-- ============================================================================

-- ---------- الأبواب الأربعة (ثابتة، يُعدَّل نصها فقط) ----------
create table public.doors (
  id          smallint primary key,
  slug        public.slug_t not null unique,
  title       text not null,
  description text,
  sort_order  smallint not null
);

-- ---------- المجالات والموضوعات والاحتياجات ----------
create table public.domains (
  id          uuid primary key default gen_random_uuid(),
  slug        public.slug_t not null unique,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  sort_order  int not null default 0,
  status      public.publish_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search_tsv  tsvector generated always as (public.search_vec(title, description)) stored
);

create table public.topics (
  id          uuid primary key default gen_random_uuid(),
  slug        public.slug_t not null unique,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  domain_id   uuid references public.domains(id) on delete set null,
  status      public.publish_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search_tsv  tsvector generated always as (public.search_vec(title, description)) stored
);

create table public.needs (
  id          uuid primary key default gen_random_uuid(),
  slug        public.slug_t not null unique,
  door_id     smallint not null references public.doors(id),
  domain_id   uuid references public.domains(id) on delete set null,
  change_type public.change_type,
  title       text not null check (char_length(btrim(title)) between 1 and 200),  -- بصيغة المتكلم: «أريد أن…»
  description text,
  sort_order  int not null default 0,
  status      public.publish_status not null default 'draft',   -- لا يُنشر قبل وجود محتوى (R10)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search_tsv  tsvector generated always as (public.search_vec(title, description)) stored
);

create table public.need_topics (
  need_id  uuid not null references public.needs(id)  on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  primary key (need_id, topic_id)
);

-- ---------- المواد ----------
create table public.materials (
  id           uuid primary key default gen_random_uuid(),
  slug         public.slug_t not null unique,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  description  text,
  type         public.material_type not null,
  body         text,                                  -- نص المقال أو التوجيه أو التمرين
  url          text check (url is null or url ~* '^https?://'),
  source_title text,
  source_url   text check (source_url is null or source_url ~* '^https?://'),
  author       text,
  nature       public.content_nature not null default 'original_source',
  status       public.publish_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search_tsv   tsvector generated always as (public.search_vec(title, coalesce(description, '') || ' ' || coalesce(author, ''), body)) stored
);

create table public.material_domains (
  material_id uuid not null references public.materials(id) on delete cascade,
  domain_id   uuid not null references public.domains(id)   on delete cascade,
  primary key (material_id, domain_id)
);
create table public.material_topics (
  material_id uuid not null references public.materials(id) on delete cascade,
  topic_id    uuid not null references public.topics(id)    on delete cascade,
  primary key (material_id, topic_id)
);
create table public.material_needs (
  material_id uuid not null references public.materials(id) on delete cascade,
  need_id     uuid not null references public.needs(id)     on delete cascade,
  primary key (material_id, need_id)
);

-- حالة المراجعة والملاحظة الداخلية: إدارية ولا تُعرض للجمهور (جدول منفصل بسياسة للمحررين فقط)
create table public.content_review (
  entity_type   text not null check (entity_type in ('material', 'path')),
  entity_id     uuid not null,
  review_status public.review_status not null default 'experimental',
  internal_note text,
  updated_at    timestamptz not null default now(),
  primary key (entity_type, entity_id)
);

-- ---------- المسارات والإصدارات والخطوات ----------
create table public.paths (
  id          uuid primary key default gen_random_uuid(),
  slug        public.slug_t not null unique,
  -- published: ظاهر ويقبل بدءًا جديدًا | hidden: «إيقاف البدء الجديد» (يستمر من بدأ) | archived | draft
  status      public.publish_status not null default 'draft',
  change_type public.change_type,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.path_domains (
  path_id   uuid not null references public.paths(id)   on delete cascade,
  domain_id uuid not null references public.domains(id) on delete cascade,
  primary key (path_id, domain_id)
);
create table public.path_needs (
  path_id uuid not null references public.paths(id) on delete cascade,
  need_id uuid not null references public.needs(id) on delete cascade,
  primary key (path_id, need_id)
);

create table public.path_versions (
  id            uuid primary key default gen_random_uuid(),
  path_id       uuid not null references public.paths(id) on delete cascade,
  version_no    int not null check (version_no > 0),      -- يُحسب تلقائيًا
  status        public.version_status not null default 'draft',
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  description   text,
  purpose       text,
  duration_days int check (duration_days is null or duration_days between 1 and 365),  -- null = مفتوح
  changelog     text,                                      -- ملخص التغييرات يراه من على إصدار أقدم
  withdrawn_note text,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  search_tsv    tsvector generated always as (public.search_vec(title, coalesce(description, '') || ' ' || coalesce(purpose, ''))) stored,
  unique (path_id, version_no),
  unique (id, path_id)
);
create unique index path_versions_one_published on public.path_versions (path_id) where status = 'published';
create unique index path_versions_one_draft     on public.path_versions (path_id) where status = 'draft';

create table public.steps (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.path_versions(id) on delete cascade,
  step_key     uuid not null default gen_random_uuid(),   -- معرّف ثابت بين الإصدارات (R5)
  position     int  not null check (position > 0),
  type         public.step_type not null,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (version_id, step_key),
  unique (id, version_id),
  unique (version_id, position) deferrable initially deferred
);

create table public.step_materials (
  step_id     uuid not null references public.steps(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  position    int not null default 1,
  primary key (step_id, material_id)
);

-- ---------- الرئيسية ----------
create table public.homepage_items (
  id          uuid primary key default gen_random_uuid(),
  section     text not null check (section in ('start_here', 'featured_paths', 'featured_materials')),
  path_id     uuid references public.paths(id)     on delete cascade,
  material_id uuid references public.materials(id) on delete cascade,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  check (
    (section in ('start_here', 'featured_paths') and path_id is not null and material_id is null) or
    (section = 'featured_materials' and material_id is not null and path_id is null)
  ),
  unique (section, path_id),
  unique (section, material_id)
);

-- ---------- تحويلات الروابط (R1) ----------
create table public.slug_redirects (
  entity_type text not null check (entity_type in ('domain', 'topic', 'need', 'material', 'path')),
  old_slug    text not null,
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (entity_type, old_slug)
);

-- ---------- الفريق والتدقيق ----------
create table public.staff_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.app_role not null,
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.staff_invites (
  email      text primary key check (email = lower(email)),
  role       public.app_role not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  details     jsonb
);

-- ---------- الفهارس ----------
create index needs_door_idx        on public.needs (door_id, status, sort_order);
create index topics_domain_idx     on public.topics (domain_id);
create index needs_search_idx      on public.needs         using gin (search_tsv);
create index topics_search_idx     on public.topics        using gin (search_tsv);
create index materials_search_idx  on public.materials     using gin (search_tsv);
create index versions_search_idx   on public.path_versions using gin (search_tsv);
create index materials_status_idx  on public.materials (status);
create index paths_status_idx      on public.paths (status);
create index path_versions_path_idx on public.path_versions (path_id);
create index step_materials_mat_idx on public.step_materials (material_id);
create index material_needs_idx    on public.material_needs (need_id);
create index material_topics_idx   on public.material_topics (topic_id);
create index material_domains_idx  on public.material_domains (domain_id);
create index path_needs_idx        on public.path_needs (need_id);
create index path_domains_idx      on public.path_domains (domain_id);
create index audit_entity_idx      on public.audit_log (entity_type, entity_id, at desc);
