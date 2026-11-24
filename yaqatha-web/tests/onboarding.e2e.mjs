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
// سؤال في كل شاشة: اختيار الإجابة ينقل للتالي، ونتخطى الباقي حتى تظهر النتيجة
async function answer(p, labels) {
  for (const l of labels) {
    await p.locator('.onb-step:not([hidden]) label.choice', { hasText: l }).click();
    await p.waitForTimeout(350);
  }
  for (let i = 0; i < 6 && !/\/start\/result/.test(p.url()); i++) {
    const skip = p.locator('.onb-step:not([hidden]) [data-onb-skip]');
    if (!(await skip.count())) break;
    await skip.click(); await p.waitForTimeout(350);
  }
  await p.waitForURL(/\/start\/result/); await p.waitForLoadState();
}

test('الرئيسية تقود إلى «من أين أبدأ؟»: سؤال الفرع أولًا، ثم أسئلة الفرع المختار', async () => {
  const p = await page();
  await p.goto(BASE);
  await submit(p, p.getByRole('link', { name: 'ابدأ رحلتك' }));
  assert.match(p.url(), /\/start$/);
  let t = await p.locator('main').innerText();
  assert.match(t, /ما الذي جاء بك اليوم؟/); assert.match(t, /1 من 4/);
  assert.equal(await p.locator('.onb-step').count(), 0, 'لا أسئلة قبل اختيار الفرع');
  await submit(p, p.getByRole('link', { name: 'أريد أن أُصلح شيئًا في نفسي' }));
  assert.match(p.url(), /\/start\?b=fix/);
  t = await p.locator('main').innerText();
  assert.match(t, /ما الذي يشغلك أكثر هذه الأيام؟/); assert.match(t, /إجاباتك لا تُحفظ/); assert.match(t, /2 من 4/);
  assert.equal(await p.locator('.onb-step').count(), 3);
  assert.equal(await p.locator('.onb-step:not([hidden])').count(), 1, 'سؤال واحد في كل شاشة');
  assert.doesNotMatch(t, /ما الخير الذي تحب أن تزيد منه؟/);
});

test('فرع «أزداد من الخير» له أسئلته، ويقترح السنن والنوافل', async () => {
  sql(`update needs set status='published' where slug='revive-sunnah'`);
  const p = await page();
  await p.goto(`${BASE}/start`);
  await submit(p, p.getByRole('link', { name: 'أريد أن أتقرّب إلى الله أكثر' }));
  const t = await p.locator('main').innerText();
  assert.match(t, /ما الخير الذي تحب أن تزيد منه؟/); assert.doesNotMatch(t, /ما الذي يشغلك/);
  await answer(p, [/السنن والنوافل/, 'أحافظ عليها والحمد لله']);
  assert.equal((await p.locator('h1').innerText()).trim(), 'أريد أن أُحيي السنن والنوافل');
  assert.equal(await p.locator('a.back-btn[href="/start"]').count(), 1, 'رجوع إلى الأسئلة');
  sql(`update needs set status='draft' where slug='revive-sunnah'`);
});

test('الفرائض قبل النوافل: من يقصّر يُقترح عليه المحافظة على الصلاة', async () => {
  sql(`update needs set status='published' where slug in ('revive-sunnah','prayer-consistency')`);
  const p = await page();
  await p.goto(`${BASE}/start?b=grow`);
  await answer(p, [/السنن والنوافل/, 'أحافظ غالبًا، وأحيانًا أقصّر', 'رفقة تعينني']);
  // 3 (السنن) مقابل 2 (الصلاة): السنن أولًا، والصلاة في «قد يهمك أيضًا»
  assert.equal((await p.locator('h1').innerText()).trim(), 'أريد أن أُحيي السنن والنوافل');
  assert.match(await p.locator('main').innerText(), new RegExp(sql(`select title from needs where slug='prayer-consistency'`)));
  sql(`update needs set status='draft' where slug='revive-sunnah'`);
});

test('الاختيارات تقترح الاحتياج الأرجح مع مساره، ولا تُحفظ', async () => {
  sql(`update needs set status='published' where slug='anger-control'`);
  const before = sql(`select count(*) from audit_log`);
  const p = await page();
  await p.goto(`${BASE}/start?b=fix`);
  await answer(p, ['غضبي أو أخلاقي مع الناس', 'أحافظ عليها والحمد لله']);
  assert.match(p.url(), /\/start\/result\?/);
  const title = sql(`select title from needs where slug='anger-control'`);
  assert.equal((await p.locator('h1').innerText()).trim(), 'طريقك جاهز');
  assert.match(await p.locator('main').innerText(), new RegExp(`اخترناه لك من إجاباتك: ${title}`));
  assert.equal(await p.getByRole('button', { name: 'ابدأ الآن' }).count(), 1, 'زر واحد للبدء');
  assert.equal(sql(`select count(*) from audit_log`), before, 'لا كتابة في القاعدة');
});

test('احتياج غير منشور لا يُقترح، ويُقترح الأرجح التالي', async () => {
  sql(`update needs set status='draft' where slug='anger-control'`);
  sql(`update needs set status='published' where slug='adhkar-and-worship'`);
  const p = await page();
  await p.goto(`${BASE}/start?b=fix`);
  await answer(p, ['غضبي أو أخلاقي مع الناس', 'أحافظ عليها والحمد لله']);
  const main = await p.locator('main').innerText();
  assert.match(main, new RegExp(sql(`select title from needs where slug='adhkar-and-worship'`)));
  assert.doesNotMatch(main, new RegExp(sql(`select title from needs where slug='anger-control'`)));
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
  const q1 = ed.locator('section[id^="q-"]', { hasText: 'ما الذي يشغلك أكثر هذه الأيام؟' });
  await q1.getByText('+ أضف خيارًا').click();
  await q1.locator('input[name="label"]').fill(`خيار جديد ${run}`);
  await q1.locator('select[name="need_id"]').selectOption({ label: sql(`select title from needs where slug='anger-control'`) });
  await submit(ed, q1.getByRole('button', { name: 'أضف', exact: true }));
  const p = await page(); await p.goto(`${BASE}/start?b=fix`);
  assert.equal(await p.getByLabel(`خيار جديد ${run}`).count(), 1);
  await ed.goto(`${BASE}/admin/onboarding`);
  const q3 = ed.locator('section[id^="q-"]', { hasText: 'ما الذي تحتاجه أكثر الآن؟' });
  assert.equal(await q3.getByRole('button', { name: 'أخفِ السؤال' }).count(), 1);
  await Promise.all([ed.waitForNavigation(), q3.locator('form[action$="onb-question-status"]').evaluate((f) => f.submit())]);
  const p2 = await page(); // متصفح جديد: الصفحات العامة تُخدم بـ stale-while-revalidate
  await p2.goto(`${BASE}/start?b=fix`);
  assert.equal(await p2.locator('.onb-step').count(), 2);
  sql(`update onboarding_questions set status='published'; delete from onboarding_options where label like 'خيار جديد %'`);
});

test('المحرر يضيف سؤالًا لفرع «أزداد» فيظهر فيه وحده', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const email = `onb2-${run}@admin.test`;
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const ed = await c.newPage();
  await ed.goto(`${BASE}/login?next=%2Fjourney`);
  await ed.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await ed.waitForURL(/journey/);
  sql(`insert into staff_roles (user_id,email,role) select id,email,'editor' from auth.users where email='${email}' on conflict do nothing`);
  await ed.goto(`${BASE}/admin/onboarding`);
  const grow = ed.locator('#b-grow');
  await grow.getByText('+ أضف سؤالًا لهذا الفرع').click();
  await grow.locator('input[name="prompt"]').fill(`سؤال جديد ${run}`);
  await submit(ed, grow.getByRole('button', { name: 'أضف السؤال' }));
  assert.equal(sql(`select branch from onboarding_questions where prompt='سؤال جديد ${run}'`), 'grow');
  assert.equal(await ed.locator('#b-grow').getByText(`سؤال جديد ${run}`).count(), 1);
  assert.equal(await ed.locator('#b-fix').getByText(`سؤال جديد ${run}`).count(), 0);
  sql(`delete from onboarding_questions where prompt like 'سؤال جديد %'`);
});

test('النتيجة بلا اختيارات تعيد إلى الأسئلة', async () => {
  const p = await page();
  await p.goto(`${BASE}/start/result`);
  assert.match(p.url(), /\/start$/);
});
