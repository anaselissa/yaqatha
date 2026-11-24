// التطبيق على الهاتف (PWA) والتذكير اليومي. تتطلب: dev/up.sh
// الاستخدام: node --test --test-concurrency=1 tests/app.e2e.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:4321';
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(existsSync);
const run = Date.now().toString(36);
let browser;
before(async () => { browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
after(async () => { await browser.close(); });

test('ملف التطبيق والأيقونات وعامل الخدمة وصفحة «بلا اتصال» تُخدم', async () => {
  const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  assert.equal(m.short_name, 'يقظة'); assert.equal(m.dir, 'rtl'); assert.equal(m.display, 'standalone');
  for (const i of m.icons) {
    const r = await fetch(BASE + i.src);
    assert.equal(r.status, 200, i.src); assert.match(r.headers.get('content-type'), /image\/png/);
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const f of ['/sw.js', '/offline/', '/apple-touch-icon.png']) assert.equal((await fetch(BASE + f)).status, 200, f);
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
});

test('ملف التذكير: حدث يومي متكرر بالوقت المختار، والوقت غير الصالح يعود إلى 8 مساءً', async () => {
  const r = await fetch(`${BASE}/reminder.ics?t=06:30`);
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  const t = await r.text();
  assert.match(t, /DTSTART:\d{8}T063000/); assert.match(t, /RRULE:FREQ=DAILY/); assert.match(t, /BEGIN:VALARM/); assert.match(t, /URL:http:\/\/localhost:4321\/journey/);
  assert.match(await (await fetch(`${BASE}/reminder.ics?t=99:99`)).text(), /DTSTART:\d{8}T200000/);
});

test('في «رحلتي»: صندوق التذكير يحدّث الروابط حسب الوقت والمنطقة الزمنية', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', timezoneId: 'Asia/Amman' });
  await c.addCookies([{ name: 'mock_user', value: `app-${run}@y.test`, domain: 'localhost', path: '/' }]);
  const p = await c.newPage();
  await p.goto(`${BASE}/login?next=%2Fjourney%2Fsettings`);
  await p.getByRole('button', { name: 'المتابعة عبر Google' }).click();
  await p.waitForURL(/journey\/settings/);
  await p.selectOption('#rem-time', '06:30');
  assert.equal(await p.locator('[data-ics]').getAttribute('href'), '/reminder.ics?t=06:30');
  const g = new URL(await p.locator('[data-gcal]').getAttribute('href'));
  assert.equal(g.hostname, 'calendar.google.com');
  assert.equal(g.searchParams.get('ctz'), 'Asia/Amman');
  assert.equal(g.searchParams.get('recur'), 'RRULE:FREQ=DAILY');
  assert.match(g.searchParams.get('dates'), /T063000\/\d{8}T064000$/);
});

test('عامل الخدمة: بلا اتصال تظهر صفحة لطيفة بدل خطأ المتصفح', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/about`);
  await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await p.reload(); // تحت سيطرة عامل الخدمة الآن
  await c.setOffline(true);
  await p.goto(`${BASE}/paths`).catch(() => {});
  assert.match(await p.locator('body').innerText(), /لا يوجد اتصال بالإنترنت/);
  await c.setOffline(false);
});
