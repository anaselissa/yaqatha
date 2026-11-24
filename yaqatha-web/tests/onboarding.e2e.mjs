// «من أين أبدأ؟» في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/onboarding.e2e.mjs
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
const page = async () => (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' })).newPage();
const submit = async (p, loc) => { await Promise.all([p.waitForLoadState('load'), loc.click()]); await p.waitForLoadState(); };

test('الرئيسية تقود إلى «من أين أبدأ؟»، وفيها تعريف قصير وثلاثة أسئلة', async () => {
  const p = await page();
  await p.goto(BASE);
  await submit(p, p.getByRole('link', { name: 'لا أعرف من أين أبدأ' }));
  assert.match(p.url(), /\/start$/);
  const t = await p.locator('main').innerText();
  assert.match(t, /يقظة رفيقك في التغيير/); assert.match(t, /ما الذي يشغلك أكثر هذه الأيام؟/);
  assert.equal(await p.locator('fieldset.onb-q').count(), 3);
  assert.match(t, /لا نحفظ إجاباتك/);
});

test('الاختيارات تقترح الاحتياج الأرجح مع مساره، ولا تُحفظ', async () => {
  sql(`update needs set status='published' where slug='anger-control'`);
  const before = sql(`select count(*) from audit_log`);
  const p = await page();
  await p.goto(`${BASE}/start`);
  await p.getByLabel('غضبي أو أخلاقي مع الناس').check();
  await p.getByLabel('أحافظ عليها والحمد لله').check();
  await submit(p, p.getByRole('button', { name: 'اقترح عليّ بداية' }));
  assert.match(p.url(), /\/start\/result\?/);
  const title = sql(`select title from needs where slug='anger-control'`);
  assert.equal((await p.locator('h1').innerText()).trim(), title);
  assert.ok(await p.getByRole('link', { name: new RegExp(`كل ما يخص «${title}»`) }).count());
  assert.equal(sql(`select count(*) from audit_log`), before, 'لا كتابة في القاعدة');
});

test('احتياج غير منشور لا يُقترح، ويُقترح الأرجح التالي', async () => {
  sql(`update needs set status='draft' where slug='anger-control'`);
  sql(`update needs set status='published' where slug='adhkar-and-worship'`);
  const p = await page();
  await p.goto(`${BASE}/start`);
  await p.getByLabel('غضبي أو أخلاقي مع الناس').check();
  await p.getByLabel('أحافظ عليها والحمد لله').check();
  await submit(p, p.getByRole('button', { name: 'اقترح عليّ بداية' }));
  assert.equal((await p.locator('h1').innerText()).trim(), sql(`select title from needs where slug='adhkar-and-worship'`));
  sql(`update needs set status='published' where slug='anger-control'`);
});

test('المحرر يضيف خيارًا ويُخفي سؤالًا من اللوحة', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const email = `onb-${run}@admin.test`;
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const ed = await c.newPage();
  await ed.goto(`${BASE}/login?next=%2Fjourney`);
  await ed.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await ed.waitForURL(/journey/);
  sql(`insert into staff_roles (user_id,email,role) select id,email,'editor' from auth.users where email='${email}' on conflict do nothing`);
  await ed.goto(`${BASE}/admin/onboarding`);
  const q1 = ed.locator('section', { hasText: 'ما الذي يشغلك أكثر هذه الأيام؟' }).first();
  await q1.getByText('+ أضف خيارًا').click();
  await q1.locator('input[name="label"]').fill(`خيار جديد ${run}`);
  await q1.locator('select[name="need_id"]').selectOption({ label: sql(`select title from needs where slug='anger-control'`) });
  await submit(ed, q1.getByRole('button', { name: 'أضف', exact: true }));
  const p = await page(); await p.goto(`${BASE}/start`);
  assert.equal(await p.getByLabel(`خيار جديد ${run}`).count(), 1);
  await ed.goto(`${BASE}/admin/onboarding`);
  const q3 = ed.locator('section', { hasText: 'ما الذي تحتاجه أكثر الآن؟' }).first();
  assert.equal(await q3.getByRole('button', { name: 'أخفِ السؤال' }).count(), 1);
  await Promise.all([ed.waitForNavigation(), q3.locator('form[action$="onb-question-status"]').evaluate((f) => f.submit())]);
  const p2 = await page(); // متصفح جديد: الصفحات العامة تُخدم بـ stale-while-revalidate
  await p2.goto(`${BASE}/start`);
  assert.equal(await p2.locator('fieldset.onb-q').count(), 2);
  sql(`update onboarding_questions set status='published'; delete from onboarding_options where label like 'خيار جديد %'`);
});

test('النتيجة بلا اختيارات تعيد إلى الأسئلة', async () => {
  const p = await page();
  await p.goto(`${BASE}/start/result`);
  assert.match(p.url(), /\/start$/);
});
