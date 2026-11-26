// امتحان آخر المسار في متصفح حقيقي (هاتف 390px). تتطلب: dev/stack.sh وdev/serve.sh والهجرة 15.
// الاستخدام: node --test --test-concurrency=1 tests/exam.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
const slug = `exam-e2e-${run}`;
let browser, p, enr, examStep;

before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const [matId, matSlug] = sql(`select id||'|'||slug from materials where status='published' and type='article' order by created_at limit 1`).split('|');
  // مسار منشور بخطوة قراءة ثم امتحان من 5 أسئلة (الإجابة الصحيحة «صحيح» دائمًا)
  sql(`
    with p as (insert into paths (slug) values ('${slug}') returning id),
         v as (insert into path_versions (path_id, title, duration_days) select id, 'مسار امتحان ${run}', 3 from p returning id, path_id),
         s1 as (insert into steps (version_id, position, type, title) select id, 1, 'read', 'اقرأ' from v returning id),
         s2 as (insert into steps (version_id, position, type, title) select id, 2, 'exam', 'الامتحان' from v returning id)
    insert into exam_questions (step_id, position, prompt, options, correct_index, explanation, material_id)
    select s2.id, g, 'سؤال رقم ' || g, '["صحيح","خطأ","ربما"]', 0, 'شرح السؤال ' || g, '${matId}' from s2, generate_series(1,5) g;
    update path_versions set status='published', published_at=now() where path_id=(select id from paths where slug='${slug}');
    update paths set status='published' where slug='${slug}';
  `);
  void matSlug;
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  await c.addCookies([{ name: 'mock_user', value: `exam-${run}@y.test`, domain: 'localhost', path: '/' }]);
  p = await c.newPage();
  await p.goto(`${BASE}/login?next=%2Fjourney`);
  await p.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/journey'));
});
after(async () => { await browser.close(); });

const submit = async (loc) => { await Promise.all([p.waitForLoadState('load'), loc.click()]); await p.waitForLoadState(); };
async function answerAll(choice) {
  for (let i = 0; i < 5; i++) {
    const q = p.locator('fieldset.exam-q:not([hidden])');
    assert.match(await p.locator('[data-exam-count]').innerText(), new RegExp(`السؤال ${i + 1} من 5`));
    await q.locator('label.choice', { hasText: choice }).click();
    if (i < 4) await p.getByRole('button', { name: 'التالي' }).click();
  }
  await submit(p.getByRole('button', { name: 'أرسل الإجابات' }));
}

test('الطريق ينتهي بالامتحان، وبدايته تعرض المطلوب', async () => {
  await p.goto(`${BASE}/paths/${slug}`);
  await submit(p.getByRole('button', { name: 'ابدأ هذا المسار' }));
  enr = p.url().match(/journey\/paths\/([0-9a-f-]{36})/)[1];
  examStep = sql(`select s.id from steps s join enrollments e on e.version_id=s.version_id where e.id='${enr}' and s.type='exam'`);
  assert.equal(await p.locator('.rn .dot-exam').count(), 1, 'عقدة الامتحان في الطريق');
  await p.goto(`${BASE}/journey/paths/${enr}/steps/${examStep}`);
  const t = await p.locator('main').innerText();
  assert.match(t, /امتحان قصير، ثم تكمل المسار/);
  assert.match(t, /4 إجابات صحيحة/, '70% من 5 = 4');
  assert.equal(await p.getByRole('button', { name: 'أنهيت، التالي' }).count(), 0, 'لا إكمال يدوي للامتحان');
});

test('الإجابات لا تُكشف أثناء الامتحان، والخطأ يعرض المراجعة', async () => {
  await p.getByRole('link', { name: 'ابدأ' }).click();
  await p.waitForURL(/go=1/);
  assert.doesNotMatch(await p.content(), /شرح السؤال|correct_index/, 'لا شرح ولا مفتاح في الصفحة');
  await answerAll('خطأ');
  assert.match(p.url(), /result=[0-9a-f-]{36}/);
  const t = await p.locator('main').innerText();
  assert.match(t, /0 من 5/);
  assert.match(t, /قريب\. تحتاج 4 لتكمل المسار/);
  assert.match(t, /الصحيحة: صحيح/);
  assert.match(t, /شرح السؤال 1/);
  assert.match(t, /راجع:/);
  assert.notEqual(sql(`select coalesce((select state::text from enrollment_steps where enrollment_id='${enr}' and step_id='${examStep}'),'')`), 'completed');
});

test('إعادة المحاولة والنجاح يكملان الخطوة والمسار', async () => {
  await submit(p.getByRole('link', { name: 'أعد المحاولة' }));
  await answerAll('صحيح');
  const t = await p.locator('main').innerText();
  assert.match(t, /5 من 5/);
  assert.match(t, /أكملت المسار/);
  assert.equal(sql(`select state from enrollment_steps where enrollment_id='${enr}' and step_id='${examStep}'`), 'completed');
  assert.equal(sql(`select count(*) from exam_attempts a join auth.users u on u.id=a.user_id where u.email='exam-${run}@y.test'`), '2');
});

test('محاولة شخص آخر لا تُقرأ', async () => {
  const aid = sql(`select a.id from exam_attempts a join auth.users u on u.id=a.user_id where u.email='exam-${run}@y.test' limit 1`);
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  await c.addCookies([{ name: 'mock_user', value: `other-${run}@y.test`, domain: 'localhost', path: '/' }]);
  const o = await c.newPage();
  await o.goto(`${BASE}/login?next=%2Fjourney`);
  await o.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await o.waitForURL((u) => u.pathname.startsWith('/journey'));
  const r = await o.goto(`${BASE}/journey/paths/${enr}/steps/${examStep}?result=${aid}`);
  assert.equal(r.status(), 404);
});
