// سلوك الواجهة الخفيف: رسائل التأكيد، وحالة المستخدم في الصفحات العامة (تُخدم مخبَّأة فلا تحمل بيانات مستخدم)
const COOKIE = 'yq-flash';

function showFlash() {
  const raw = document.cookie.split('; ').find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return;
  document.cookie = `${COOKIE}=; Max-Age=0; path=/`;
  try {
    const { m, k } = JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1)));
    const el = document.createElement('div');
    el.className = 'toast' + (k === 'error' ? ' toast-error' : '');
    el.setAttribute('role', k === 'error' ? 'alert' : 'status');
    el.textContent = m;
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'إغلاق');
    close.onclick = () => el.remove();
    el.append(close);
    document.body.append(el);
    if (k !== 'error') setTimeout(() => el.remove(), 6000);
  } catch { /* رسالة تالفة */ }
}

async function hydrateState() {
  const pathForms = document.querySelectorAll<HTMLElement>('[data-path-state]');
  const matForms = document.querySelectorAll<HTMLFormElement>('[data-material-state]');
  if (!pathForms.length && !matForms.length) return;
  const q = new URLSearchParams();
  if (pathForms[0]) q.set('path', pathForms[0].dataset.pathState!);
  if (matForms[0]) q.set('material', matForms[0].dataset.materialState!);
  try {
    const r = await fetch('/api/state?' + q, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return;
    const s = await r.json();
    if (s.enrollmentId) {
      pathForms.forEach((f) => {
        const a = document.createElement('a');
        a.className = 'btn btn-primary'; a.href = `/journey/paths/${s.enrollmentId}`; a.textContent = 'تابع مسارك';
        f.replaceWith(a);
      });
    }
    if (s.saved) {
      matForms.forEach((f) => {
        f.action = '/api/unsave-material';
        const b = f.querySelector('button'); if (b) { b.textContent = 'محفوظة ✓ إزالة من المحفوظات'; b.classList.replace('btn-primary', 'btn-ghost'); }
      });
    }
  } catch { /* بلا شبكة: تبقى الأزرار الافتراضية */ }
}

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); b.textContent = 'تم النسخ ✓'; } catch { b.textContent = 'انسخه من شريط العنوان'; }
  }));

// ---------- التطبيق على الهاتف ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});

const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
let deferred: (Event & { prompt: () => Promise<void> }) | null = null;
function setupInstall() {
  const box = document.querySelector<HTMLElement>('[data-install]');
  if (!box || standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const btn = box.querySelector<HTMLButtonElement>('[data-install-btn]');
  const iosTip = box.querySelector<HTMLElement>('[data-install-ios]');
  if (ios && iosTip) { iosTip.hidden = false; box.hidden = false; return; }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e as typeof deferred; box.hidden = false; if (btn) btn.hidden = false;
  });
  btn?.addEventListener('click', async () => { if (!deferred) return; await deferred.prompt(); deferred = null; box.hidden = true; });
}

// ---------- التذكير اليومي في التقويم ----------
function setupReminder() {
  const box = document.querySelector<HTMLElement>('[data-reminder]');
  if (!box) return;
  const sel = box.querySelector<HTMLSelectElement>('select');
  const ics = box.querySelector<HTMLAnchorElement>('[data-ics]');
  const g = box.querySelector<HTMLAnchorElement>('[data-gcal]');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
  const update = () => {
    const t = sel?.value || '20:00';
    if (ics) ics.href = `/reminder.ics?t=${t}`;
    if (g) {
      const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const [h, m] = t.split(':'); const end = `${String((Number(m) + 10 >= 60 ? Number(h) + 1 : Number(h)) % 24).padStart(2, '0')}${String((Number(m) + 10) % 60).padStart(2, '0')}`;
      const q = new URLSearchParams({ action: 'TEMPLATE', text: 'يقظة: خطوتك اليوم', details: `دقائق قليلة مع خطوتك اليومية في يقظة.\n${location.origin}/journey`, recur: 'RRULE:FREQ=DAILY', dates: `${ymd}T${h}${m}00/${ymd}T${end}00`, ctz: tz });
      g.href = `https://calendar.google.com/calendar/render?${q}`;
    }
  };
  sel?.addEventListener('change', update);
  update();
}

// توقيت المستخدم ليُحسب «اليوم» بتوقيته (تعليم الأهداف اليومية)، وتحية بحسب ساعته
try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && !document.cookie.includes(`yq-tz=${encodeURIComponent(tz)}`)) document.cookie = `yq-tz=${encodeURIComponent(tz)}; Max-Age=31536000; path=/; SameSite=Lax`;
} catch { /* بلا توقيت: يُستعمل توقيت الخادم */ }
document.querySelectorAll<HTMLElement>('[data-greet]').forEach((el) => {
  const h = new Date().getHours();
  const word = h >= 4 && h < 12 ? 'صباح الخير' : h >= 12 && h < 17 ? 'طاب يومك' : 'مساء الخير';
  el.textContent = el.dataset.greet ? `${word} يا ${el.dataset.greet}` : word;
});
// يوم المستخدم في نماذج التعليم (الخادم يضع يومه احتياطًا)
document.querySelectorAll<HTMLInputElement>('input[name="day"][data-local-day]').forEach((i) => {
  const d = new Date(); i.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

// «سؤال سريع»: اختيار الإجابة يكفي (زر «تحقّق» لمن لا يعمل عنده JavaScript)
document.querySelectorAll<HTMLButtonElement>('[data-quiz-submit]').forEach((b) => {
  const f = b.form; if (!f) return;
  b.hidden = true;
  f.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((r) => r.addEventListener('change', () => f.requestSubmit()));
});
// تحميل المقطع بالنقر فقط (youtube-nocookie)
document.querySelectorAll<HTMLElement>('.video-shell[data-yt]').forEach((box) => {
  box.querySelector('button')?.addEventListener('click', () => {
    const id = box.dataset.yt;
    if (!id || !/^[\w-]{6,20}$/.test(id)) return;
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    f.title = 'مشغّل الفيديو';
    f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    box.replaceChildren(f);
  }, { once: true });
});

// المظهر: داكن / فاتح / حسب الجهاز (يُحفظ على هذا الجهاز فقط)
document.querySelectorAll<HTMLElement>('[data-theme-pick]').forEach((g) => {
  const btns = g.querySelectorAll<HTMLButtonElement>('button[data-v]');
  const apply = (v: string) => {
    try { localStorage.setItem('yq-theme', v); } catch { /* تخزين معطّل */ }
    const light = v === 'light' || (v === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
    if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  };
  let cur = 'dark'; try { cur = localStorage.getItem('yq-theme') || 'dark'; } catch { /* */ }
  btns.forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.v === cur)); b.addEventListener('click', () => apply(b.dataset.v!)); });
});

showFlash();
hydrateState();
setupInstall();
setupReminder();
