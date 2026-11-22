/** أدوات مشتركة لنماذج لوحة الإدارة: التحقق من المدخلات وتوليد الروابط */

// ---------- الروابط (slug) ----------
const AR: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ء': '', 'ؤ': 'o', 'ئ': 'e', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
  'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a', 'و': 'w', 'ي': 'y', 'ى': 'a',
};
/** رابط لاتيني مقروء من عنوان عربي أو إنجليزي: «فضل صلاة الفجر» ← fdl-sla-alfjr */
export function slugify(title: string): string {
  const s = [...title.normalize('NFKC').replace(/[ً-ٰٟـ]/g, '')]
    .map((c) => AR[c] ?? c).join('').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s.length >= 2 ? s : `m-${Math.random().toString(36).slice(2, 8)}`;
}
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface AdminResult { to: string; flash?: string; error?: boolean }
export class BadInput extends Error {}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
export const opt = (f: FormData, k: string, max = 2000) => str(f, k, max) || null;
export const uuid = (f: FormData, k: string) => { const v = str(f, k, 40); if (!UUID.test(v)) throw new BadInput(k); return v.toLowerCase(); };
export const uuids = (f: FormData, k: string) => [...new Set(f.getAll(k).map(String).filter((v) => UUID.test(v)).map((v) => v.toLowerCase()))];
export const httpUrl = (f: FormData, k: string) => { const v = opt(f, k, 500); if (v && !/^https?:\/\//i.test(v)) throw new BadInput(k); return v; };
export const oneOf = (f: FormData, k: string, allowed: string[]) => { const v = str(f, k, 30); if (!allowed.includes(v)) throw new BadInput(k); return v; };


export type Handler = (a: { token: string; form: FormData }) => Promise<AdminResult>;
