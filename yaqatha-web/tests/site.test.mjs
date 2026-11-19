// اختبارات تكامل على الموقع الفعلي وبيانات التطوير. تتطلب: dev/up.sh
// تشغيل: node --test tests/site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const get = async (p, init = {}) => {
  const r = await fetch(BASE + p, { redirect: 'manual', ...init });
  return { status: r.status, headers: r.headers, html: await r.text() };
};
const count = (s, re) => (s.match(re) || []).length;
const DRAFT = 'مسودة لا يجوز أن تظهر';
const HIDDEN = 'مادة سيُخفى نشرها';

test('الرئيسية: الأبواب الأربعة والأقسام المختارة وبيانات SEO', async () => {
  const { status, html, headers } = await get('/');
  assert.equal(status, 200);
  for (const t of ['اقترب من الله', 'غيّر من نفسك', 'أصلح حياتك وعلاقاتك', 'تعلّم وانفع غيرك']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('ابدأ من هنا') && html.includes('مسارات مختارة') && html.includes('مواد مختارة'));
  assert.equal(count(html, /<h1[ >]/g), 1);
  assert.match(html, /<html lang="ar" dir="rtl"/);
  assert.match(html, /<link rel="canonical" href="https?:\/\/[^"]+\/">/);
  assert.match(html, /"@type":"WebSite"[\s\S]*SearchAction/);
  assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(headers.get('cache-control'), /s-maxage=60/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});

test('اكتشف احتياجك وصفحة الباب: المنشور فقط', async () => {
  const d = await get('/discover');
  assert.equal(d.status, 200);
  assert.ok(d.html.includes('id="start"'));
  const main = d.html.split('<main')[1].split('</main>')[0];
  assert.equal(count(main, /href="\/doors\/[a-z-]+"/g), 4);
  const door = await get('/doors/closer-to-allah');
  assert.equal(door.status, 200);
  assert.ok(door.html.includes('/needs/prayer-consistency') && door.html.includes('/needs/faith-and-certainty'));
  assert.ok(!door.html.includes('/needs/quran-relationship'), 'احتياج مسودة لا يظهر');
  assert.equal((await get('/doors/zzz')).status, 404);
});

test('الاحتياج: مسارات ومواد منشورة فقط، والمسودة 404', async () => {
  const r = await get('/needs/anger-control');
  assert.equal(r.status, 200);
  assert.ok(r.html.includes('/paths/dev-anger-7days') && r.html.includes('/library/dev-article-anger'));
  assert.ok(!r.html.includes(DRAFT) && !r.html.includes(HIDDEN));
  assert.ok(r.html.includes('/topics/anger'));
  assert.equal((await get('/needs/quran-relationship')).status, 404);
  const empty = await get('/needs/repentance');
  assert.equal(empty.status, 200);
  assert.ok(empty.html.includes('لم ننشر مواد لهذا الاحتياج بعد'), 'حالة عدم وجود محتوى صادقة');
});

test('المكتبة: ترقيم وتصفية وعدم تسرب المسودة والمخفي', async () => {
  const p1 = await get('/library');
  assert.equal(p1.status, 200);
  assert.match(p1.html, /صفحة 1 من \d+/);
  assert.ok(!p1.html.includes(DRAFT) && !p1.html.includes(HIDDEN));
  const p2 = await get('/library?page=2');
  assert.equal(p2.status, 200);
  assert.match(p2.html, /صفحة 2 من/);
  const vids = await get('/library?type=video');
  assert.ok(vids.html.includes('/library/dev-video-prayer') && !vids.html.includes('/library/dev-article-anger'));
  assert.match(vids.html, /<meta name="robots" content="noindex/);
  assert.ok(!(await get('/library')).html.includes('noindex'));
  const bad = await get('/library?type=%27%3Bdrop');
  assert.equal(bad.status, 200, 'نوع غير صالح يُتجاهل');
  const dom = await get('/library?domain=family-relations');
  assert.ok(dom.html.includes('/library/dev-link-parents') && !dom.html.includes('/library/dev-article-anger'), 'تصفية بالمجال');
  const both = await get('/library?domain=worship&type=video');
  assert.ok(both.html.includes('/library/dev-video-prayer') && !both.html.includes('/library/dev-bulk-1'), 'تصفيتان معًا');
  const beyond = await get('/library?page=999');
  assert.equal(beyond.status, 302, 'صفحة بعد الأخيرة تُحوَّل لآخر صفحة');
  assert.match(beyond.headers.get('location'), /page=\d+/);
});

test('المادة: markdown آمن ومصدر وفيديو بالنقر والمخفي 404', async () => {
  const a = await get('/library/dev-article-anger');
  assert.equal(a.status, 200);
  assert.match(a.html, /<h2>لماذا هذا العنوان؟<\/h2>/);
  assert.match(a.html, /rel="noopener nofollow ugc"/);
  assert.ok(a.html.includes('المصدر الأصلي') && a.html.includes('كتاب تجريبي'));
  assert.match(a.html, /"@type":"Article"/);
  const v = await get('/library/dev-video-prayer');
  assert.ok(v.html.includes('data-yt="aqz-KE-bpKQ"') && !v.html.includes('<iframe'), 'لا iframe قبل النقر');
  assert.equal((await get('/library/dev-hidden')).status, 404);
  assert.equal((await get('/library/dev-draft')).status, 404);
  const g = await get('/library/dev-guidance-time');
  assert.ok(g.html.includes('تلخيص أو توجيه من فريق يقظة'));
});

test('تحويل 301 عند تغيير الرابط', async () => {
  const r = await get('/library/dev-moved-old');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/library/dev-moved');
  assert.equal((await get('/library/dev-moved')).status, 200);
});

test('المسارات: القائمة والتصفية وصفحة المسار والخطوات', async () => {
  const l = await get('/paths');
  assert.ok(l.html.includes('/paths/dev-anger-7days') && l.html.includes('/paths/dev-open-path'));
  const open = await get('/paths?duration=open');
  assert.ok(open.html.includes('dev-open-path') && !open.html.includes('dev-anger-7days'));
  const p = await get('/paths/dev-anger-7days');
  assert.equal(p.status, 200);
  assert.equal(count(p.html, /class="step"/g), 4);
  assert.ok(p.html.includes('الإصدار 2') && p.html.includes('ما الجديد في هذا الإصدار'), 'يعرض آخر إصدار مع ملخصه');
  assert.ok(p.html.includes('هذه المادة غير متاحة حاليًا') && !p.html.includes(HIDDEN), 'مادة مخفية في خطوة');
  assert.ok(p.html.includes('7 أيام'));
  assert.match(p.html, /"@type":"HowTo"/);
  const open2 = await get('/paths/dev-open-path');
  assert.ok(open2.html.includes('مفتوح بلا مدة') && !open2.html.includes('المدة المقترحة'));
  const s = await get('/paths/dev-anger-7days/steps/2');
  assert.equal(s.status, 200);
  assert.match(s.html, /<meta name="robots" content="noindex/);
  assert.match(s.html, /rel="canonical" href="[^"]*\/paths\/dev-anger-7days"/);
  assert.equal((await get('/paths/dev-anger-7days/steps/9')).status, 404);
  assert.equal((await get('/paths/dev-anger-7days/steps/abc')).status, 404);
  assert.equal((await get('/paths/none')).status, 404);
});

test('البحث العربي', async () => {
  const q = (s) => get('/search?q=' + encodeURIComponent(s));
  for (const w of ['غضب', 'الغضب', 'ايمان', 'إيمان', 'اضب']) {
    const r = await q(w);
    assert.equal(r.status, 200);
    assert.ok(/href="\/(needs|paths|library|topics)\//.test(r.html), `نتائج لـ ${w}`);
  }
  const none = await q('كلمةلاوجودلها');
  assert.ok(none.html.includes('لا نتائج لهذا البحث'));
  const xss = await q('<script>alert(1)</script>');
  assert.equal(xss.status, 200);
  // داخل سمة مقتبسة تبقى < و> آمنتين لأن علامة الاقتباس تُهرَّب؛ المهم ألا يظهر وسم script قابل للتنفيذ خارج السمات
  assert.ok(!xss.html.replace(/="[^"]*"/g, '=""').includes('<script>alert(1)'), 'لا حقن في النص');
  assert.ok(!/value="[^"]*"[^>]*onfocus/i.test(xss.html));
  assert.match((await q('غضب')).html, /<meta name="robots" content="noindex/);
  assert.ok(!(await q('مسودة')).html.includes(DRAFT));
  assert.equal((await get('/search')).status, 200);
});

test('خريطة الموقع وrobots', async () => {
  const s = await get('/sitemap.xml');
  assert.equal(s.status, 200);
  assert.match(s.headers.get('content-type'), /xml/);
  assert.ok(s.html.includes('/library/dev-article-anger') && s.html.includes('/paths/dev-anger-7days') && s.html.includes('/needs/anger-control'));
  assert.ok(!s.html.includes('dev-draft') && !s.html.includes('dev-hidden') && !s.html.includes('quran-relationship'));
  assert.ok(s.html.includes('/library/dev-moved<') && !s.html.includes('dev-moved-old'));
  const r = await get('/robots.txt');
  assert.ok(r.html.includes('Sitemap:') && r.html.includes('Disallow: /search') && r.html.includes('Allow: /'));
});

test('صفحات ثابتة وعدم وجود صفحات مستخدم/إدارة', async () => {
  for (const p of ['/about', '/privacy', '/terms', '/domains', '/domains/worship', '/topics/anger', '/topics/prayer']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.equal(count(r.html, /<h1[ >]/g), 1, `h1 في ${p}`);
    assert.match(r.html, /<meta name="description" content="[^"]{20,}/, `description في ${p}`);
  }
  const j = await get('/journey');
  assert.equal(j.status, 302, '/journey يحوّل غير المسجَّل إلى الدخول');
  assert.match(j.headers.get('location'), /^\/login\?next=%2Fjourney/);
  assert.equal((await get('/journey/goals/zzz')).status, 302);
  const login = await get('/login?next=//evil.com');
  assert.equal(login.status, 200);
  assert.match(login.html, /name="next" value="\/journey"/, 'وجهة خارجية تُرفض');
  assert.match(login.html, /noindex/);
  assert.match(login.headers.get('cache-control'), /no-store/);
  assert.equal((await get('/admin')).status, 404);
  assert.equal((await get('/domains/nope')).status, 404);
  assert.equal((await get('/domains/self-discipline')).status, 200);
});
