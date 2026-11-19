import type { APIRoute } from 'astro';
import { UnauthorizedError } from '../../lib/api';
import { GUEST_INTENTS, INTENT_FIELDS, HANDLERS, runAction } from '../../lib/actions';
import { COOKIE, clearSession, safeNext, setFlash } from '../../lib/auth';

export const POST: APIRoute = async ({ params, request, locals, cookies, redirect, url }) => {
  const name = params.action!;
  if (!(name in HANDLERS)) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const secure = url.protocol === 'https:';
  const session = locals.session;

  if (!session) {
    // الزائر: نحفظ «النية» الصغيرة فقط (لا بيانات شخصية) ثم نطلب الدخول، وتُنفَّذ بعده مرة واحدة
    const next = safeNext(String(form.get('next') ?? ''), '/');
    if (GUEST_INTENTS.has(name)) {
      const f: Record<string, string> = {};
      for (const k of INTENT_FIELDS) if (form.has(k)) f[k] = String(form.get(k)).slice(0, 300);
      cookies.set(COOKIE.intent, JSON.stringify({ a: name, f }), { path: '/', httpOnly: true, secure, sameSite: 'lax', maxAge: 900 });
    }
    return redirect(`/login?next=${encodeURIComponent(next)}&reason=${encodeURIComponent(name)}`, 303);
  }

  try {
    const r = await runAction(name, form, session.token);
    if (r.flash) setFlash(cookies, r.flash, r.error ? 'error' : 'ok');
    if (name === 'delete-account' && !r.error) clearSession(cookies);
    return redirect(r.to, 303);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      clearSession(cookies);
      return redirect(`/login?next=${encodeURIComponent(safeNext(String(form.get('next') ?? ''), '/'))}&reason=expired`, 303);
    }
    throw e;
  }
};
