-- ============================================================================
-- يَقَظَة — الهجرة 6: حذف المستخدم لحسابه وبياناته (F12)
-- المستخدم لا يملك صلاحية حذف صفه من auth.users، ولا يجوز وضع مفتاح الخدمة في الواجهة،
-- فتُنفَّذ العملية بدالة security definer تحذف حساب المستخدم الحالي فقط.
-- الحذف يمتد (CASCADE) إلى كل بياناته؛ وحماية «آخر مدير» تمنعه إن كان آخر مدير.
-- ============================================================================
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  delete from auth.users where id = uid;
end $$;

-- الدوال التي تُنشأ في هجرات لاحقة تأخذ منحًا افتراضية في Supabase: نسحبها صراحة ثم نمنح بقدر الحاجة
revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant  execute on function public.delete_my_account() to authenticated;

-- anon لا يحتاج require_user (تستدعيها دوال المستخدم فقط)
revoke execute on function public.require_user() from anon;
