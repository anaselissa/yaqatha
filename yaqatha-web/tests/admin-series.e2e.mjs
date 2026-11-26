// السلاسل وختام المسار في متصفح حقيقي (هاتف 390px). تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/admin-series.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
// معرّفات بصيغة يوتيوب صحيحة لكنها وهمية: الاختبار لا يعتمد على الشبكة (يُستعمل عنوان «حلقة N» عند تعذر oEmbed)
const vid = (n) => (`T${run}${n}xxxxxxxxxx`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 11);
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
  if (role) sql(`insert into staff_roles (user_id,email,role) select id,email,'${role}' from auth.users where email='${email}' on conflict do nothing`);
  return p;
}
const submit = async (p, loc) => { await Promise.all([p.waitForLoadState('load'), loc.click()]); await p.waitForLoadState(); };
const toast = async (p) => (await p.locator('.toast').first().innerText()).trim();
const anon = async (url) => { const p = await (await browser.newContext()).newPage(); const r = await p.goto(BASE + url); return { status: r.status(), text: await p.locator('main').innerText(), page: p }; };
const TITLE = `سلسلة اختبار ${run}`;
let ed, seriesId, seriesSlug, pathId;
const order = () => sql(`select string_agg(m.url, ',' order by si.position) from series_items si join materials m on m.id=si.material_id where si.series_id='${seriesId}'`);

test('إنشاء سلسلة من روابط يوتيوب دفعة واحدة: تكرار ورابط غير صالح يُتجاهلان', async () => {
  ed = await as(`series-${run}@admin.test`, 'editor');
  await ed.goto(`${BASE}/admin/series/new`);
  await ed.fill('#title', TITLE);
  await ed.fill('#author', 'شيخ تجريبي');
  await ed.fill('#links', [`https://youtu.be/${vid(1)}`, `https://www.youtube.com/watch?v=${vid(2)}&t=3`, `https://youtu.be/${vid(1)}`, 'https://example.com/nope'].join('\n'));
  await ed.getByLabel('أريد أن أضبط غضبي وانفعالاتي').check();
  await ed.getByLabel('انشر الحلقات الجديدة مباشرة').check();
  await submit(ed, ed.getByRole('button', { name: 'أنشئ السلسلة' }));
  assert.match(ed.url(), /\/admin\/series\/[0-9a-f-]{36}$/);
  seriesId = ed.url().split('/').pop();
  assert.match(await toast(ed), /أُضيفت 2 حلقة.*تُجوهل 1 رابط/);
  assert.equal(order(), `https://www.youtube.com/watch?v=${vid(1)},https://www.youtube.com/watch?v=${vid(2)}`);
  assert.equal(sql(`select string_agg(distinct m.status::text, ',') from series_items si join materials m on m.id=si.material_id where si.series_id='${seriesId}'`), 'published');
});

test('ترتيب الحلقات، وإضافة مادة موجودة، والرابط المكرر لا يُنشئ مادة ثانية', async () => {
  await submit(ed, ed.getByRole('button', { name: 'حرّك الحلقة 2 لأعلى' }));
  assert.equal(order(), `https://www.youtube.com/watch?v=${vid(2)},https://www.youtube.com/watch?v=${vid(1)}`);
  await ed.getByText('+ أضف حلقات من يوتيوب').click();
  await ed.fill('#links', `https://youtu.be/${vid(1)}\nhttps://youtu.be/${vid(3)}`);
  await submit(ed, ed.getByRole('button', { name: 'أضف الحلقات' }));
  await submit(ed, ed.getByRole('button', { name: 'انشر كل الحلقات' }));
  assert.match(await toast(ed), /اربط المادة باحتياج أو مجال/, 'حلقة بلا ربط لا تُنشر، برسالة واضحة');
  sql(`insert into material_needs (material_id, need_id) select id, (select id from needs where slug='anger-control') from materials where url='https://www.youtube.com/watch?v=${vid(3)}'`);
  await ed.goto(`${BASE}/admin/series/${seriesId}`);
  assert.equal(sql(`select count(*) from materials where url='https://www.youtube.com/watch?v=${vid(1)}'`), '1');
  assert.match(await ed.locator('main').innerText(), /1 حلقة غير منشورة/);
  await submit(ed, ed.getByRole('button', { name: 'انشر كل الحلقات' }));
  assert.equal(sql(`select count(*) from series_items si join materials m on m.id=si.material_id where si.series_id='${seriesId}' and m.status='published'`), '3');
});

test('نشر السلسلة: صفحة عامة، و«الحلقة التالية» في صفحة كل حلقة', async () => {
  if (!(await ed.locator('#status').isVisible())) await ed.getByText('بيانات السلسلة ونشرها').click();
  await ed.selectOption('#status', 'published');
  await submit(ed, ed.getByRole('button', { name: 'حفظ', exact: true }));
  seriesSlug = sql(`select slug from series where id='${seriesId}'`);
  const pub = await anon(`/series/${seriesSlug}`);
  assert.equal(pub.status, 200);
  assert.match(pub.text, new RegExp(TITLE)); assert.match(pub.text, /3 حلقة/);
  await pub.page.getByRole('link', { name: 'ابدأ من الحلقة الأولى' }).click();
  await pub.page.waitForLoadState();
  const t = await pub.page.locator('main').innerText();
  assert.match(t, /الحلقة 1 من 3/);
  await pub.page.getByRole('link', { name: /^تابع:/ }).click();
  await pub.page.waitForLoadState();
  assert.match(await pub.page.locator('main').innerText(), /الحلقة 2 من 3/);
  sql(`update series set status='draft' where id='${seriesId}'`);
  assert.equal((await anon(`/series/${seriesSlug}`)).status, 404, 'المسودة لا تظهر');
  sql(`update series set status='published' where id='${seriesId}'`);
});

test('تحويل السلسلة إلى مسار: خطوة مشاهدة لكل حلقة بترتيبها، ويرث الاحتياج', async () => {
  await ed.goto(`${BASE}/admin/series/${seriesId}`);
  await submit(ed, ed.getByRole('button', { name: 'أنشئ مسارًا من السلسلة' }));
  assert.match(ed.url(), /\/admin\/paths\/[0-9a-f-]{36}#steps$/);
  pathId = ed.url().split('/').pop().split('#')[0];
  assert.equal(sql(`select string_agg(s.type::text||':'||m.url, ',' order by s.position) from steps s join step_materials sm on sm.step_id=s.id join materials m on m.id=sm.material_id join path_versions v on v.id=s.version_id where v.path_id='${pathId}'`),
    [2, 1, 3].map((n) => `watch:https://www.youtube.com/watch?v=${vid(n)}`).join(','));
  assert.equal(sql(`select count(*) from path_needs pn join needs n on n.id=pn.need_id where pn.path_id='${pathId}' and n.slug='anger-control'`), '1');
});

test('ختام المسار: هدف مقترح ومسار تالٍ يظهران لمن أكمل، والهدف يُتبنّى بنقرة', async () => {
  await ed.getByText('+ أضف هدفًا مقترحًا').click();
  await ed.fill('#g-title', `صلاة الفجر في المسجد ${run}`);
  await submit(ed, ed.getByRole('button', { name: 'أضف', exact: true }).first());
  const nextId = sql(`select id from paths where slug='dev-anger-7days'`);
  await ed.selectOption('#next', nextId);
  await submit(ed, ed.locator('form[action="/api/admin/path-next-add"] button'));
  assert.equal(sql(`select count(*) from path_next where path_id='${pathId}'`), '1');
  await submit(ed, ed.getByRole('button', { name: 'أضف خطوة الامتحان' }));
  sql(`insert into exam_questions (step_id, position, prompt, options, correct_index) select s.id, g, 'س' || g, '["أ","ب"]', 0 from steps s join path_versions v on v.id=s.version_id, generate_series(1,5) g where v.path_id='${pathId}' and s.type='exam'`);
  sql(`update path_versions set level='intro' where path_id='${pathId}' and status='draft'`);
  await ed.reload();
  await submit(ed, ed.getByRole('button', { name: 'انشر المسار' }));

  const user = await as(`finisher-${run}@y.test`);
  const slug = sql(`select slug from paths where id='${pathId}'`);
  await user.goto(`${BASE}/paths/${slug}`);
  await submit(user, user.getByRole('button', { name: 'ابدأ هذا المسار' }));
  const enr = user.url().match(/journey\/paths\/([0-9a-f-]{36})/)[1];
  assert.doesNotMatch(await user.locator('main').innerText(), /أكملت المسار/, 'لا ختام قبل الإكمال');
  sql(`insert into exam_attempts (user_id, enrollment_id, step_id, score, total, passed, answers) select e.user_id, e.id, s.id, 5, 5, true, '{}' from enrollments e join steps s on s.version_id=e.version_id and s.type='exam' where e.id='${enr}'`);
  sql(`insert into enrollment_steps (enrollment_id, version_id, step_id, state) select '${enr}', s.version_id, s.id, 'completed' from steps s join enrollments e on e.version_id=s.version_id where e.id='${enr}' on conflict (enrollment_id, step_id) do update set state='completed'`);
  await user.goto(`${BASE}/journey/paths/${enr}`);
  const t = await user.locator('main').innerText();
  assert.match(t, /أكملت المسار/);
  assert.match(t, new RegExp(`صلاة الفجر في المسجد ${run}`));
  assert.match(t, /المسار التالي:/);
  await submit(user, user.getByRole('button', { name: /^استمر:/ }));
  assert.match(user.url(), /\/journey\/goals\/[0-9a-f-]{36}$/);
  const uid = sql(`select id from auth.users where email='finisher-${run}@y.test'`);
  assert.equal(sql(`select count(*) from goals g join goal_enrollments ge on ge.goal_id=g.id where g.user_id='${uid}' and ge.enrollment_id='${enr}' and g.title='صلاة الفجر في المسجد ${run}'`), '1');
  await user.goto(`${BASE}/journey/paths/${enr}`);
  assert.match(await user.locator('main').innerText(), /صار عادة يومية لك/);
});

test('إزالة حلقة من السلسلة تُبقي المادة في المكتبة', async () => {
  await ed.goto(`${BASE}/admin/series/${seriesId}`);
  await submit(ed, ed.locator('.adm-row').first().getByRole('button', { name: 'إزالة' }));
  assert.equal(sql(`select count(*) from series_items where series_id='${seriesId}'`), '2');
  assert.equal(sql(`select count(*) from materials where url='https://www.youtube.com/watch?v=${vid(2)}'`), '1');
});
