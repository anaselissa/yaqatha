// لقطات شاشة للتحقق البصري (هاتف وحاسوب) وفحص أخطاء Console والتمرير الأفقي.
// الاستخدام: node tests/shots.mjs /path1 /path2 ...   (يتطلب تشغيل الموقع على :4321)
import { chromium } from 'playwright-core';
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const base = process.env.BASE || 'http://127.0.0.1:4321';
const paths = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
let bad = 0;
for (const [name, vp] of [['m', { width: 390, height: 844 }], ['d', { width: 1280, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: 'ar' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = `tests/shots/${name}${p.replace(/[^\w]+/g, '_') || '_home'}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${name} ${p} overflowX=${overflow}px -> ${file}`);
    if (overflow > 0) bad++;
  }
  if (errors.length) { console.log(`[${name}] console issues:\n  ` + errors.join('\n  ')); bad++; }
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
