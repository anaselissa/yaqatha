import type { APIRoute } from 'astro';
import { COOKIE, exchangeCode, safeNext, sessionFromToken, setFlash, storeTokens } from '../../lib/auth';
import { runAction } from '../../lib/actions';
import { claimStaffInvite } from '../../lib/admin';

export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const secure = url.protocol === 'https:';
  const verifier = cookies.get(COOKIE.pkce)?.value;
  const next = safeNext(cookies.get(COOKIE.next)?.value);
  cookies.delete(COOKIE.pkce, { path: '/auth' });
  cookies.delete(COOKIE.next, { path: '/auth' });
  const fail = (reason: string) => redirect(`/login?next=${encodeURIComponent(next)}&error=${reason}`, 303);

  if (url.searchParams.get('error')) return fail('denied');
  const code = url.searchParams.get('code');
  if (!code || !verifier) return fail('expired');

  let tokens;
  try { tokens = await exchangeCode(code, verifier); } catch { return fail('failed'); }
  storeTokens(cookies, tokens, secure);
  // من دُعي إلى الفريق وهو مسجَّل من قبل: تُطبَّق دعوته عند دخوله، لا عند زيارة اللوحة فقط
  await claimStaffInvite(tokens.access_token).catch(() => null);

  // نية معلقة (بدء مسار/حفظ مادة) تُنفَّذ مرة واحدة ثم تُحذف
  const raw = cookies.get(COOKIE.intent)?.value;
  cookies.delete(COOKIE.intent, { path: '/' });
  if (raw) {
    try {
      const { a, f } = JSON.parse(raw) as { a: string; f: Record<string, string> };
      const session = sessionFromToken(tokens.access_token);
      if (session) {
        const form = new FormData();
        for (const [k, v] of Object.entries(f)) form.set(k, v);
        const r = await runAction(a, form, session.token);
        if (r.flash) setFlash(cookies, r.flash, r.error ? 'error' : 'ok');
        return redirect(r.to, 303);
      }
    } catch (e) { console.error('[intent] تعذر تنفيذ النية المعلقة:', e); /* نتابع للوجهة العادية */ }
  }
  setFlash(cookies, 'أهلًا بك. تم تسجيل الدخول');
  return redirect(next, 303);
};
