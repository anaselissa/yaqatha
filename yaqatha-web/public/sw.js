// عامل خدمة بسيط: صفحة «بلا اتصال» عند انقطاع الشبكة، وتخزين ملفات التصميم الثابتة فقط.
// لا يُخزَّن أي محتوى شخصي (رحلتي، اللوحة، الحساب) إطلاقًا.
const CACHE = 'yaqatha-v5';
const OFFLINE = '/offline/';
const STATIC = [OFFLINE, '/favicon.svg', '/icon-192.png'];

self.addEventListener('install', (e) => {
  // نعيد بناء الاستجابة: الاستجابة المحوَّلة (redirect) لا تصلح ردًّا على تنقّل
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(STATIC.map((u) =>
    fetch(u).then((r) => r.ok && c.put(u, new Response(r.body, { status: 200, headers: r.headers })))
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  // ملفات Astro المبنية أسماؤها ببصمة المحتوى: آمنة للتخزين الدائم
  if (url.pathname.startsWith('/_astro/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
