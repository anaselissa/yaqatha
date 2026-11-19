import type { APIRoute } from 'astro';
import { COOKIE, authorizeUrl, challengeOf, newVerifier, safeNext } from '../../lib/auth';

// POST فقط (محمي بفحص Origin) لمنع «login CSRF»
export const POST: APIRoute = async ({ request, cookies, redirect, url, site }) => {
  const form = await request.formData();
  const secure = url.protocol === 'https:';
  const verifier = newVerifier();
  const o = { path: '/auth', httpOnly: true, secure, sameSite: 'lax' as const, maxAge: 600 };
  cookies.set(COOKIE.pkce, verifier, o);
  cookies.set(COOKIE.next, safeNext(String(form.get('next') ?? '')), o);
  return redirect(authorizeUrl(new URL('/auth/callback', site ?? url.origin).toString(), await challengeOf(verifier)), 303);
};
