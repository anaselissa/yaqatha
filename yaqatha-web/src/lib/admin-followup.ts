/**
 * لوحة الإدارة — أرقام الأثر، وطلبات المتابعة، والإعدادات، والمتابِعون.
 * الأرقام من admin_stats() (أعداد مجمّعة فقط). الطلبات تحكمها RLS: المدير يرى الكل، والمتابِع ما أُسند إليه.
 */
import { DataError, mutate, rest, rpc } from './api';
import { BadInput, oneOf, opt, str, uuid, type Handler } from './admin-form';

export interface PathStat { id: string; slug: string; status: string; title: string; started: number; completed: number; adopted_goals: number }
export interface Stats {
  users_total: number; users_7d: number; users_30d: number; active_7d: number;
  started_total: number; completed_total: number; goals_total: number;
  requests_new: number; requests_open: number; paths: PathStat[];
}

/** null إن لم تُطبَّق الهجرة 9 بعد: تعرض اللوحة أرقام المحتوى فقط */
export async function impactStats(token: string): Promise<Stats | null> {
  try { return await rpc<Stats>('admin_stats', {}, token); }
  catch (e) { if (e instanceof DataError && (e.status === 404 || e.code === 'PGRST202')) return null; throw e; }
}

export interface Request {
  id: string; name: string; phone: string | null; other_contact: string | null; preferred_time: string | null;
  topic: string; gender: string; status: string; assigned_to: string | null; staff_note: string | null; created_at: string; updated_at: string;
  share_progress?: boolean;
  share_goals?: boolean;
}
export interface MenteePath { title: string; done: number; total: number; started_at: string; last_activity: string }
export interface MenteeGoal { title: string; days: number | null; done: number; last7: number; last_day: string | null }
export interface MenteeShare { paths: MenteePath[] | null; goals: MenteeGoal[] | null }
/** ما اختار صاحب الطلب أن يشاركه: مساراته (الهجرة 13) وعاداته اليومية (الهجرة 14). null إن لم يشارك شيئًا. */
export async function menteeProgress(token: string, id: string): Promise<MenteeShare | null> {
  try {
    const r = await rpc<MenteeShare | MenteePath[] | null>('mentee_progress', { request_id: id }, token);
    if (!r) return null;
    return Array.isArray(r) ? { paths: r, goals: null } : r; // قبل الهجرة 14 كانت تعيد قائمة المسارات وحدها
  } catch (e) { console.error('[mentee-progress]', (e as Error).message); return null; }
}
export async function listRequests(token: string, status?: string) {
  const params: Record<string, string> = { select: '*', order: 'created_at.desc', limit: '200' };
  if (status && ['new', 'contacted', 'active', 'closed'].includes(status)) params.status = `eq.${status}`;
  else params.status = 'neq.closed';
  return (await rest<Request>('mentorship_requests', params, { token })).rows;
}

/** من يمكن إسناد الطلب إليه: المتابِعون وأعضاء الفريق (بالبريد) — للمدير فقط */
export async function assignees(token: string) {
  const [mentors, staff] = await Promise.all([
    rest<{ email: string }>('mentors', { select: 'email', order: 'email' }, { token }).then((r) => r.rows.map((x) => x.email)),
    rest<{ email: string }>('staff_roles', { select: 'email', order: 'email' }, { token }).then((r) => r.rows.map((x) => x.email)),
  ]);
  return [...new Set([...mentors, ...staff])];
}
export async function listMentors(token: string) {
  return (await rest<{ email: string; created_at: string }>('mentors', { select: 'email,created_at', order: 'created_at' }, { token })).rows;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const FOLLOWUP_HANDLERS: Record<string, Handler> = {
  'request-update': async ({ token, form }) => {
    const id = uuid(form, 'id');
    const body: Record<string, unknown> = { status: oneOf(form, 'status', ['new', 'contacted', 'active', 'closed']), staff_note: opt(form, 'staff_note', 2000) };
    if (form.has('assigned_to')) {
      const a = str(form, 'assigned_to', 200).toLowerCase();
      if (a && !EMAIL.test(a)) throw new BadInput('assigned_to');
      body.assigned_to = a || null;
    }
    const done = await mutate('PATCH', 'mentorship_requests', token, { params: { id: `eq.${id}` }, body, returning: true });
    if (!done.length) return { to: '/admin/requests', flash: 'لم يعد هذا الطلب متاحًا لك', error: true };
    return { to: `/admin/requests${str(form, 'back', 100)}#r-${id}`, flash: 'حُفظ الطلب' };
  },

  'settings-save': async ({ token, form }) => {
    const wa = str(form, 'team_whatsapp', 30).replace(/[^\d+]/g, '');
    if (wa && !/^\+?\d{8,15}$/.test(wa)) throw new BadInput('team_whatsapp');
    const days = Number(str(form, 'mentorship_response_days', 3) || 3);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new BadInput('mentorship_response_days');
    const values: [string, unknown][] = [
      ['team_whatsapp', wa ? wa.replace(/^\+/, '') : null],
      ['mentorship_open', form.get('mentorship_open') === 'on'],
      ['women_section_open', form.get('women_section_open') === 'on'],
      ['mentorship_response_days', days],
    ];
    for (const [key, value] of values) await mutate('PATCH', 'app_settings', token, { params: { key: `eq.${key}` }, body: { value } });
    return { to: '/admin/settings', flash: 'حُفظت الإعدادات' };
  },

  'mentor-add': async ({ token, form }) => {
    const email = str(form, 'email', 200).toLowerCase();
    if (!EMAIL.test(email)) throw new BadInput('email');
    await mutate('POST', 'mentors', token, { body: { email }, ignoreDuplicates: true });
    return { to: '/admin/settings#mentors', flash: `أُضيف ${email} متابِعًا. يدخل اللوحة ببريد Google هذا ويرى ما يُسند إليه فقط` };
  },

  'mentor-remove': async ({ token, form }) => {
    await mutate('DELETE', 'mentors', token, { params: { email: `eq.${str(form, 'email', 200).toLowerCase()}` } });
    return { to: '/admin/settings#mentors', flash: 'أُزيل المتابِع. الطلبات المسندة إليه تبقى ظاهرة للمدير لإعادة إسنادها' };
  },
};

export const FOLLOWUP_MESSAGES: [RegExp, string][] = [
  [/only a manager can assign/, 'الإسناد للمدير فقط'],
];
