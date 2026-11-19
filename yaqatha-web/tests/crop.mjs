// لقطة لمنطقة محددة: node tests/crop.mjs /path width y height out.png
import { chromium } from 'playwright-core';
const [path, w, y, h, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: +w, height: 900 }, locale: 'ar' })).newPage();
await p.goto('http://127.0.0.1:4321' + path, { waitUntil: 'networkidle' });
await p.screenshot({ path: out, fullPage: true, clip: { x: 0, y: +y, width: +w, height: +h } });
await b.close();
