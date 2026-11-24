// «اختبر فهمك» والنقاط في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/quiz.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
let browser, matId, slug;
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  [matId, slug] = sql(`select id||'|'||slug from materials where status='published' and type='article' order by created_at limit 1`).split('|');
});
after(async () => { await browser.close(); });

async function as(email, role) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  if (!email) return c.newPage();
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const p = await c.newPage();
  await p.goto(`${BASE}/login?next=%2Fjourney`);
  await p.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/journey'));
  if (role) sql(`insert into staff_roles (user_id,email,role) select id,email,'${role}' from auth.users where email='${email}' on conflict do nothing`);
  return p;
}
const submit = async (p, loc) => { await Promise.all([p.waitForLoadState('load'), loc.click()]); await p.waitForLoadState(); };
const toast = async (p) => (await p.locator('.toast').first().innerText()).trim();
const Q = `سؤال اختبار ${run}`;
let qid;

test('المحرر يضيف سؤالًا بخياراته وشرحه، والخيار الواحد مرفوض', async () => {
  const ed = await as(`quiz-ed-${run}@admin.test`, 'editor');
  await ed.goto(`${BASE}/admin/materials/${matId}#questions`);
  await ed.fill('#q-prompt', 'سؤال ناقص');
  await ed.fill('#q-options', 'خيار وحيد');
  await submit(ed, ed.getByRole('button', { name: 'أضف السؤال' }));
  assert.match(await toast(ed), /الخيارات/);
  await ed.fill('#q-prompt', Q);
  await ed.fill('#q-options', 'الأول\nالثاني\nالثالث');
  await ed.selectOption('#q-correct', '2');
  await ed.fill('#q-exp', 'لأن الثاني هو الصواب');
  await submit(ed, ed.getByRole('button', { name: 'أضف السؤال' }));
  assert.match(await toast(ed), /أُضيف السؤال/);
  qid = sql(`select id from material_questions where prompt='${Q}'`);
  assert.equal(sql(`select correct_index||':'||jsonb_array_length(options) from material_questions where id='${qid}'`), '1:3');
});

test('الزائر يجيب خطأً: يرى الصحيحة والشرح، ولا يُحفظ شيء', async () => {
  const v = await as(null);
  await v.goto(`${BASE}/library/${slug}`);
  const f = v.locator(`#q-${qid}`);
  await f.getByLabel('الأول').check();
  await submit(v, f.getByRole('button', { name: 'تحقّق' }));
  const t = await v.locator(`#q-${qid}`).innerText();
  assert.match(t, /ليست هذه/); assert.match(t, /لأن الثاني هو الصواب/);
  assert.equal(await v.locator(`#q-${qid} label.is-right`).innerText(), 'الثاني');
  assert.equal(sql(`select count(*) from quiz_attempts where question_id='${qid}'`), '0');
});

test('المستخدم يجيب صوابًا فتُحفظ إجابته الأولى ويكسب نقاطًا وسلسلة', async () => {
  const email = `quizzer-${run}@y.test`;
  const u = await as(email);
  await u.goto(`${BASE}/library/${slug}`);
  await u.locator(`#q-${qid}`).getByLabel('الثاني').check();
  await submit(u, u.locator(`#q-${qid}`).getByRole('button', { name: 'تحقّق' }));
  assert.match(await u.locator(`#q-${qid}`).innerText(), /إجابة صحيحة/);
  const uid = sql(`select id from auth.users where email='${email}'`);
  assert.equal(sql(`select correct from quiz_attempts where user_id='${uid}' and question_id='${qid}'`), 't');
  // إعادة الإجابة (خطأً) لا تغيّر المحسوب
  await u.goto(`${BASE}/library/${slug}`);
  await u.locator(`#q-${qid}`).getByLabel('الثالث').check();
  await submit(u, u.locator(`#q-${qid}`).getByRole('button', { name: 'تحقّق' }));
  assert.equal(sql(`select correct from quiz_attempts where user_id='${uid}' and question_id='${qid}'`), 't');
  await u.goto(`${BASE}/journey`);
  const t = await u.locator('main').innerText();
  assert.match(t, /5\s*نقطة/); assert.match(t, /1\s*يوم متتالٍ/); assert.match(t, /أنجزت شيئًا اليوم/);
});

test('حذف السؤال من اللوحة يُخفيه من صفحة المادة', async () => {
  const ed = await as(`quiz-ed2-${run}@admin.test`, 'editor');
  await ed.goto(`${BASE}/admin/materials/${matId}#questions`);
  await submit(ed, ed.locator('#questions li.adm-row', { hasText: Q }).getByRole('button', { name: 'حذف' }));
  const v = await as(null); await v.goto(`${BASE}/library/${slug}`);
  assert.equal(await v.locator(`#q-${qid}`).count(), 0);
});
