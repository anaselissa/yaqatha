/**
 * المصادقة عبر Supabase Auth (GoTrue) بتدفق PKCE، بلا مفاتيح سرية.
 * الجلسة = كوكيان httpOnly (access/refresh). الخادم لا «يثق» بالرمز: PostgREST يتحقق منه في كل طلب
 * وRLS تحكم؛ فإن رُفض (401) تُعامَل الجلسة كمنتهية.
 */
import type { AstroCookies } from 'astro';
import { BASE, headers, DataError } from './api';

export interface Session { token: string; userId: string; email?: string; name?: string }
export const COOKIE = { at: 'yq-at', rt: 'yq-rt', pkce: 'yq-pkce', next: 'yq-next', intent: 'yq-intent', flash: 'yq-flash' } as const;
const REFRESH_DAYS = 60;

/** وجهة آمنة: مسار نسبي داخل الموقع فقط (يمنع إعادة التوجيه المفتوحة) */
export function safeNext(n: string | null | undefined, fallback = '/journey'): string {
  if (!n || n.length > 300) return fallback;
  if (!n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\') || /[\r\n\\]/.test(n)) return fallback;
  if (n.startsWith('/auth') || n.startsWith('/api')) return fallback;
  return n;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const newVerifier = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const challengeOf = async (v: string) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));

export function decodeJwt(token: string): { sub?: string; exp?: number; email?: string; user_metadata?: { full_name?: string; name?: string } } | null {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), (c) => c.charCodeAt(0))));
  } catch { return null; }
}

const opts = (secure: boolean, maxAge: number, httpOnly = true) => ({ path: '/', httpOnly, secure, sameSite: 'lax' as const, maxAge });

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number }

export function storeTokens(cookies: AstroCookies, t: TokenResponse, secure: boolean) {
  cookies.set(COOKIE.at, t.access_token, opts(secure, Math.max(60, t.expires_in)));
  cookies.set(COOKIE.rt, t.refresh_token, opts(secure, REFRESH_DAYS * 86400));
}
export function clearSession(cookies: AstroCookies) {
  for (const n of [COOKIE.at, COOKIE.rt]) cookies.delete(n, { path: '/' });
}

async function gotrue<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(`${BASE}/auth/v1${path}`, { ...init, signal: AbortSignal.timeout(8000) }); }
  catch (e) { throw new DataError(`تعذر الاتصال بخدمة الدخول: ${(e as Error).message}`); }
  if (!res.ok) throw new DataError(`رفضت خدمة الدخول الطلب (${res.status})`, res.status);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

export const authorizeUrl = (redirectTo: string, challenge: string) =>
  `${BASE}/auth/v1/authorize?` + new URLSearchParams({ provider: 'google', redirect_to: redirectTo, code_challenge: challenge, code_challenge_method: 's256' });

export const exchangeCode = (code: string, verifier: string) =>
  gotrue<TokenResponse>('/token?grant_type=pkce', { method: 'POST', headers: headers(undefined, { 'Content-Type': 'application/json' }), body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });

const refreshTokens = (rt: string) =>
  gotrue<TokenResponse>('/token?grant_type=refresh_token', { method: 'POST', headers: headers(undefined, { 'Content-Type': 'application/json' }), body: JSON.stringify({ refresh_token: rt }) });

export const signOut = (token: string) => gotrue('/logout?scope=local', { method: 'POST', headers: headers(token) }).catch(() => null);

export function sessionFromToken(token: string): Session | null {
  return toSession(token);
}
function toSession(token: string): Session | null {
  const c = decodeJwt(token);
  if (!c?.sub) return null;
  return { token, userId: c.sub, email: c.email, name: c.user_metadata?.full_name ?? c.user_metadata?.name };
}

/** يقرأ الجلسة من الكوكيز، ويجدّد الرمز تلقائيًا عند قرب انتهائه */
export async function getSession(cookies: AstroCookies, secure: boolean): Promise<Session | null> {
  const at = cookies.get(COOKIE.at)?.value;
  const c = at ? decodeJwt(at) : null;
  if (at && c?.exp && c.exp - Math.floor(Date.now() / 1000) > 30) return toSession(at);
  const rt = cookies.get(COOKIE.rt)?.value;
  if (!rt) return null;
  try {
    const t = await refreshTokens(rt);
    storeTokens(cookies, t, secure);
    return toSession(t.access_token);
  } catch (e) {
    if (e instanceof DataError && e.status && e.status < 500) clearSession(cookies); // رمز التجديد مرفوض
    return null;
  }
}

export function setFlash(cookies: AstroCookies, message: string, kind: 'ok' | 'error' = 'ok') {
  cookies.set(COOKIE.flash, JSON.stringify({ m: message, k: kind }), { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 });
}
