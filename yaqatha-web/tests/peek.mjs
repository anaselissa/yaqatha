// لقطات سريعة أثناء التطوير: node tests/peek.mjs [--user email] [--light] path1 path2 ...  ← /tmp/peek/sheet.png
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const ui = args.indexOf('--user'); const email = ui >= 0 ? args.splice(ui, 2)[1] : null;
const li = args.indexOf('--light'); const light = li >= 0 ? (args.splice(li, 1), true) : false;
const full = args.includes('--full') ? (args.splice(args.indexOf('--full'), 1), true) : false;
const BASE = process.env.BASE || 'http://localhost:4321';
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
rmSync('/tmp/peek', { recursive: true, force: true }); mkdirSync('/tmp/peek');
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
if (light) await c.addInitScript(() => localStorage.setItem('yq-theme', 'light'));
const p = await c.newPage();
if (email) {
  await c.addCookies([{ name: 'mock_user', value: email, domain: 'localhost', path: '/' }]);
  await p.goto(`${BASE}/login?next=%2Fjourney`);
  await p.getByRole('button', { name: /Google/ }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
}
const files = [];
for (const [i, path] of args.entries()) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const f = `/tmp/peek/${String(i).padStart(2, '0')}.png`;
  await p.screenshot({ path: f, fullPage: full });
  files.push(f);
}
await b.close();
execFileSync('python3', ['-c', `
import sys
from PIL import Image
ims=[Image.open(f) for f in sys.argv[1:]]
H=max(i.height for i in ims); c=Image.new('RGB',(400*len(ims),H),'white')
for j,im in enumerate(ims): c.paste(im,(j*400,0))
c.save('/tmp/peek/sheet.png')`, ...files]);
console.log('ok', files.length);
