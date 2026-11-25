// المتابعة المباشرة وأرقام الأثر في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/admin-followup.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  sql(`update app_settings set value='null' where key='team_whatsapp'; update app_settings set value='true' where key='mentorship_open'; update app_settings set value='false' where key='women_section_open';`);
});
after(async () => {
  sql(`update app_settings set value='null' where key='team_whatsapp'; update app_settings set value='true' where key='mentorship_open';`);
  await browser.close();
});

async function as(email, role) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  if (!email) return c.newPage();
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const p = await c.newPage();
  await p.goto(`${BASE}/login?next=%2Fjourney`);
  await p.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/journey'));
  if (role) sql(`insert into staff_roles (user_id,email,role) select id,email,'${role}' from auth.users where email='${email}' on conflict (user_id) do update set role=excluded.role`);
  return p;
}
const submit = async (p, loc) => { await Promise.all([p.waitForLoadState('load'), loc.click()]); await p.waitForLoadState(); };
const toast = async (p) => (await p.locator('.toast').first().innerText()).trim();
const text = (p) => p.locator('main').innerText();
const MGR = `fmgr-${run}@admin.test`, MENTOR = `mentor-${run}@admin.test`, USER = `seeker-${run}@y.test`;
let mgr, user;

test('الزائر: صفحة المتابعة تطلب الدخول، ولا زر واتساب قبل ضبط الرقم', async () => {
  const v = await as(null);
  await v.goto(`${BASE}/support`);
  const t = await text(v);
  assert.match(t, /رفيق من فريق يقظة/); assert.match(t, /سجّل الدخول وأكمل الطلب/);
  assert.equal(await v.getByRole('link', { name: 'راسلنا على واتساب' }).count(), 0);
});

test('المدير يضبط رقم واتساب الفريق فيظهر الزر برسالة جاهزة', async () => {
  mgr = await as(MGR, 'manager');
  await mgr.goto(`${BASE}/admin/settings`);
  await mgr.fill('#wa', '+962 79 000 0000');
  await submit(mgr, mgr.getByRole('button', { name: 'حفظ الإعدادات' }));
  assert.match(await toast(mgr), /حُفظت الإعدادات/);
  const v = await as(null); await v.goto(`${BASE}/support`);
  const href = await v.getByRole('link', { name: 'راسلنا على واتساب' }).getAttribute('href');
  assert.match(href, /^https:\/\/wa\.me\/962790000000\?text=/);
});

test('المستخدم يرسل طلبًا، ويرى حالته، ولا يرسل طلبًا ثانيًا', async () => {
  user = await as(USER);
  await user.goto(`${BASE}/support`);
  await user.fill('#name', 'عمر');
  await user.getByText('المحافظة على الصلاة', { exact: true }).click();
  await user.fill('#phone', '+962 79 111 1111');
  await user.getByText('أضف وسيلة تواصل أخرى').click();
  await user.fill('#time', 'بعد العشاء');
  await user.getByText('شارك مشرفك تقدّمك في مساراتك').click();
  await user.getByText('وشاركه التزامك بعاداتك اليومية').click();
  await submit(user, user.getByRole('button', { name: 'أرسل الطلب' }));
  assert.match(await toast(user), /وصل طلبك/);
  const t = await text(user);
  assert.match(t, /لديك طلب متابعة/); assert.match(t, /المحافظة على الصلاة/); assert.match(t, /جديد/);
  assert.equal(sql(`select count(*) from mentorship_requests r join auth.users u on u.id=r.user_id where u.email='${USER}' and r.status='new' and r.share_progress and r.share_goals`), '1', 'الطلب بالموافقتين');
});

test('قسم الأخوات المغلق يرفض الطلب برسالة لطيفة', async () => {
  const sis = await as(`sister-${run}@y.test`);
  await sis.goto(`${BASE}/support`);
  await sis.fill('#name', 'مريم');
  await sis.getByText('أخت', { exact: true }).click();
  await sis.fill('#phone', '+962791111112');
  await submit(sis, sis.getByRole('button', { name: 'أرسل الطلب' }));
  assert.match(await toast(sis), /قسم الأخوات لم يُفتح بعد/);
});

test('المحرر لا يرى طلبات المتابعة، ويرى أرقام الأثر المجمّعة', async () => {
  const ed = await as(`fed-${run}@admin.test`, 'editor');
  assert.equal((await ed.goto(`${BASE}/admin/requests`)).status(), 404);
  await ed.goto(`${BASE}/admin`);
  const t = await text(ed);
  assert.match(t, /الأثر/); assert.match(t, /مستخدم مسجّل/);
  assert.doesNotMatch(t, /طلب متابعة جديد/, 'عدد الطلبات للمدير فقط');
  assert.equal(await ed.getByRole('link', { name: 'طلبات المتابعة' }).count(), 0);
});

test('المدير يرى الطلب، ويضيف متابِعًا ويسنده إليه', async () => {
  await mgr.goto(`${BASE}/admin`);
  assert.match(await text(mgr), /طلب متابعة جديد/);
  await mgr.goto(`${BASE}/admin/settings`);
  await mgr.fill('#m-email', MENTOR.toUpperCase());
  await submit(mgr, mgr.getByRole('button', { name: 'أضف متابِعًا' }));
  assert.equal(sql(`select count(*) from mentors where email='${MENTOR}'`), '1');
  await mgr.goto(`${BASE}/admin/requests`);
  const row = mgr.locator('li.adm-row', { hasText: 'عمر' });
  assert.match(await row.getByRole('link', { name: 'واتساب' }).getAttribute('href'), /wa\.me\/962791111111/);
  await row.locator('summary').click();
  await row.locator('select[name="assigned_to"]').selectOption(MENTOR);
  await submit(mgr, row.getByRole('button', { name: 'حفظ' }));
  assert.equal(sql(`select assigned_to from mentorship_requests where name='عمر' and status='new' order by created_at desc limit 1`), MENTOR);
});

test('المتابِع يرى ما أُسند إليه فقط ويحدّث حالته، ولا يرى غير ذلك', async () => {
  const m = await as(MENTOR);
  await m.goto(`${BASE}/admin`);
  assert.match(m.url(), /\/admin\/requests$/, 'يُحوَّل إلى الطلبات');
  assert.equal(await m.locator('nav[aria-label="أقسام الإدارة"]').getByRole('link', { name: 'المواد' }).count(), 0, 'تبويب الطلبات فقط');
  assert.equal((await m.goto(`${BASE}/admin/materials`)).status(), 404);
  await m.goto(`${BASE}/admin/requests`);
  const row = m.locator('li.adm-row', { hasText: 'عمر' });
  assert.equal(await row.count(), 1);
  assert.match(await row.innerText(), /تقدّمه في المسارات/, 'يرى التقدّم لأن صاحب الطلب وافق');
  assert.match(await row.innerText(), /التزامه بعاداته اليومية/, 'ويرى العادات بموافقتها المنفصلة');
  await row.locator('summary').click();
  assert.equal(await row.locator('select[name="assigned_to"]').count(), 0, 'لا إسناد للمتابِع');
  await row.locator('select[name="status"]').selectOption('contacted');
  await row.locator('textarea').fill('تواصلنا وحددنا موعدًا');
  await submit(m, row.getByRole('button', { name: 'حفظ' }));
  assert.equal(sql(`select status from mentorship_requests where assigned_to='${MENTOR}'`), 'contacted');
});

test('المستخدم يسحب طلبه فتُحذف بياناته، وإيقاف الاستقبال يُخفي النموذج', async () => {
  await user.goto(`${BASE}/support`);
  await submit(user, user.getByRole('button', { name: 'اسحب طلبي واحذف بياناتي' }));
  assert.match(await toast(user), /سُحب طلبك/);
  assert.equal(sql(`select count(*) from mentorship_requests r join auth.users u on u.id=r.user_id where u.email='${USER}'`), '0');
  await mgr.goto(`${BASE}/admin/settings`);
  await mgr.getByLabel('استقبال طلبات المتابعة مفتوح').uncheck();
  await submit(mgr, mgr.getByRole('button', { name: 'حفظ الإعدادات' }));
  await user.goto(`${BASE}/support`);
  assert.match(await text(user), /استقبال الطلبات متوقف مؤقتًا/);
  assert.equal(await user.getByRole('button', { name: 'أرسل الطلب' }).count(), 0);
});
