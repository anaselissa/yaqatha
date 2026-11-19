/**
 * عميل REST خفيف لـ Supabase/PostgREST.
 * - بلا token: المفتاح العام (anon) فقط. - مع token: JWT المستخدم، فتسري RLS عليه.
 * لا يُستخدم أي مفتاح سري في هذا المشروع إطلاقًا.
 */
export class DataError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
    this.name = 'DataError';
  }
}
/** رفض الخادم لرمز المستخدم (منتهٍ أو غير صالح): تُعامَل الجلسة كمنتهية */
export class UnauthorizedError extends DataError {
  constructor() { super('الجلسة غير صالحة', 401); this.name = 'UnauthorizedError'; }
}

export const BASE = import.meta.env.PUBLIC_SUPABASE_URL;
export const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
export const isConfigured = Boolean(BASE && KEY);
// المفاتيح الجديدة (sb_publishable_…) ليست JWT: تُرسل في apikey فقط ولا تُرسل كـ Bearer
const KEY_IS_JWT = !KEY?.startsWith('sb_');

type Params = Record<string, string | number | undefined>;

export function headers(token?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: KEY, Accept: 'application/json', ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  else if (KEY_IS_JWT) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function call(url: URL, init: RequestInit, hasToken: boolean): Promise<Response> {
  if (!isConfigured) throw new DataError('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY غير مضبوطين');
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new DataError(`تعذر الاتصال بقاعدة البيانات: ${(e as Error).message}`);
  }
  if (!res.ok) {
    if (res.status === 401 && hasToken) throw new UnauthorizedError();
    let code: string | undefined, message = `خطأ ${res.status} من قاعدة البيانات`;
    try { const j = await res.clone().json(); code = j.code; if (j.message) message = j.message; } catch { /* لا جسم */ }
    throw new DataError(message, res.status, code);
  }
  return res;
}

function buildUrl(path: string, params: Params): URL {
  const url = new URL(`${BASE}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url;
}

export interface ReadOpts { range?: [number, number]; count?: boolean; token?: string }

async function countOnly(table: string, params: Params, token?: string): Promise<number> {
  const url = buildUrl(table, { ...params, order: undefined, select: 'id' });
  const res = await call(url, { method: 'HEAD', headers: headers(token, { Prefer: 'count=exact' }) }, !!token);
  return Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
}

export async function rest<T>(table: string, params: Params = {}, opts: ReadOpts = {}): Promise<{ rows: T[]; total: number | null }> {
  const extra: Record<string, string> = {};
  if (opts.range) { extra['Range-Unit'] = 'items'; extra['Range'] = `${opts.range[0]}-${opts.range[1]}`; }
  if (opts.count) extra['Prefer'] = 'count=exact';
  let res: Response;
  try {
    res = await call(buildUrl(table, params), { headers: headers(opts.token, extra) }, !!opts.token);
  } catch (e) {
    // 416: صفحة بعد آخر نتيجة؛ ليست خطأ بل نتيجة فارغة مع الإجمالي الحقيقي
    if (e instanceof DataError && e.status === 416) return { rows: [], total: await countOnly(table, params, opts.token) };
    throw e;
  }
  const rows = (await res.json()) as T[];
  const cr = res.headers.get('content-range'); // "0-11/34"
  const total = cr && cr.includes('/') && !cr.endsWith('/*') ? Number(cr.split('/')[1]) : null;
  return { rows, total };
}

export async function one<T>(table: string, params: Params = {}, token?: string): Promise<T | null> {
  const { rows } = await rest<T>(table, { ...params, limit: 1 }, { token });
  return rows[0] ?? null;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>, token?: string): Promise<T> {
  const res = await call(buildUrl(`rpc/${fn}`, {}), {
    method: 'POST', headers: headers(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(args),
  }, !!token);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** كتابة عبر REST بصلاحيات المستخدم (RLS تحكم). ignoreDuplicates يجعل الإدراج متكافئًا. */
export async function mutate<T = unknown>(
  method: 'POST' | 'PATCH' | 'DELETE', table: string, token: string,
  o: { params?: Params; body?: unknown; ignoreDuplicates?: boolean; returning?: boolean } = {},
): Promise<T[]> {
  const prefer = [o.ignoreDuplicates ? 'resolution=ignore-duplicates' : '', o.returning ? 'return=representation' : 'return=minimal'].filter(Boolean).join(',');
  const res = await call(buildUrl(table, o.params ?? {}), {
    method, headers: headers(token, { 'Content-Type': 'application/json', Prefer: prefer }),
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  }, true);
  const text = await res.text();
  return (text ? JSON.parse(text) : []) as T[];
}

/** قائمة معرّفات بصيغة PostgREST للقوائم الصغيرة فقط (الكبيرة تُصفّى عبر !inner) */
export const inList = (ids: string[]) => `in.(${ids.length ? ids.join(',') : '00000000-0000-0000-0000-000000000000'})`;
