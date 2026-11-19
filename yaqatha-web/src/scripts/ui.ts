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

showFlash();
hydrateState();
