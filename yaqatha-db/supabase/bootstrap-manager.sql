-- ============================================================================
-- تعيين أول مدير. شغّله مرة واحدة في SQL Editor بعد أن تسجّل دخولك بحساب Google مرة على الأقل.
-- غيّر البريد أدناه إلى بريدك. لا يحتاج أي مفتاح سري.
-- ============================================================================
insert into public.staff_roles (user_id, email, role)
select id, lower(email), 'manager' from auth.users where lower(email) = lower('YOUR-EMAIL@example.com')
on conflict (user_id) do update set role = 'manager';

-- تحقق: يجب أن يظهر صف واحد على الأقل
select user_id, email, role from public.staff_roles;
