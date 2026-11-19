// اختبارات رحلة المستخدم الكاملة في متصفح حقيقي. تتطلب: tests/e2e.sh (يهيئ القاعدة والمحاكي والموقع)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const SECRET = 'dev-only-secret-dev-only-secret-0123456789';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
let browser;
before(async () => { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] }); });
after(async () => { await browser.close(); });

async function ctx(email, opts = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', ...opts });
  if (email) await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  return c;
}
const stepOf = async (page) => { await page.waitForURL((u) => !/^\/(login|auth)/.test(u.pathname)); };
async function signIn(page, next = '/journey') {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await stepOf(page);
}
const uid = (email) => sql(`select id from auth.users where email='${email}'`);
const sign = (payload, secret = SECRET) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const text = (page) => page.locator('main').innerText();

let ENR1; // تسجيل alice الأول
const PATH_URL = `${BASE}/paths/dev-anger-7days`;

test('F6+F5: زائر يبدأ مسارًا ← دخول ← يُنفَّذ البدء مرة واحدة على الإصدار الحالي', async () => {
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await page.goto(PATH_URL);
  await page.getByRole('button', { name: 'ابدأ هذا المسار' }).click();
  await page.waitForURL(/\/login\?next=%2Fpaths%2Fdev-anger-7days&reason=start-path/);
  assert.match(await text(page), /لنبدأ المسار ونحفظ تقدمك فيه/);
  await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await page.waitForURL(/\/journey\/paths\/[0-9a-f-]{36}\?new=1/);
  ENR1 = page.url().match(/paths\/([0-9a-f-]{36})/)[1];
  assert.match(await text(page), /هل تريد ربط هذا المسار بهدف/);
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').innerText(), /بدأتَ المسار/);
  assert.equal(sql(`select count(*) from enrollments where user_id='${uid('alice@y.test')}'`), '1');
  assert.equal(sql(`select pv.version_no from enrollments e join path_versions pv on pv.id=e.version_id where e.id='${ENR1}'`), '2', 'مثبّت على الإصدار المنشور وقت التنفيذ');
  const cookies = await c.cookies();
  assert.ok(!cookies.some((k) => k.name === 'yq-intent'), 'النية المعلقة حُذفت');
  assert.ok(!(await page.evaluate(() => document.cookie)).includes('yq-at'), 'رمز الجلسة httpOnly');
  assert.ok(cookies.find((k) => k.name === 'yq-at').httpOnly && cookies.find((k) => k.name === 'yq-rt').httpOnly);
  await c.close();
});

test('الجلسة تبقى بعد التحديث، والصفحة العامة تعرض «تابع مسارك»', async () => {
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page);
  await page.reload();
  assert.match(await text(page), /تابع/);
  await page.goto(PATH_URL);
  await page.getByRole('link', { name: 'تابع مسارك' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'ابدأ هذا المسار' }).count(), 0);
  await c.close();
});

test('F7: حالات الخطوات والتقدم والخطوة التالية وآخر خطوة', async () => {
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page, `/journey/paths/${ENR1}`);
  await page.locator('.step-row').nth(0).getByRole('button', { name: 'أكملتها' }).click();
  await page.waitForURL(`**/journey/paths/${ENR1}`);
  assert.match(await text(page), /1 من 4 خطوات مكتملة/);
  await page.goto(`${BASE}/journey`);
  assert.match(await text(page), /الخطوة التالية:\s*شاهد الفيديو التجريبي/);
  await page.getByRole('link', { name: 'تابع', exact: true }).click();
  await page.waitForURL(/\/steps\//);
  assert.match(await page.locator('h1').innerText(), /شاهد الفيديو/);
  const stepId = page.url().split('/').pop();
  assert.equal(sql(`select last_step_id from enrollments where id='${ENR1}'`), stepId, 'فتح الخطوة يحفظ آخر خطوة');
  assert.match(await text(page), /هذه المادة غير متاحة حاليًا/, 'مادة مخفية داخل خطوة');
  await page.getByRole('button', { name: 'أكملتها' }).click();
  await page.waitForURL(/\/steps\//);
  assert.match(await text(page), /مكتملة/);
  await page.getByRole('button', { name: 'أعد فتحها' }).click();
  await page.waitForURL(/\/steps\//);
  assert.match(await text(page), /لم تبدأ/);
  await page.goto(`${BASE}/journey/paths/${ENR1}`);
  assert.match(await text(page), /1 من 4 خطوات مكتملة/, 'إعادة الفتح تُرجع التقدم');
  await c.close();
});

test('F10: إصدار جديد لا يغيّر تجربتي، والانتقال اختياري يحفظ تقدمي', async () => {
  const P = `(select id from paths where slug='dev-anger-7days')`;
  sql(`insert into path_versions (path_id,title,description,purpose,duration_days) select path_id,title,description,purpose,duration_days from path_versions where path_id=${P} and version_no=2;
       insert into steps (version_id,step_key,position,type,title,instructions) select (select id from path_versions where path_id=${P} and version_no=3), step_key,position,type,title,instructions from steps where version_id=(select id from path_versions where path_id=${P} and version_no=2);
       insert into steps (version_id,position,type,title) values ((select id from path_versions where path_id=${P} and version_no=3),5,'review','خطوة جديدة في الإصدار الثالث');
       update path_versions set status='retired' where path_id=${P} and version_no=2;
       update path_versions set status='published', published_at=now(), changelog='أضفنا خطوة مراجعة' where path_id=${P} and version_no=3;`);
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page, `/journey/paths/${ENR1}`);
  assert.match(await text(page), /يتوفر إصدار محدَّث.*الإصدار 3/s);
  assert.match(await text(page), /1 من 4 خطوات مكتملة/, 'تقدمي ثابت على إصداري');
  assert.equal(await page.locator('.step-row').count(), 4, 'خطواتي لم تتغير');
  await page.getByRole('link', { name: 'اطّلع على الجديد' }).click();
  const plan = await text(page);
  assert.match(plan, /سيُنقل تقدمها/); assert.match(plan, /خطوة جديدة في الإصدار الثالث/);
  await page.getByRole('button', { name: 'انتقل إلى الإصدار الجديد' }).click();
  await page.waitForURL(/\/journey\/paths\/[0-9a-f-]{36}$/);
  const ENR2 = page.url().split('/').pop();
  assert.notEqual(ENR2, ENR1);
  assert.match(await text(page), /1 من 5 خطوات مكتملة/, 'تقدمي انتقل');
  assert.equal(sql(`select status||'/'||archive_reason from enrollments where id='${ENR1}'`), 'archived/migrated');
  assert.equal(sql(`select count(*) from enrollment_steps where enrollment_id='${ENR1}'`) >= '1', true, 'القديم محفوظ لم يُحذف');
  await page.goto(`${BASE}/journey/paths`);
  await page.getByText('مسارات مؤرشفة').click();
  assert.match(await text(page), /انتقلتَ منه إلى إصدار أحدث/);
  ENR1 = ENR2;
  await c.close();
});

test('F4: زائر يكتب هدفًا ← دخول ← يُحفظ تلقائيًا مرة واحدة بنصّه', async () => {
  const c = await ctx('carol@y.test'); const page = await c.newPage();
  await page.goto(`${BASE}/journey/goals/new`);
  assert.match(await text(page), /عند الحفظ سنطلب منك تسجيل الدخول/);
  await page.fill('#title', 'أضبط غضبي عند الازدحام');
  await page.fill('#description', 'أريد أن أبدأ بالتنفس قبل الرد');
  await page.selectOption('#domain', 'character');
  await page.getByRole('button', { name: 'احفظ الهدف' }).click();
  await page.waitForURL(/\/login\?next=.*goals%2Fnew%3Fresume%3D1/);
  await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await page.waitForURL(/\/journey\/goals\/[0-9a-f-]{36}$/, { timeout: 15000 });
  assert.match(await text(page), /أضبط غضبي عند الازدحام/);
  assert.match(await text(page), /أريد أن أبدأ بالتنفس قبل الرد/);
  assert.equal(sql(`select count(*) from goals where user_id='${uid('carol@y.test')}'`), '1');
  assert.equal(sql(`select d.slug from goals g join domains d on d.id=g.domain_id where g.user_id='${uid('carol@y.test')}'`), 'character');
  await page.reload();
  assert.equal(sql(`select count(*) from goals where user_id='${uid('carol@y.test')}'`), '1', 'التحديث لا يكرر الحفظ');
  await c.close();
});

test('F9: إدارة الهدف: حالات وأرشفة واستعادة وربط وحذف من الأرشيف فقط', async () => {
  const c = await ctx('carol@y.test'); const page = await c.newPage();
  await signIn(page, '/journey/goals');
  await page.getByRole('link', { name: /أضبط غضبي/ }).click();
  const goalUrl = page.url();
  await page.getByRole('button', { name: 'ابدأ العمل عليه' }).click();
  assert.match(await page.locator('.state').first().innerText(), /قيد العمل/);
  await page.getByRole('button', { name: 'أوقفه مؤقتًا' }).click();
  assert.match(await page.locator('.state').first().innerText(), /متوقف مؤقتًا/);
  await page.getByRole('button', { name: 'استأنف' }).click();
  await page.getByRole('button', { name: 'أرشفة' }).click();
  assert.match(await page.locator('.state').first().innerText(), /مؤرشف/);
  assert.equal(await page.locator('button:has-text("احذف الهدف نهائيًا")').count(), 1);
  await page.getByRole('button', { name: 'استعادة الهدف' }).click();
  assert.match(await page.locator('.state').first().innerText(), /قيد العمل/, 'الاستعادة ترجع الحالة السابقة');
  assert.equal(await page.locator('button:has-text("احذف الهدف نهائيًا")').count(), 0, 'الحذف النهائي من الأرشيف فقط');
  await page.getByText('تعديل الهدف').click();
  await page.fill('details #title', 'أضبط غضبي عند الازدحام والتأخر');
  await page.getByRole('button', { name: 'احفظ التعديلات' }).click();
  assert.match(await page.locator('h1').innerText(), /والتأخر/);
  // إكمال المسار لا يكمل الهدف: لا تغيير تلقائي
  await page.goto(goalUrl);
  assert.match(await page.locator('.state').first().innerText(), /قيد العمل/);
  await page.getByRole('button', { name: 'أرشفة' }).click();
  await page.locator('summary', { hasText: 'حذف الهدف نهائيًا' }).click();
  await page.getByRole('button', { name: 'احذف الهدف نهائيًا' }).click();
  await page.waitForURL(/\/journey\/goals$/);
  assert.equal(sql(`select count(*) from goals where user_id='${uid('carol@y.test')}'`), '0');
  await c.close();
});

test('ربط هدف بمسار من صفحة المسار الجديد', async () => {
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page, `/journey/goals/new?enrollment=${ENR1}&title=${encodeURIComponent('هدفي من المسار')}`);
  assert.equal(await page.inputValue('#title'), 'هدفي من المسار');
  await page.getByRole('button', { name: 'احفظ الهدف' }).click();
  await page.waitForURL(/\/journey\/goals\/[0-9a-f-]{36}$/);
  assert.match(await text(page), /سبعة أيام/);
  assert.equal(sql(`select count(*) from goal_enrollments where enrollment_id='${ENR1}'`), '1');
  await c.close();
});

test('المحفوظات والبلاغات: زائر يحفظ ← دخول ← تُحفظ، والمخفية تظهر «غير متاحة»', async () => {
  const c = await ctx('dave@y.test'); const page = await c.newPage();
  await page.goto(`${BASE}/library/dev-article-anger`);
  await page.getByRole('button', { name: 'احفظ للرجوع إليها' }).click();
  await page.waitForURL(/\/login\?.*reason=save-material/);
  await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await page.waitForURL(/\/library\/dev-article-anger$/); // يعود إلى ما كان يقصده
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').innerText(), /تم حفظ المادة/);
  await page.goto(`${BASE}/journey/saved`);
  assert.match(await text(page), /مقال لاختبار العرض/);
  await page.goto(`${BASE}/library/dev-article-anger`);
  await page.getByRole('button', { name: /إزالة من المحفوظات/ }).waitFor();
  await page.getByText('أبلغ عن مشكلة في هذه المادة').click();
  await page.fill('#note', 'الرابط لا يعمل');
  await page.getByRole('button', { name: 'أرسل البلاغ' }).click();
  await page.waitForSelector('.toast');
  assert.equal(sql(`select count(*) from material_reports where reporter_id='${uid('dave@y.test')}' and note='الرابط لا يعمل'`), '1');
  sql(`update materials set status='hidden' where slug='dev-article-anger'`);
  await page.goto(`${BASE}/journey/saved`);
  assert.match(await text(page), /هذه المادة غير متاحة حاليًا/);
  await page.getByRole('button', { name: 'إزالة' }).click();
  assert.match(await text(page), /لم تحفظ مادة بعد/);
  sql(`update materials set status='published' where slug='dev-article-anger'`);
  await c.close();
});

test('عزل المستخدمين: بوب لا يرى ولا يغيّر بيانات أليس', async () => {
  const goal = sql(`select id from goals where user_id='${uid('alice@y.test')}' limit 1`);
  const stepId = sql(`select id from steps where version_id=(select version_id from enrollments where id='${ENR1}') and position=1`);
  const c = await ctx('bob@y.test'); const page = await c.newPage();
  await signIn(page);
  for (const u of [`/journey/goals/${goal}`, `/journey/paths/${ENR1}`, `/journey/paths/${ENR1}/steps/${stepId}`]) {
    const r = await page.goto(BASE + u);
    assert.equal(r.status(), 404, `${u} يعطي 404 لا 403`);
  }
  const before = sql(`select state from enrollment_steps where enrollment_id='${ENR1}' order by step_id limit 1`);
  const post = (action, fields) => page.evaluate(async ([a, f]) => { const fd = new URLSearchParams(f); const r = await fetch('/api/' + a, { method: 'POST', body: fd, redirect: 'manual', credentials: 'same-origin' }); return r.type; }, [action, fields]);
  await post('goal-delete', { id: goal });
  await post('goal-status', { id: goal, status: 'archived' });
  await post('set-step', { enrollment_id: ENR1, step_id: stepId, state: 'not_started' });
  assert.equal(sql(`select count(*) from goals where id='${goal}'`), '1', 'حذف هدف غيره لا يعمل');
  assert.notEqual(sql(`select status from goals where id='${goal}'`), 'archived');
  assert.equal(sql(`select state from enrollment_steps where enrollment_id='${ENR1}' order by step_id limit 1`), before);
  await c.close();
});

test('الأمان: Origin غريب، وجهات خارجية، وCSRF للدخول، وكود مستهلك', async () => {
  const c = await ctx('erin@y.test'); const page = await c.newPage();
  const r = await fetch(`${BASE}/api/save-material`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'material_id=x', redirect: 'manual' });
  assert.equal(r.status, 403, 'POST بأصل غريب مرفوض');
  const r2 = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'next=/', redirect: 'manual' });
  assert.equal(r2.status, 403, 'login CSRF مرفوض');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/api/x', '/auth/login']) {
    await page.goto(`${BASE}/login?next=${encodeURIComponent(bad)}`);
    assert.equal(await page.locator('input[name=next]').inputValue(), '/journey', `next=${bad} يُرفض`);
  }
  await page.goto(`${BASE}/auth/callback?code=abc`);
  assert.match(page.url(), /error=expired/, 'بلا verifier');
  await signIn(page);
  const cookies = await c.cookies();
  assert.ok(!cookies.some((k) => k.name === 'yq-pkce'), 'كوكي PKCE يُحذف بعد الاستخدام');
  await c.close();
});

test('رفض Google وتعطل الدخول: رسالة ودودة بلا انهيار', async () => {
  const c = await ctx(null); await c.addCookies([{ name: 'mock_deny', value: '1', domain: 'localhost', path: '/' }]);
  const page = await c.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await page.waitForURL(/\/login\?.*error=denied/);
  assert.match(await text(page), /لم يكتمل تسجيل الدخول لأنك لم تأذن/);
  assert.ok(!(await c.cookies()).some((k) => k.name === 'yq-at'));
  await c.close();
});

test('الجلسة: تجديد تلقائي عند انتهاء الرمز، وإنهاء عند رفض الخادم له', async () => {
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page);
  const now = Math.floor(Date.now() / 1000), sub = uid('alice@y.test');
  const claims = (exp, secret) => sign({ sub, role: 'authenticated', aud: 'authenticated', email: 'alice@y.test', iat: now - 7200, exp }, secret);
  const set = async (at) => { await c.addCookies([{ name: 'yq-at', value: at, domain: 'localhost', path: '/', httpOnly: true }]); };
  const old = (await c.cookies()).find((k) => k.name === 'yq-at').value;
  await set(claims(now - 100)); // منتهٍ، ورمز التجديد سليم
  const r = await page.goto(`${BASE}/journey`);
  assert.equal(r.status(), 200);
  const renewed = (await c.cookies()).find((k) => k.name === 'yq-at').value;
  assert.notEqual(renewed, claims(now - 100), 'استُبدل الرمز المنتهي بآخر جديد');
  await set(claims(now + 3000, 'wrong-secret-wrong-secret-wrong-secret-xx')); // صالح الشكل لكن PostgREST يرفضه
  await page.goto(`${BASE}/journey`);
  assert.match(page.url(), /\/login\?.*reason=expired/, 'رُفض من الخادم ← إعادة إلى الدخول');
  assert.ok(!(await c.cookies()).some((k) => k.name === 'yq-at' && k.value.includes('wrong')), 'الكوكي التالف حُذف');
  void old;
  await c.close();
});

test('الخروج ينهي الجلسة وتُحمى الصفحات بعده', async () => {
  const c = await ctx('frank@y.test'); const page = await c.newPage();
  await signIn(page, '/journey/settings');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await page.waitForURL(`${BASE}/`);
  assert.ok(!(await c.cookies()).some((k) => k.name === 'yq-at' || k.name === 'yq-rt'));
  await page.goto(`${BASE}/journey/settings`);
  assert.match(page.url(), /\/login\?next=%2Fjourney%2Fsettings/);
  await c.close();
});

test('الحدود: بلوغ 100 هدف يعطي رسالة مفهومة', async () => {
  const c = await ctx('gina@y.test'); const page = await c.newPage();
  await signIn(page);
  sql(`insert into goals (user_id,title) select '${uid('gina@y.test')}', 'هدف '||g from generate_series(1,100) g`);
  await page.goto(`${BASE}/journey/goals/new`);
  await page.fill('#title', 'هدف زائد');
  await page.getByRole('button', { name: 'احفظ الهدف' }).click();
  await page.waitForSelector('.toast-error');
  assert.match(await page.locator('.toast').innerText(), /بلغت الحد الأقصى/);
  await c.close();
});

test('F10/A5: سحب الإصدار: ينبّه المستخدم ويحفظ تقدمه ولا يسمح بتغيير الحالة', async () => {
  const P = `(select id from paths where slug='dev-anger-7days')`;
  sql(`update path_versions set status='withdrawn', withdrawn_note='تجربة' where path_id=${P} and version_no=3; update paths set status='hidden' where id=${P};`);
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page, `/journey/paths/${ENR1}`);
  assert.match(await text(page), /سُحب هذا الإصدار مؤقتًا للمراجعة/);
  assert.equal(await page.locator('.step-row').count(), 0, 'محتوى الإصدار المسحوب مخفي');
  assert.equal(sql(`select count(*) from enrollment_steps where enrollment_id='${ENR1}' and state='completed'`), '1', 'التقدم المكتمل محفوظ'); 
  const r = await page.evaluate(async (e) => (await fetch('/api/set-step', { method: 'POST', body: new URLSearchParams({ enrollment_id: e, step_id: '00000000-0000-0000-0000-000000000000', state: 'completed', next: '/journey' }), redirect: 'manual' })).type, ENR1);
  assert.ok(r);
  await page.goto(`${BASE}/journey`);
  assert.match(await text(page), /سُحب هذا الإصدار مؤقتًا للمراجعة/);
  sql(`update path_versions set status='published' where path_id=${P} and version_no=3 and status='withdrawn' ;`.replace("status='published' where", "status='retired' where"));
  await c.close();
});

test('بلا JavaScript: بدء المسار وحفظ المادة يعملان بالنموذج العادي', async () => {
  sql(`update paths set status='published' where slug='dev-open-path'`);
  const c = await ctx('hana@y.test', { javaScriptEnabled: false }); const page = await c.newPage();
  await page.goto(`${BASE}/paths/dev-open-path`);
  await page.getByRole('button', { name: 'ابدأ هذا المسار' }).click();
  await page.waitForURL(/\/login\?/);
  await page.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await page.waitForURL(/\/journey\/paths\/[0-9a-f-]{36}\?new=1/);
  assert.equal(sql(`select count(*) from enrollments where user_id='${uid('hana@y.test')}'`), '1');
  await c.close();
});

test('F12: حذف الحساب: تأكيد صحيح، يمحو كل شيء، ويبدأ الدخول التالي نظيفًا', async () => {
  const c = await ctx('ivan@y.test'); const page = await c.newPage();
  await signIn(page, '/journey/settings');
  const id = uid('ivan@y.test');
  sql(`insert into goals (user_id,title) values ('${id}','هدف سيُحذف')`);
  await page.getByText('حذف الحساب والبيانات').click();
  await page.fill('#confirm', 'خطأ');
  await page.getByRole('button', { name: 'احذف حسابي وبياناتي' }).click();
  await page.waitForSelector('.toast-error');
  assert.equal(sql(`select count(*) from auth.users where id='${id}'`), '1', 'تأكيد خاطئ لا يحذف');
  await page.getByText('حذف الحساب والبيانات').click();
  await page.fill('#confirm', 'احذف');
  await page.getByRole('button', { name: 'احذف حسابي وبياناتي' }).click();
  await page.waitForURL(`${BASE}/`);
  assert.equal(sql(`select (select count(*) from auth.users where id='${id}')+(select count(*) from goals where user_id='${id}')+(select count(*) from profiles where id='${id}')`), '0');
  assert.ok(!(await c.cookies()).some((k) => k.name === 'yq-at'));
  await signIn(page);
  assert.match(await text(page), /ابدأ رحلتك من أي طرف/, 'حساب جديد نظيف');
  await c.close();
});

test('إمكانية الوصول (axe) لصفحات رحلتي', async () => {
  const { readFileSync } = await import('node:fs');
  const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  const c = await ctx('alice@y.test'); const page = await c.newPage();
  await signIn(page);
  const g = sql(`select id from goals where user_id='${uid('alice@y.test')}' limit 1`);
  const step = sql(`select id from steps where version_id=(select version_id from enrollments where id='${ENR1}') order by position limit 1`);
  const bad = [];
  for (const p of ['/journey', '/journey/goals', '/journey/goals/new', `/journey/goals/${g}`, '/journey/paths', `/journey/paths/${ENR1}`, `/journey/paths/${ENR1}/steps/${step}`, '/journey/saved', '/journey/settings', '/login']) {
    await page.goto(BASE + p);
    await page.evaluate(axe);
    const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    for (const v of r.violations) bad.push(`${p} ${v.id}: ${v.nodes[0].target}`);
  }
  assert.deepEqual(bad, []);
  await c.close();
});
