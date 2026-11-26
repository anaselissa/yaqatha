// رفع المحتوى بالجملة في متصفح حقيقي. تتطلب: dev/stack.sh وdev/serve.sh والهجرة 17.
// الاستخدام: node --test --test-concurrency=1 tests/import.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
let browser, ed;

const q = (n, c = 0) => ({ prompt: `سؤال ${n}`, options: ['أ', 'ب', 'ج'], correct_index: c });
const good = {
  format: 'yaqatha-content/1',
  path: {
    slug: `imp-${run}`, title: `مسار مرفوع ${run}`, level: 'intro', change_type: 'perform_duty', duration_days: 3,
    needs: ['prayer-consistency'], domain: 'worship',
    steps: [{ type: 'read', title: 'اقرأ', materials: [`imp-${run}-a`] }, { type: 'exercise', title: 'طبّق', materials: [`imp-${run}-b`] }],
    exam_questions: [q(1), q(2), q(3), q(4), q(5, 2)],
    next_paths: [{ slug: `imp-${run}-later`, kind: 'next_level' }],
  },
  materials: [
    { slug: `imp-${run}-a`, title: 'لماذا', type: 'article', body: 'نص', review_note: 'تحقق من التخريج', questions: [q(9)] },
    { slug: `imp-${run}-b`, title: 'كيف', type: 'exercise', body: 'نص' },
  ],
};
const bad = { format: 'yaqatha-content/1', path: { ...good.path, slug: `imp-${run}-bad`, exam_questions: [q(1), q(2), q(3)] }, materials: [] };

before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const email = `imp-ed-${run}@admin.test`;
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  ed = await c.newPage();
  await ed.goto(`${BASE}/login?next=%2Fjourney`);
  await ed.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await ed.waitForURL((u) => u.pathname.startsWith('/journey'));
  sql(`insert into staff_roles (user_id,email,role) select id,email,'editor' from auth.users where email='${email}' on conflict do nothing`);
});
after(async () => { await browser.close(); });

const submit = async (loc) => { await Promise.all([ed.waitForLoadState('load'), loc.click()]); await ed.waitForLoadState(); };
const file = (name, obj) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });

test('الفحص: يعرض الجاهز والملاحظات والأخطاء، ولا يغيّر شيئًا', async () => {
  await ed.goto(`${BASE}/admin/import`);
  await ed.locator('input[type=file]').setInputFiles([file('01-good.json', good), file('02-bad.json', bad), { name: '03-broken.json', mimeType: 'application/json', buffer: Buffer.from('{ مكسور') }]);
  await submit(ed.getByRole('button', { name: 'افحص الملفات' }));
  const t = await ed.locator('main').innerText();
  assert.match(t, /نتيجة الفحص/);
  assert.match(t, new RegExp(`مسار مرفوع ${run}`));
  assert.match(t, /تمهيدي/);
  assert.match(t, /يُربط حين يُرفع/, 'المسار التالي المعلّق');
  assert.match(t, /الامتحان يحتاج من 5 إلى 10 أسئلة/);
  assert.match(t, /ليس JSON صالحًا/);
  assert.equal(sql(`select count(*) from paths where slug like 'imp-${run}%'`), '0', 'الفحص لا يكتب');
  assert.equal(sql(`select count(*) from materials where slug like 'imp-${run}%'`), '0');
  assert.match(await ed.getByRole('button', { name: /ارفع ملفًا واحدًا كمسودات/ }).innerText(), /ملفًا واحدًا/);
});

test('الرفع: مسودات، والامتحان آخر خطوة، والمستوى، وملاحظة المراجع', async () => {
  await submit(ed.getByRole('button', { name: /كمسودات/ }));
  const t = await ed.locator('main').innerText();
  assert.match(t, /رُفع ملف واحد كمسودات/);
  assert.equal(sql(`select status from paths where slug='imp-${run}'`), 'draft');
  assert.equal(sql(`select string_agg(status::text, ',') from materials where slug like 'imp-${run}-%'`), 'draft,draft');
  assert.equal(sql(`select string_agg(s.type::text, ',' order by s.position) from steps s join path_versions v on v.id=s.version_id join paths p on p.id=v.path_id where p.slug='imp-${run}'`), 'read,exercise,exam');
  assert.equal(sql(`select level from path_versions v join paths p on p.id=v.path_id where p.slug='imp-${run}'`), 'intro');
  assert.equal(sql(`select internal_note from content_review cr join materials m on m.id=cr.entity_id where m.slug='imp-${run}-a'`), 'تحقق من التخريج');
  await submit(ed.getByRole('link', { name: /راجع/ }).first());
  assert.match(ed.url(), /\/admin\/paths\/[0-9a-f-]{36}/);
  assert.match(await ed.locator('main').innerText(), /5 أسئلة · جاهز للنشر/);
});

test('غير الفريق لا يصل لصفحة الرفع', async () => {
  const c = await browser.newContext();
  await c.addCookies([{ name: 'mock_user', value: `imp-user-${run}@y.test`, domain: 'localhost', path: '/' }]);
  const p = await c.newPage();
  const r = await p.goto(`${BASE}/admin/import`);
  assert.ok(r.status() !== 200 || !/\/admin\/import/.test(p.url()), 'لا وصول');
  assert.equal(await p.locator('input[type=file]').count(), 0);
});
