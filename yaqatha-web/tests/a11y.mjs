// فحص إمكانية الوصول بـ axe-core على الصفحات الرئيسية. الاستخدام: node tests/a11y.mjs [/paths...]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const axe = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const paths = process.argv.length > 2 ? process.argv.slice(2) : ['/', '/discover', '/doors/closer-to-allah', '/needs/anger-control', '/domains', '/library', '/library/dev-article-anger', '/library/dev-video-prayer', '/paths', '/paths/dev-anger-7days', '/paths/dev-anger-7days/steps/2', '/search?q=غضب', '/about', '/start', '/support', '/nothing'];
const b = await chromium.launch({ executablePath: process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p)), args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let total = 0;
for (const p of paths) {
  await page.goto((process.env.BASE || 'http://127.0.0.1:4321') + p, { waitUntil: 'networkidle' });
  await page.evaluate(axe);
  const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
  for (const v of r.violations) { total++; console.log(`${p} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0].target}`); }
}
console.log(`axe violations: ${total} on ${paths.length} pages`);
await b.close();
process.exit(total ? 1 : 0);
