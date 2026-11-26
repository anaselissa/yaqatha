// أدوات المحرر (الهجرة 18): رئيسية المراقبة، الاحتياجات، واجهة الموقع، المعاينة. تتطلب: dev/stack.sh وdev/serve.sh
// الاستخدام: node --test --test-concurrency=1 tests/editor.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
let browser, mgr, edt;

async function as(email, role) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const p = await c.newPage();
  await p.goto(`${BASE}/login?next=%2Fjourney`);
  await p.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/journey'));
  if (role) sql(`insert into staff_roles (user_id,email,role) select id,email,'${role}' from auth.users where email='${email}' on conflict (user_id) do update set role='${role}'`);
  return p;
}
const submit = async (p, loc) => { await Promise.all([p.waitForLoadState('load'), loc.click()]); await p.waitForLoadState(); };
const toast = async (p) => (await p.locator('.toast').first().innerText()).trim();
const anonText = async (url) => { const p = await (await browser.newContext()).newPage(); await p.goto(BASE + url); return p.locator('body').innerText(); };

before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  mgr = await as(`ed-mgr-${run}@admin.test`, 'manager');
  edt = await as(`ed-edt-${run}@admin.test`, 'editor');
});
after(async () => { await browser.close(); });

test('رئيسية اللوحة: ما يحتاج انتباهك، والأقسام مجمّعة', async () => {
  await mgr.goto(`${BASE}/admin`);
  const t = await mgr.locator('main').innerText();
  assert.match(t, /يحتاج انتباهك/);
  for (const g of ['المحتوى', 'التصنيف', 'واجهة الموقع', 'المتابعة', 'الإدارة']) assert.match(t, new RegExp(g));
  await edt.goto(`${BASE}/admin`);
  assert.doesNotMatch(await edt.locator('.adm-groups').innerText(), /الصفحات النصية|الفريق/, 'المحرر لا يرى أقسام المدير');
});

test('الاحتياجات: تعديل العبارة، وإضافة احتياج مسودة', async () => {
  const id = sql(`select id from needs where slug='anger-control'`);
  const old = sql(`select title from needs where id='${id}'`);
  await edt.goto(`${BASE}/admin/taxonomy`);
  const row = edt.locator(`#n-${id}`);
  await row.locator('summary').first().click();
  await row.locator('input[name="title"]').fill(`${old} ${run}`);
  await submit(edt, row.getByRole('button', { name: 'حفظ' }));
  assert.match(await toast(edt), /حُفظ الاحتياج/);
  assert.equal(sql(`select title from needs where id='${id}'`), `${old} ${run}`);
  sql(`update needs set title='${old.replace(/'/g, "''")}' where id='${id}'`);
  const door = sql(`select id from doors order by sort_order limit 1`);
  await edt.goto(`${BASE}/admin/taxonomy`);
  await edt.locator('summary', { hasText: '+ احتياج جديد' }).first().click();
  await edt.fill(`#new-n-${door}`, `أريد أن أجرّب ${run}`);
  await submit(edt, edt.getByRole('button', { name: 'أضف (مسودة)' }).first());
  assert.equal(sql(`select status from needs where title='أريد أن أجرّب ${run}'`), 'draft');
  sql(`delete from needs where title='أريد أن أجرّب ${run}'`);
});

test('«أحسنت» ونصيحة اليوم: المحرر يضيف، والمستخدم يرى النصيحة', async () => {
  await edt.goto(`${BASE}/admin/site/cheers`);
  await edt.locator('summary', { hasText: 'جديدة' }).click();
  await edt.fill('#new-t', `عبارة ${run}`);
  await edt.fill('#new-s', 'مصدر');
  await submit(edt, edt.getByRole('button', { name: 'أضف' }));
  assert.equal(sql(`select status from cheers where text='عبارة ${run}'`), 'published');
  sql(`delete from cheers where text='عبارة ${run}'`);

  sql(`delete from daily_tips`);
  await edt.goto(`${BASE}/admin/site/tips`);
  await edt.fill('#new-t', `نصيحة ${run}`);
  await submit(edt, edt.getByRole('button', { name: 'أضف' }));
  await edt.goto(`${BASE}/`);
  assert.match(await edt.locator('main').innerText(), new RegExp(`نصيحة اليوم\\s*نصيحة ${run}`));
  sql(`delete from daily_tips`);
});

test('روابط التواصل والصفحات النصية: للمدير فقط', async () => {
  assert.equal((await edt.goto(`${BASE}/admin/site/pages/about`)).status(), 404);
  assert.equal((await edt.goto(`${BASE}/admin/site/links`)).status(), 404);
  await mgr.goto(`${BASE}/admin/site/links`);
  await mgr.fill('#wa', 'https://chat.whatsapp.com/test');
  await submit(mgr, mgr.getByRole('button', { name: 'حفظ الروابط' }));
  assert.match(await toast(mgr), /حُفظت الروابط/);
  assert.match(await anonText('/about'), /قروب واتساب/);
  sql(`update app_settings set value='""' where key='community_whatsapp_url'`);

  await mgr.goto(`${BASE}/admin/site/pages/about`);
  await mgr.fill('#body', `## عنوان ${run}\n\nنص جديد للصفحة.`);
  await submit(mgr, mgr.getByRole('button', { name: 'معاينة' }));
  assert.match(await mgr.locator('main').innerText(), new RegExp(`معاينة \\(لم تُحفظ بعد\\)[\\s\\S]*عنوان ${run}`));
  assert.equal(sql(`select count(*) from site_pages`), '0', 'المعاينة لا تحفظ');
  await submit(mgr, mgr.getByRole('button', { name: 'حفظ' }));
  assert.match(await anonText('/about'), new RegExp(`عنوان ${run}`));
  sql(`delete from site_pages`);
  assert.match(await anonText('/about'), /ما نحرص عليه/, 'بلا صف: النص الافتراضي');
});

test('المعاينة: المسار المسودة وخطواته والامتحان، والمادة', async () => {
  const [pid] = sql(`select p.id from paths p join path_versions v on v.path_id=p.id and v.status='published' order by p.slug limit 1`).split('\n');
  await edt.goto(`${BASE}/admin/paths/${pid}/preview`);
  const t = await edt.locator('main').innerText();
  assert.match(t, /معاينة:/);
  assert.match(t, /الخطوات/);
  await submit(edt, edt.locator('.path-steps a').first());
  assert.match(await edt.locator('main').innerText(), /الخطوة 1 من/);
  const mid = sql(`select id from materials where status='draft' limit 1`) || sql(`select id from materials limit 1`);
  await edt.goto(`${BASE}/admin/materials/${mid}/preview`);
  assert.match(await edt.locator('.preview-bar').innerText(), /معاينة/);
  const v = await (await browser.newContext()).newPage();
  const r = await v.goto(`${BASE}/admin/materials/${mid}/preview`);
  assert.ok(r.status() !== 200 || !new URL(v.url()).pathname.includes('/preview'), 'الزائر لا يرى المعاينة');
  assert.equal(await v.locator('.preview-bar').count(), 0);
});
