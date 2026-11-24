// صور مرجعية للصفحات الرئيسية على الجوال (390px) — لكشف أي تغيّر بصري غير مقصود أثناء إعادة الترتيب.
// الاستخدام (الموقع على :4321 ببيانات dev/stack.sh؛ خذ المرجع قبل التعديل مباشرة، فالاختبارات الأخرى تغيّر بيانات القاعدة؛ لا تُعِد ضبط القاعدة بين المرجع والمقارنة لأن ترتيب المواد المتساوية زمنيًا يتبع معرّفات عشوائية):
//   node tests/visual.mjs baseline   ← يحفظ الصور المرجعية في tests/visual/baseline
//   node tests/visual.mjs compare    ← يلتقط من جديد ويقارن بالمرجع (tests/visual_diff.py)، ويفشل عند أي فرق
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';

const mode = process.argv[2] === 'compare' ? 'compare' : 'baseline';
const BASE = process.env.BASE || 'http://localhost:4321';
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const out = `tests/visual/${mode === 'baseline' ? 'baseline' : 'current'}`;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

const PUBLIC = ['/', '/start', '/discover', '/doors/closer-to-allah', '/needs/faith-and-certainty', '/domains', '/paths',
  '/paths/dev-anger-7days', '/library', '/library/dev-article-anger', '/search?q=الغضب', '/support', '/about', '/login', '/no-such-page'];
const USER = ['/journey', '/journey/settings', '/journey/saved', '/support'];
const ADMIN = ['/admin', '/admin/materials', '/admin/materials/new', '/admin/paths', '/admin/paths/new', '/admin/series', '/admin/series/new',
  '/admin/reports', '/admin/onboarding', '/admin/taxonomy', '/admin/team', '/admin/settings', '/admin/requests'];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--font-render-hinting=none'] });
const css = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} .toast{display:none!important}';
async function ctx(email, role) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ar', reducedMotion: 'reduce' });
  if (!email) return c.newPage();
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  const p = await c.newPage();
  await p.goto(`${BASE}/login?next=%2Fjourney`);
  await p.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/journey'));
  if (role) sql(`insert into staff_roles (user_id,email,role) select id,email,'${role}' from auth.users where email='${email}' on conflict (user_id) do update set role=excluded.role`);
  return p;
}
async function shoot(p, path, name) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: css });
  await p.evaluate(() => document.fonts.ready);
  const file = `${out}/${name ?? (path.replace(/[^\w\u0600-\u06FF]+/g, '_') || '_home')}.png`;
  await p.screenshot({ path: file, fullPage: true });
}
// زائر
const v = await ctx(null);
for (const path of PUBLIC) await shoot(v, path);
const opts = sql(`select string_agg(id::text, '&o=') from (select id from onboarding_options order by question_id, position limit 2) x`);
await shoot(v, `/start/result?o=${opts}`, '_start_result');
// مستخدم ثابت (بريد ثابت كي تتطابق الصفحات بين التشغيلين) مسجَّل في مسار
const u = await ctx('visual-user@y.test');
if (sql(`select count(*) from enrollments e join auth.users a on a.id=e.user_id where a.email='visual-user@y.test'`) === '0') {
  await u.goto(`${BASE}/paths/dev-anger-7days`);
  await u.getByRole('button', { name: /ابدأ/ }).first().click();
  await u.waitForLoadState('networkidle');
}
const eid = sql(`select e.id from enrollments e join auth.users a on a.id=e.user_id where a.email='visual-user@y.test' limit 1`);
for (const path of USER) await shoot(u, path);
await shoot(u, `/journey/paths/${eid}`, '_journey_path');
// مدير
const m = await ctx('visual-manager@admin.test', 'manager');
for (const path of ADMIN) await shoot(m, path);
await shoot(m, `/admin/materials/${sql(`select id from materials where slug='dev-article-anger'`)}`, '_admin_material_edit');
await shoot(m, `/admin/paths/${sql(`select id from paths where slug='dev-anger-7days'`)}`, '_admin_path_edit');
await browser.close();
console.log(`${mode}: ${PUBLIC.length + USER.length + ADMIN.length + 4} صفحة → ${out}`);
if (mode === 'compare') execFileSync('python3', ['tests/visual_diff.py'], { stdio: 'inherit' });
