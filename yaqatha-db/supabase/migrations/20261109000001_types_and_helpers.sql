-- ============================================================================
-- يَقَظَة — الهجرة 1: الأنواع والدوال النقية
-- ============================================================================

create domain public.slug_t as text
  check (value ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(value) between 2 and 80);

create type public.app_role          as enum ('manager', 'editor');
create type public.publish_status    as enum ('draft', 'published', 'hidden', 'archived');
create type public.review_status     as enum ('experimental', 'needs_review', 'reviewed', 'approved');
create type public.material_type     as enum ('article', 'video', 'external_link', 'guidance', 'exercise', 'reflection');
create type public.content_nature    as enum ('original_source', 'yaqatha_summary');
create type public.step_type         as enum ('watch', 'read', 'guidance', 'exercise', 'reflection', 'review');
create type public.change_type       as enum ('quit_haram', 'perform_duty', 'acquire_good_deed', 'increase_knowledge');
create type public.version_status    as enum ('draft', 'published', 'retired', 'withdrawn');
create type public.enrollment_status as enum ('active', 'archived');
create type public.step_state        as enum ('not_started', 'in_progress', 'completed');
create type public.goal_status       as enum ('not_started', 'in_progress', 'paused', 'completed', 'archived');
create type public.report_status     as enum ('open', 'resolved');

-- توحيد النص العربي: إزالة التشكيل والتطويل، توحيد الهمزات والياء والتاء المربوطة، وتوحيد الأرقام.
create function public.normalize_ar(t text) returns text
language sql immutable parallel safe as $$
  select lower(
    translate(
      translate(
        regexp_replace(coalesce(t, ''), '[\u064B-\u065F\u0670\u0640]', '', 'g'),
        'أإآٱىةؤئ', 'اااايهوي'),
      '٠١٢٣٤٥٦٧٨٩', '0123456789'))
$$;

-- تطبيع للبحث: يزيد على ما سبق إزالة «ال» التعريف و«لل» من أول الكلمة (حين يبقى 3 أحرف فأكثر)
-- فيجد البحث عن «غضب» ما كُتب فيه «الغضب». لفظ الجلالة لا يتأثر.
create function public.search_norm(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(public.normalize_ar(t), '(^|\s)(ال|لل)(?=\S{3,})', '\1', 'g')
$$;

create function public.search_vec(a text, b text default null, c text default null) returns tsvector
language sql immutable parallel safe as $$
  select setweight(to_tsvector('simple', public.search_norm(a)), 'A')
      || setweight(to_tsvector('simple', public.search_norm(b)), 'B')
      || setweight(to_tsvector('simple', public.search_norm(c)), 'C')
$$;

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
