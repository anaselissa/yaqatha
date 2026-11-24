/**
 * لوحة الإدارة — بلاغات الزوار على المواد.
 * تحكمها RLS: يقرأ البلاغات ويعدّل حالتها أعضاء الفريق (المدير والمحرر) فقط. هوية المبلِّغ لا تُعرض إطلاقًا.
 */
import { mutate, rest } from './api';
import { oneOf, uuid, type Handler } from './admin-form';

export interface Report {
  id: string; note: string | null; status: 'open' | 'resolved'; created_at: string; resolved_at: string | null;
  material: { id: string; slug: string; title: string; status: string } | null;
}

export async function listReports(token: string, status: 'open' | 'resolved') {
  return (await rest<Report>('material_reports', {
    select: 'id,note,status,created_at,resolved_at,material:materials(id,slug,title,status)',
    status: `eq.${status}`, order: status === 'open' ? 'created_at.asc' : 'resolved_at.desc', limit: '200',
  }, { token })).rows;
}

/** معرّف المستخدم من رمز الجلسة نفسه (لا نثق بأي قيمة من النموذج) */
function sub(token: string): string | null {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p)))).sub ?? null;
  } catch { return null; }
}

export const REPORT_HANDLERS: Record<string, Handler> = {
  'report-status': async ({ token, form }) => {
    const id = uuid(form, 'id');
    const status = oneOf(form, 'status', ['open', 'resolved']);
    const body = status === 'resolved'
      ? { status, resolved_by: sub(token), resolved_at: new Date().toISOString() }
      : { status, resolved_by: null, resolved_at: null };
    const done = await mutate('PATCH', 'material_reports', token, { params: { id: `eq.${id}` }, body, returning: true });
    if (!done.length) return { to: '/admin/reports', flash: 'لم يعد هذا البلاغ متاحًا', error: true };
    return status === 'resolved'
      ? { to: '/admin/reports', flash: 'أُغلق البلاغ ✓' }
      : { to: '/admin/reports?status=resolved', flash: 'أُعيد فتح البلاغ' };
  },
};
