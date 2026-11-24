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

showFlash();
hydrateState();
setupInstall();
setupReminder();
