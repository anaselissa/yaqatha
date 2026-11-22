/**
 * المتابعة المباشرة من فريق يقظة: الإعدادات العامة، وطلب المستخدم الحالي.
 * الإعدادات عامة القراءة؛ والطلب لا يراه إلا صاحبه والمدير والمتابِع المسنَد (RLS).
 */
import { rest } from './api';

export const TOPICS: Record<string, string> = {
  prayer: 'المحافظة على الصلاة', repentance: 'التوبة والرجوع إلى الله', quit_habit: 'ترك ذنب أو عادة',
  quran: 'العلاقة بالقرآن', faith: 'تقوية الإيمان', character: 'الأخلاق وضبط النفس',
  family: 'الأهل والعلاقات', time: 'الوقت والمسؤوليات', knowledge: 'طلب العلم', other: 'أمر آخر',
};
export const REQUEST_STATUS: Record<string, string> = { new: 'جديد', contacted: 'تم التواصل', active: 'متابعة مستمرة', closed: 'منتهٍ' };

export interface Settings { team_whatsapp: string | null; mentorship_open: boolean; women_section_open: boolean; mentorship_response_days: number }
const DEFAULTS: Settings = { team_whatsapp: null, mentorship_open: false, women_section_open: false, mentorship_response_days: 3 };

/** الإعدادات العامة. عند تعذّرها (قبل تطبيق الهجرة مثلًا) تُرجع قيمًا آمنة: الطلبات مغلقة. */
export async function getSettings(token?: string): Promise<Settings> {
  try {
    const { rows } = await rest<{ key: string; value: unknown }>('app_settings', { select: 'key,value' }, { token });
    const s = { ...DEFAULTS } as Record<string, unknown>;
    for (const r of rows) s[r.key] = r.value;
    return s as unknown as Settings;
  } catch (e) {
    console.error('[settings]', (e as Error).message);
    return DEFAULTS;
  }
}

/** رابط واتساب بأرقام دولية فقط (wa.me لا يقبل غيرها) */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) return null;
  if (!/^\d{8,15}$/.test(d)) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export interface MyRequest { id: string; status: string; topic: string; created_at: string }
export async function getMyRequest(token: string, userId: string): Promise<MyRequest | null> {
  try {
    const { rows } = await rest<MyRequest>('mentorship_requests', { select: 'id,status,topic,created_at', user_id: `eq.${userId}`, status: 'neq.closed', limit: 1 }, { token });
    return rows[0] ?? null;
  } catch { return null; }
}
