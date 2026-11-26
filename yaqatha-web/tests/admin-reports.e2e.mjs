// بلاغات الزوار على المواد في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/admin-reports.e2e.mjs
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

async function as(email, role) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
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
const NOTE = `الرابط لا يعمل ${run}`;
const slug = sql(`select slug from materials where status='published' order by slug limit 1`);
const title = sql(`select title from materials where slug='${slug}'`);
let ed;

test('مستخدم يبلّغ عن مشكلة في مادة', async () => {
  const u = await as(`reporter-${run}@y.test`);
  await u.goto(`${BASE}/library/${slug}`);
  await u.getByText('أبلغ عن مشكلة في هذه المادة').click();
  await u.fill('#note', NOTE);
  await submit(u, u.getByRole('button', { name: 'أرسل البلاغ' }));
  assert.equal(sql(`select count(*) from material_reports where note='${NOTE}' and status='open'`), '1');
});

test('المحرر يرى البلاغ بلا هوية المبلِّغ، مع رابط تعديل المادة', async () => {
  ed = await as(`reditor-${run}@admin.test`, 'editor');
  await ed.goto(`${BASE}/admin`);
  await ed.getByRole('link', { name: /بلاغ مفتوح/ }).click();
  await ed.waitForURL(/\/admin\/reports$/);
  const row = ed.locator('.adm-row', { hasText: NOTE });
  await row.waitFor();
  const t = await row.innerText();
  assert.ok(t.includes(title));
  assert.doesNotMatch(t, /reporter-/);
  const id = sql(`select id from materials where slug='${slug}'`);
  assert.equal(await row.getByRole('link', { name: 'عدّل المادة' }).getAttribute('href'), `/admin/materials/${id}`);
});

test('إغلاق البلاغ ثم إعادة فتحه', async () => {
  await submit(ed, ed.locator('.adm-row', { hasText: NOTE }).getByRole('button', { name: 'تمت المعالجة' }));
  assert.match(await toast(ed), /أُغلق البلاغ/);
  assert.equal(await ed.locator('.adm-row', { hasText: NOTE }).count(), 0);
  assert.equal(sql(`select status||':'||(resolved_by is not null)||':'||(resolved_at is not null) from material_reports where note='${NOTE}'`), 'resolved:true:true');
  await ed.goto(`${BASE}/admin/reports?status=resolved`);
  await submit(ed, ed.locator('.adm-row', { hasText: NOTE }).getByRole('button', { name: 'أعد فتحه' }));
  assert.equal(sql(`select status||':'||(resolved_by is null) from material_reports where note='${NOTE}'`), 'open:true');
});

test('غير الفريق لا يرى البلاغات (404) ولا يغيّر حالتها', async () => {
  const u = await as(`plain-${run}@y.test`);
  const r = await u.goto(`${BASE}/admin/reports`);
  assert.equal(r.status(), 404);
  const id = sql(`select id from material_reports where note='${NOTE}'`);
  const res = await u.request.post(`${BASE}/api/admin/report-status`, { form: { id, status: 'resolved' }, headers: { origin: BASE }, maxRedirects: 0 });
  assert.ok([303, 302].includes(res.status()));
  assert.equal(sql(`select status from material_reports where note='${NOTE}'`), 'open');
});
