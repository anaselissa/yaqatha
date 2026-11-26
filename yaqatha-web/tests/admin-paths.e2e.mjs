// لوحة الإدارة — محرر المسارات في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/admin-paths.e2e.mjs
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
before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const email = `paths-${run}@admin.test`;
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  ed = await c.newPage();
  await ed.goto(`${BASE}/login?next=%2Fjourney`);
  await ed.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await ed.waitForURL((u) => u.pathname.startsWith('/journey'));
  sql(`insert into staff_roles (user_id,email,role) select id,email,'editor' from auth.users where email='${email}' on conflict do nothing`);
});
after(async () => { await browser.close(); });

const stepRow = (t) => ed.locator('#steps > ol > li').filter({ has: ed.locator(':scope > details > summary > strong', { hasText: t }) });
const toast = async () => (await ed.locator('.toast').first().innerText()).trim();
const submit = async (loc) => { await Promise.all([ed.waitForLoadState('load'), loc.click()]); await ed.waitForLoadState(); };
const TITLE = `مسار اختبار ${run}`;
let pathId, slug;
const stepTitles = () => sql(`select string_agg(s.title, '|' order by s.position) from steps s join path_versions v on v.id=s.version_id where v.path_id='${pathId}' and v.status='draft'`);
const anon = async (url) => { const p = await (await browser.newContext()).newPage(); const r = await p.goto(BASE + url); return { status: r.status(), text: await p.locator('main').innerText() }; };

test('إنشاء مسار: يُنشأ الإصدار 1 مسودة ويُربط بالاحتياج', async () => {
  await ed.goto(`${BASE}/admin/paths/new`);
  await ed.fill('#title', TITLE);
  await ed.fill('#description', 'وصف المسار');
  await ed.fill('#duration_days', '3');
  await ed.getByLabel('أريد أن أضبط غضبي وانفعالاتي').check();
  await submit(ed.getByRole('button', { name: 'أنشئ المسار وانتقل إلى خطواته' }));
  assert.match(ed.url(), /\/admin\/paths\/[0-9a-f-]{36}#steps$/);
  pathId = ed.url().split('/').pop().split('#')[0];
  slug = sql(`select slug from paths where id='${pathId}'`);
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.equal(sql(`select version_no||':'||status||':'||duration_days from path_versions where path_id='${pathId}'`), '1:draft:3');
  assert.equal(sql(`select count(*) from path_needs pn join needs n on n.id=pn.need_id where path_id='${pathId}' and n.slug='anger-control'`), '1');
});

test('الخطوات: إضافة مع مادة، ترتيب، حذف', async () => {
  const mat = sql(`select id from materials where status='published' limit 1`);
  for (const [t, withMat] of [['الأولى', true], ['الثانية', false], ['الثالثة', false]]) {
    if (!(await ed.locator('#new-title').isVisible())) await ed.getByText('+ أضف خطوة').click();
    await ed.selectOption('#new-type', withMat ? 'watch' : 'reflection');
    await ed.fill('#new-title', t);
    if (withMat) await ed.selectOption('#new-mat', mat);
    await submit(ed.getByRole('button', { name: 'أضف الخطوة' }));
  }
  assert.equal(stepTitles(), 'الأولى|الثانية|الثالثة');
  assert.equal(sql(`select count(*) from step_materials sm join steps s on s.id=sm.step_id join path_versions v on v.id=s.version_id where v.path_id='${pathId}'`), '1');
  const third = stepRow('الثالثة');
  await third.locator('summary').click();
  await submit(third.getByRole('button', { name: 'حرّك لأعلى' }));
  assert.equal(stepTitles(), 'الأولى|الثالثة|الثانية');
  const second = stepRow('الثانية');
  await second.locator('summary').click();
  await submit(second.getByRole('button', { name: 'حذف الخطوة' }));
  assert.equal(stepTitles(), 'الأولى|الثالثة');
});

test('المستوى: لا نشر بدونه، ثم يختاره المحرر', async () => {
  await submit(ed.getByRole('button', { name: 'انشر المسار' }));
  assert.match(await toast(), /اختر مستوى المسار/);
  await ed.locator('summary', { hasText: 'بيانات الإصدار' }).click();
  await ed.locator('input[name="level"][value="basic"]').check();
  await submit(ed.locator('form[action="/api/admin/version-save"] button'));
  assert.match(await toast(), /حُفظت بيانات الإصدار/);
  assert.equal(sql(`select level from path_versions where path_id='${pathId}'`), 'basic');
});

test('الامتحان: لا نشر بدونه، ثم خطوة الامتحان وأسئلتها', async () => {
  await submit(ed.getByRole('button', { name: 'انشر المسار' }));
  assert.match(await toast(), /خطوة «الامتحان»/);
  await submit(ed.getByRole('button', { name: 'أضف خطوة الامتحان' }));
  assert.equal(stepTitles(), 'الأولى|الثالثة|الامتحان');
  for (let i = 1; i <= 5; i++) {
    if (!(await ed.locator('#eq-p').isVisible())) await ed.locator('summary', { hasText: '+ اكتب سؤالًا جديدًا' }).click();
    await ed.fill('#eq-p', `سؤال ${i}`);
    await ed.fill('#eq-o', 'صحيح\nخطأ');
    await ed.fill('#eq-c', '1');
    await submit(ed.getByRole('button', { name: 'أضف السؤال' }));
    assert.match(await toast(), /أُضيف السؤال/);
  }
  assert.equal(sql(`select count(*) from exam_questions q join steps s on s.id=q.step_id join path_versions v on v.id=s.version_id where v.path_id='${pathId}'`), '5');
  assert.match(await stepRow('الامتحان').locator(':scope > details > summary').innerText(), /جاهز للنشر/);
});

test('النشر: يظهر للزائر، والإصدار المنشور يقبل تصحيح النص فقط', async () => {
  await submit(ed.getByRole('button', { name: 'انشر المسار' }));
  assert.match(await toast(), /نُشر المسار/);
  const pub = await anon(`/paths/${slug}`);
  assert.equal(pub.status, 200); assert.match(pub.text, new RegExp(TITLE));
  assert.match(pub.text, /أساسي/, 'المستوى ظاهر للزائر');
  assert.equal(await ed.getByText('+ أضف خطوة').count(), 0, 'لا إضافة خطوات على المنشور');
  const first = stepRow('الأولى');
  await first.locator('summary').click();
  await first.locator('input[name="title"]').fill('الأولى (مصحّحة)');
  await submit(first.getByRole('button', { name: 'حفظ الخطوة' }));
  assert.match(await toast(), /حُفظت الخطوة/);
  assert.equal(sql(`select count(*) from steps s join path_versions v on v.id=s.version_id where v.path_id='${pathId}' and s.title='الأولى (مصحّحة)'`), '1');
});

test('المستوى للزائر: تصفية «المسارات»، و«بعده» من رابط المستوى التالي', async () => {
  assert.match((await anon('/paths?level=basic')).text, new RegExp(TITLE));
  assert.doesNotMatch((await anon('/paths?level=advanced')).text, new RegExp(TITLE));
  const other = sql(`select p.id||'|'||v.title from paths p join path_versions v on v.path_id=p.id and v.status='published' where p.status='published' and p.id<>'${pathId}' order by p.slug limit 1`).split('|');
  await ed.goto(`${BASE}/admin/paths/${pathId}#ending`);
  await ed.selectOption('#next', other[0]);
  await ed.selectOption('#next-kind', 'next_level');
  await submit(ed.locator('form[action="/api/admin/path-next-add"] button'));
  assert.match(await toast(), /أُضيف المستوى التالي/);
  assert.equal(sql(`select kind from path_next where path_id='${pathId}'`), 'next_level');
  const pub = await anon(`/paths/${slug}`);
  assert.match(pub.text, new RegExp(`بعده\\s*${other[1].replace(/[[\]]/g, '.')}`));
  sql(`delete from path_next where path_id='${pathId}'`);
});

test('إصدار جديد: نسخة مسودة، تعديل، وملخص التغييرات إلزامي', async () => {
  await submit(ed.getByRole('button', { name: 'أنشئ إصدارًا جديدًا للتعديل' }));
  assert.match(await toast(), /إصدار مسودة/);
  assert.equal(stepTitles(), 'الأولى (مصحّحة)|الثالثة|الامتحان', 'نُسخت الخطوات');
  await ed.getByText('+ أضف خطوة').click();
  await ed.fill('#new-title', 'الرابعة');
  await submit(ed.getByRole('button', { name: 'أضف الخطوة' }));
  assert.equal(stepTitles(), 'الأولى (مصحّحة)|الثالثة|الرابعة|الامتحان', 'الخطوة الجديدة قبل الامتحان');
  await ed.locator('#changelog').evaluate((el) => el.removeAttribute('required'));
  await submit(ed.getByRole('button', { name: 'انشر الإصدار 2' }));
  assert.match(await toast(), /ما الذي تغيّر/);
  await ed.fill('#changelog', 'أضفنا خطوة رابعة');
  await submit(ed.getByRole('button', { name: 'انشر الإصدار 2' }));
  assert.equal(sql(`select string_agg(version_no||':'||status, ',' order by version_no) from path_versions where path_id='${pathId}'`), '1:retired,2:published');
});

test('الإيقاف ثم الإظهار، ثم السحب', async () => {
  await ed.getByText('إيقاف أو سحب').click();
  await submit(ed.getByRole('button', { name: 'أوقف البدء الجديد' }));
  assert.equal(sql(`select status from paths where id='${pathId}'`), 'hidden');
  assert.equal((await anon('/paths')).text.includes(TITLE), false, 'اختفى من القائمة');
  await ed.getByText('إيقاف أو سحب').click();
  await submit(ed.getByRole('button', { name: 'أعد إظهار المسار' }));
  assert.equal(sql(`select status from paths where id='${pathId}'`), 'published');
  await ed.getByText('إيقاف أو سحب').click();
  await ed.fill('#wnote', 'مراجعة علمية');
  await submit(ed.getByRole('button', { name: 'اسحب الإصدار 2' }));
  assert.equal(sql(`select status from path_versions where path_id='${pathId}' and version_no=2`), 'withdrawn');
  assert.match(await ed.locator('main').innerText(), /لا يوجد إصدار منشور/);
  assert.equal(sql(`select count(*) from paths_current where path_id='${pathId}'`), '0');
});

test('قائمة المسارات تعرض المسار وحالته', async () => {
  await ed.goto(`${BASE}/admin/paths`);
  const row = ed.locator('.adm-row', { hasText: TITLE });
  assert.equal(await row.count(), 1);
  assert.match(await row.innerText(), /موقوف للبدء الجديد/);
});
