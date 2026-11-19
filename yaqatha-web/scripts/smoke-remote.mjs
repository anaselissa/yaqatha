#!/usr/bin/env node
// فحص دخان لمشروع Supabase الحقيقي (أو المحلي) بالمفتاح العام فقط. لا يكتب شيئًا في القاعدة.
//   PUBLIC_SUPABASE_URL=https://xxx.supabase.co PUBLIC_SUPABASE_ANON_KEY=... SITE_URL=https://your.site node scripts/smoke-remote.mjs
const URL_ = (process.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const SITE = (process.env.SITE_URL ?? '').replace(/\/$/, '');
if (!URL_ || !KEY) { console.error('اضبط PUBLIC_SUPABASE_URL و PUBLIC_SUPABASE_ANON_KEY'); process.exit(2); }
if (KEY.startsWith('sb_secret_') || /service_role/.test(Buffer.from(KEY.split('.')[1] ?? '', 'base64url').toString())) {
  console.error('هذا مفتاح سري (service_role/secret). أوقف الفحص ولا تستخدمه هنا ولا ترسله لأحد. استخدم المفتاح العام فقط.'); process.exit(2);
}
const H = { apikey: KEY, ...(KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${KEY}` }) };
let fails = 0, warns = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++; };
const warn = (c, m) => { if (!c) { console.log(`warn - ${m}`); warns++; } else console.log(`ok   - ${m}`); };
const get = async (p, init = {}) => { const r = await fetch(URL_ + p, { headers: H, redirect: 'manual', ...init }); const t = await r.text(); let b = null; try { b = JSON.parse(t); } catch { /* ليس JSON */ } return { s: r.status, b, h: r.headers }; };

const doors = await get('/rest/v1/doors?select=slug');
ok(doors.s === 200 && doors.b?.length === 4, `الأبواب الأربعة مقروءة للزائر (${doors.b?.length ?? doors.s})`);

for (const t of ['goals', 'enrollments', 'enrollment_steps', 'saved_materials', 'goal_enrollments', 'staff_roles', 'staff_invites', 'audit_log', 'content_review', 'profiles', 'material_reports']) {
  const r = await get(`/rest/v1/${t}?select=*&limit=1`);
  ok([401, 403, 404].includes(r.s) || (r.s === 200 && Array.isArray(r.b) && r.b.length === 0), `الزائر لا يقرأ ${t} (${r.s})`);
}
for (const [m, p, body] of [['POST', '/rest/v1/materials', { slug: 'smoke-x', title: 'x', type: 'article' }], ['POST', '/rest/v1/goals', { title: 'x' }], ['PATCH', '/rest/v1/paths?slug=eq.x', { status: 'published' }], ['DELETE', '/rest/v1/materials?slug=eq.zzz', undefined]]) {
  const r = await get(p, { method: m, headers: { ...H, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  ok([401, 403].includes(r.s), `الزائر لا يستطيع ${m} ${p.split('?')[0]} (${r.s})`);
}
for (const fn of ['start_path', 'set_step_state', 'publish_path_version', 'delete_my_account', 'reorder_steps', 'material_impact', 'migrate_enrollment']) {
  const r = await get(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
  ok([401, 403, 404].includes(r.s) || (r.s === 400 && /permission|function|argument/i.test(JSON.stringify(r.b))) , `الزائر لا يستدعي ${fn} (${r.s})`);
}
const mats = await get('/rest/v1/materials?select=status&limit=500');
ok(mats.s === 200 && mats.b.every((m) => m.status === 'published'), `المواد المرئية للزائر كلها منشورة (${mats.b?.length})`);
const paths = await get('/rest/v1/paths?select=status&limit=500');
ok(paths.s === 200 && paths.b.every((m) => m.status === 'published'), `المسارات المرئية للزائر كلها منشورة (${paths.b?.length})`);
const dev = await get('/rest/v1/materials?select=title&title=like.*%5B%D8%AA%D8%AC%D8%B1%D9%8A%D8%A8%D9%8A%5D*&limit=1');
ok(dev.s === 200 && dev.b.length === 0, 'لا بيانات تطوير [تجريبي] ظاهرة');
const s = await get('/rest/v1/rpc/search_content', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'غضب' }) });
ok(s.s === 200 && Array.isArray(s.b), 'البحث العربي يعمل');

// إعدادات المصادقة (يتخطاها المحاكي المحلي)
const st = await get('/auth/v1/settings');
if (st.s === 200) {
  ok(st.b.external?.google === true, 'مزوّد Google مفعّل');
  warn(st.b.external?.email === false, 'مزوّد البريد/كلمة المرور معطّل (المنصة تعتمد Google فقط)');
  warn(st.b.external?.anonymous_users !== true && st.b.external?.anonymous !== true, 'الدخول المجهول معطّل');
  ok(st.b.disable_signup !== true, 'التسجيل الجديد مسموح (لازم لأول دخول بـ Google)');
  if (SITE) {
    const a = await get(`/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(SITE + '/auth/callback')}&code_challenge=abc&code_challenge_method=s256`);
    ok(a.s === 302 && /accounts\.google\.com/.test(a.h.get('location') ?? ''), `/authorize يحوّل إلى Google (${a.s})`);
  } else warn(false, 'لم يُضبط SITE_URL: تخطّيت فحص التحويل إلى Google');
} else warn(false, `تخطّيت فحوص المصادقة (GET /auth/v1/settings أعاد ${st.s}) — طبيعي على المحاكي المحلي`);

console.log(`\n${fails ? 'فشل' : 'نجح'}: ${fails} إخفاق، ${warns} تحذير`);
process.exit(fails ? 1 : 0);
