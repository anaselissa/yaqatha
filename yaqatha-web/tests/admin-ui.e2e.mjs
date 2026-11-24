// لوحة الإدارة في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh (قاعدة + محاكي + موقع على :4321)
// الاستخدام: node --test --test-concurrency=1 tests/admin-ui.e2e.mjs
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
before(async () => { browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
after(async () => { await browser.close(); });

async function as(email) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  if (email) await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const page = await c.newPage();
  if (email) {
    await page.goto(`${BASE}/login?next=%2Fjourney`);
    await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/journey'));
  }
  return page;
}
const uid = (email) => sql(`select id from auth.users where email='${email}'`);
const makeStaff = (email, role) => sql(`insert into staff_roles (user_id,email,role) values ('${uid(email)}','${email}','${role}') on conflict (user_id) do update set role=excluded.role`);
const toast = async (page) => (await page.locator('.toast').first().innerText()).trim();
const ED = `editor-${run}@admin.test`, USR = `user-${run}@admin.test`;
let editor;

test('الزائر يُحوَّل إلى الدخول، والمستخدم العادي يرى 404', async () => {
  const anon = await as(null);
  await anon.goto(`${BASE}/admin/materials`);
  assert.match(anon.url(), /\/login\?next=%2Fadmin%2Fmaterials/);
  const user = await as(USR);
  const r = await user.goto(`${BASE}/admin`);
  assert.equal(r.status(), 404);
  assert.match(await user.locator('main').innerText(), /طريق غير نافذ/);
  await user.goto(`${BASE}/journey/settings`);
  assert.equal(await user.getByRole('link', { name: 'لوحة الإدارة' }).count(), 0, 'لا رابط إدارة لغير الفريق');
});

test('المحرر يدخل اللوحة من الإعدادات', async () => {
  editor = await as(ED);
  makeStaff(ED, 'editor');
  await editor.goto(`${BASE}/journey/settings`);
  await editor.getByRole('link', { name: 'لوحة الإدارة' }).click();
  await editor.waitForURL(`${BASE}/admin`);
  const t = await editor.locator('main').innerText();
  assert.match(t, /لوحة الإدارة/); assert.match(t, /محرر محتوى/); assert.match(t, /مادة منشورة/);
});

const TITLE = `مقال اختبار اللوحة ${run}`;
let matId, matSlug;

test('إضافة مقال كامل ونشره مباشرة يظهر للزائر', async () => {
  await editor.goto(`${BASE}/admin/materials/new`);
  await editor.selectOption('#type', 'article');
  await editor.fill('#title', TITLE);
  await editor.fill('#body', 'نص المقال **للاختبار**.');
  await editor.fill('#source_title', 'كتاب للاختبار');
  await editor.getByLabel('أريد أن أضبط غضبي وانفعالاتي').check();
  await editor.selectOption('#status', 'published');
  await editor.getByRole('button', { name: 'حفظ' }).click();
  await editor.waitForURL(/\/admin\/materials\/[0-9a-f-]{36}$/);
  assert.match(await toast(editor), /منشورة الآن/);
  matId = editor.url().split('/').pop();
  [matSlug] = sql(`select slug||'|'||status from materials where id='${matId}'`).split('|');
  assert.equal(sql(`select status from materials where id='${matId}'`), 'published');
  assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(matSlug), `رابط لاتيني مولَّد: ${matSlug}`);
  const pub = await (await as(null)).goto(`${BASE}/library/${matSlug}`);
  assert.equal(pub.status(), 200);
});

test('شروط النشر من القاعدة: بلا مصدر تُحفظ مسودة مع رسالة واضحة', async () => {
  await editor.goto(`${BASE}/admin/materials/new`);
  await editor.fill('#title', `بلا مصدر ${run}`);
  await editor.fill('#body', 'نص');
  await editor.getByLabel('أريد أن أضبط غضبي وانفعالاتي').check();
  await editor.selectOption('#status', 'published');
  await editor.getByRole('button', { name: 'حفظ' }).click();
  await editor.waitForURL(/\/admin\/materials\/[0-9a-f-]{36}$/);
  assert.match(await toast(editor), /لم تُنشر: أضف المصدر الأصلي/);
  assert.equal(sql(`select status from materials where title='بلا مصدر ${run}'`), 'draft');
});

test('الإخفاء من القائمة بنقرة، ثم يختفي عن الزائر ويبقى للفريق', async () => {
  await editor.goto(`${BASE}/admin/materials?q=${encodeURIComponent(TITLE)}`);
  const row = editor.locator('.adm-row', { hasText: TITLE });
  await row.getByRole('button', { name: 'إخفاء' }).click();
  await editor.waitForLoadState();
  assert.match(await toast(editor), /مخفية/);
  assert.equal(sql(`select status from materials where id='${matId}'`), 'hidden');
  const pub = await (await as(null)).goto(`${BASE}/library/${matSlug}`);
  assert.notEqual(pub.status(), 200);
  await editor.goto(`${BASE}/admin/materials/${matId}`);
  assert.equal(await editor.inputValue('#title'), TITLE);
});

test('التعديل المتزامن: لا يمسح حفظٌ قديم تعديل زميل', async () => {
  const other = await as(`editor2-${run}@admin.test`); makeStaff(`editor2-${run}@admin.test`, 'editor');
  await editor.goto(`${BASE}/admin/materials/${matId}`);
  await other.goto(`${BASE}/admin/materials/${matId}`);
  await other.fill('#title', `${TITLE} (زميل)`); await other.getByRole('button', { name: 'حفظ' }).click();
  await other.waitForLoadState();
  await new Promise((r) => setTimeout(r, 1100));
  await editor.fill('#description', 'تعديل متأخر'); await editor.getByRole('button', { name: 'حفظ' }).click();
  await editor.waitForLoadState();
  assert.match(await toast(editor), /عدّل أحد أعضاء الفريق/);
  assert.equal(sql(`select title from materials where id='${matId}'`), `${TITLE} (زميل)`);
});

test('يوتيوب: صفحة لصق الرابط، والرابط يُوحَّد، والرابط غير الصالح يُنبَّه عليه', async () => {
  await editor.goto(`${BASE}/admin/materials/new?type=video`);
  await editor.fill('#url', 'https://youtu.be/dQw4w9WgXcQ?si=abc');
  await editor.getByRole('button', { name: 'متابعة' }).click();
  await editor.waitForURL(/url=/);
  assert.equal(await editor.inputValue('#url'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(await editor.inputValue('#type'), 'video');
  await editor.goto(`${BASE}/admin/materials/new?type=video&url=${encodeURIComponent('https://example.com/x')}`);
  assert.match(await editor.locator('main').innerText(), /ليس رابط مقطع يوتيوب صالحًا/);
});

test('نشر احتياج وإخفاؤه من صفحة الاحتياجات يظهر في بابه', async () => {
  const need = 'أريد أن أتوب وأعود إلى الله';
  const original = sql(`select status from needs where slug='repentance'`);
  sql(`update needs set status='draft' where slug='repentance'`);
  await editor.goto(`${BASE}/admin/taxonomy`);
  await editor.locator('.adm-row', { hasText: need }).getByRole('button', { name: 'نشر' }).click();
  await editor.waitForLoadState();
  assert.equal(sql(`select status from needs where slug='repentance'`), 'published');
  const door = await as(null); await door.goto(`${BASE}/doors/closer-to-allah`);
  assert.match(await door.locator('main').innerText(), new RegExp(need));
  await editor.goto(`${BASE}/admin/taxonomy`);
  await editor.locator('.adm-row', { hasText: need }).getByRole('button', { name: 'إخفاء' }).click();
  await editor.waitForLoadState();
  assert.equal(sql(`select status from needs where slug='repentance'`), 'hidden');
  sql(`update needs set status='${original}' where slug='repentance'`); // لا نترك أثرًا على بيانات التطوير
});

test('مستخدم عادي يزوّر طلب إدارة: القاعدة ترفض ولا يُنشأ شيء', async () => {
  const user = await as(USR);
  await user.goto(`${BASE}/journey`);
  const status = await user.evaluate(async (t) => {
    const f = new FormData();
    Object.entries({ type: 'article', title: t, body: 'x', nature: 'original_source', status: 'draft', review_status: 'experimental' }).forEach(([k, v]) => f.set(k, v));
    return (await fetch('/api/admin/material-save', { method: 'POST', body: f })).status;
  }, `مزوّر ${run}`);
  assert.ok(status < 500, `بلا خطأ خادم: ${status}`);
  assert.equal(sql(`select count(*) from materials where title='مزوّر ${run}'`), '0');
});

test('الفريق: المدير يضيف عضوًا جديدًا وعضوًا مسجّلًا من قبل، والمحرر لا يرى الفريق', async () => {
  const MGR = `mgr-${run}@admin.test`, NEWB = `new-${run}@admin.test`;
  const mgr = await as(MGR); makeStaff(MGR, 'manager');
  // المحرر لا يرى تبويب الفريق ولا صفحته
  await editor.goto(`${BASE}/admin`);
  assert.equal(await editor.getByRole('link', { name: 'الفريق', exact: true }).count(), 0);
  assert.equal((await editor.goto(`${BASE}/admin/team`)).status(), 404);
  // إضافة شخص لم يسجّل بعد: يصبح محررًا بمجرد أول دخول
  await mgr.goto(`${BASE}/admin/team`);
  await mgr.fill('#email', NEWB.toUpperCase());
  await mgr.selectOption('#role', 'editor');
  await mgr.getByRole('button', { name: 'إضافة' }).click();
  await mgr.waitForLoadState();
  assert.match(await toast(mgr), /بمجرد دخوله/);
  assert.match(await mgr.locator('main').innerText(), new RegExp(NEWB));
  const nb = await as(NEWB);
  assert.equal((await nb.goto(`${BASE}/admin`)).status(), 200, 'الدعوة طُبّقت عند أول دخول');
  // إضافة مستخدم مسجّل من قبل: تُطبَّق عند زيارته اللوحة
  const user = await as(USR);
  assert.equal((await user.goto(`${BASE}/admin`)).status(), 404);
  await mgr.goto(`${BASE}/admin/team`);
  await mgr.fill('#email', USR); await mgr.selectOption('#role', 'manager');
  await mgr.getByRole('button', { name: 'إضافة' }).click(); await mgr.waitForLoadState();
  assert.equal((await user.goto(`${BASE}/admin`)).status(), 200);
  assert.equal(sql(`select role from staff_roles where email='${USR}'`), 'manager');
  // تغيير الدور ثم الإزالة
  await mgr.goto(`${BASE}/admin/team`);
  await mgr.locator('.adm-row', { hasText: USR }).getByRole('button', { name: 'اجعله محررًا' }).click(); await mgr.waitForLoadState();
  assert.equal(sql(`select role from staff_roles where email='${USR}'`), 'editor');
  await mgr.locator('.adm-row', { hasText: USR }).getByRole('button', { name: 'إزالة' }).click(); await mgr.waitForLoadState();
  assert.equal(sql(`select count(*) from staff_roles where email='${USR}'`), '0');
  assert.equal((await user.goto(`${BASE}/admin`)).status(), 404, 'بعد الإزالة لا يدخل');
});
