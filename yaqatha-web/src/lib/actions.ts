/**
 * عمليات المستخدم. لا منطق أعمال هنا: كلها تُمرَّر إلى RPC وRLS في القاعدة بصلاحيات المستخدم نفسه.
 * وظيفة هذا الملف: التحقق من المدخلات، وتحديد وجهة العودة، وترجمة الأخطاء إلى رسائل مفهومة.
 */
import { DataError, UnauthorizedError, mutate, one, rest, rpc } from './api';
import { notifyTeam } from './notify';
import { safeNext } from './auth';

export interface Result { to: string; flash?: string; error?: boolean }
type Handler = (a: { token: string; form: FormData }) => Promise<Result>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class BadInput extends Error {}
const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
const uuid = (f: FormData, k: string) => { const v = str(f, k, 40); if (!UUID.test(v)) throw new BadInput(k); return v.toLowerCase(); };
const back = (f: FormData, fallback = '/journey') => safeNext(str(f, 'next', 300), fallback);

const GOAL_STATUS = ['not_started', 'in_progress', 'paused', 'completed', 'archived'];
const STEP_STATE = ['not_started', 'in_progress', 'completed'];

/** الإجراءات التي يجوز للزائر بدؤها ثم تُستكمل بعد تسجيل الدخول (النية المعلقة) */
export const GUEST_INTENTS = new Set(['start-path', 'save-material']);
export const INTENT_FIELDS = ['path_id', 'material_id', 'next'];

async function domainId(slug: string): Promise<string | null> {
  if (!slug) return null;
  return (await one<{ id: string }>('domains', { select: 'id', slug: `eq.${slug}` }))?.id ?? null;
}

function goalFields(f: FormData) {
  const title = str(f, 'title', 120);
  if (!title) throw new BadInput('title');
  const date = str(f, 'target_date', 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadInput('target_date');
  return { title, description: str(f, 'description', 2000) || null, target_date: date || null };
}

export const HANDLERS: Record<string, Handler> = {
  'start-path': async ({ token, form }) => {
    // الحد المريح 3 مسارات جارية، وليس قفلًا: عند الرابع نعرض تنبيهًا، ومن أصرّ (force) يضيف
    const pid = uuid(form, 'path_id');
    if (str(form, 'force', 1) !== '1') {
      const { rows: act } = await rest<{ id: string; path_id: string }>('enrollments', { select: 'id,path_id', status: 'eq.active', limit: 50 }, { token });
      if (!act.some((e) => e.path_id === pid) && act.length >= 3) {
        const { rows: prog } = await rest<{ enrollment_id: string; total_steps: number; completed_steps: number }>('enrollment_progress', { select: 'enrollment_id,total_steps,completed_steps', enrollment_id: `in.(${act.map((e) => e.id).join(',')})` }, { token });
        const running = prog.filter((p) => p.total_steps > 0 && p.completed_steps < p.total_steps).length;
        if (running >= 3) return { to: `${back(form, '/discover').split(/[?#]/)[0]}?warn=${running}#warn` };
      }
    }
    const rows = await rpc<{ enrollment_id: string; already_active: boolean }[]>('start_path', { p_path_id: pid }, token);
    const r = rows[0];
    return { to: `/journey/paths/${r.enrollment_id}${r.already_active ? '' : '?new=1'}`,
      flash: r.already_active ? 'أنت تتابع هذا المسار فعلًا' : 'بدأتَ المسار. يُحفظ تقدمك تلقائيًا' };
  },
  'set-step': async ({ token, form }) => {
    const state = str(form, 'state', 20);
    if (!STEP_STATE.includes(state)) throw new BadInput('state');
    await rpc('set_step_state', { p_enrollment_id: uuid(form, 'enrollment_id'), p_step_id: uuid(form, 'step_id'), p_state: state }, token);
    return { to: back(form) };
  },
  'migrate': async ({ token, form }) => {
    const id = await rpc<string>('migrate_enrollment', { p_enrollment_id: uuid(form, 'enrollment_id') }, token);
    return { to: `/journey/paths/${id}`, flash: 'انتقلت إلى الإصدار الجديد وحُفظ تقدمك' };
  },
  'restart': async ({ token, form }) => {
    const id = await rpc<string>('restart_enrollment', { p_enrollment_id: uuid(form, 'enrollment_id') }, token);
    return { to: `/journey/paths/${id}`, flash: 'بدأتَ المسار من جديد. ما أنجزته سابقًا محفوظ في الأرشيف' };
  },
  'archive-enrollment': async ({ token, form }) => {
    await rpc('archive_enrollment', { p_enrollment_id: uuid(form, 'enrollment_id') }, token);
    return { to: '/journey/paths', flash: 'أُخفي المسار من رحلتك' };
  },
  'save-material': async ({ token, form }) => {
    await mutate('POST', 'saved_materials', token, { body: { material_id: uuid(form, 'material_id') }, ignoreDuplicates: true });
    return { to: back(form, '/journey/saved'), flash: 'تم حفظ المادة' };
  },
  'unsave-material': async ({ token, form }) => {
    await mutate('DELETE', 'saved_materials', token, { params: { material_id: `eq.${uuid(form, 'material_id')}` } });
    return { to: back(form, '/journey/saved'), flash: 'أُزيلت من المحفوظات' };
  },
  'report-material': async ({ token, form }) => {
    const kind = str(form, 'kind', 20);
    const KINDS = ['broken_link', 'content_error', 'unclear_source', 'other'];
    const body = { material_id: uuid(form, 'material_id'), note: str(form, 'note', 1000) || null };
    // نوع البلاغ من الهجرة 13؛ قبلها يُرسل البلاغ بلا نوع
    await mutate('POST', 'material_reports', token, { body: { ...body, ...(KINDS.includes(kind) ? { kind } : {}) } })
      .catch((e) => { if (e instanceof DataError && /kind|column/i.test(e.message)) return mutate('POST', 'material_reports', token, { body }); throw e; });
    return { to: back(form, '/'), flash: 'شكرًا لك، وصل بلاغك إلى فريق يقظة' };
  },
  'goal-create': async ({ token, form }) => {
    const id = uuid(form, 'id');
    const dom = await domainId(str(form, 'domain', 80));
    // هدف يومي (الهجرة 13): يُرسل النوع فقط إن اختاره المستخدم، فيبقى الهدف العادي يعمل قبل الهجرة
    const daily = str(form, 'kind', 10) === 'daily';
    const days = Math.min(365, Math.max(1, Number(str(form, 'days', 4)) || 30));
    const base = { id, ...goalFields(form), domain_id: dom };
    try {
      await mutate('POST', 'goals', token, { body: { ...base, ...(daily ? { kind: 'daily', days, status: 'in_progress' } : {}) }, ignoreDuplicates: true });
    } catch (e) {
      // قبل تطبيق الهجرة 13 لا يوجد عمود النوع: يُحفظ هدفًا عاديًا بدل أن يضيع ما كتبه
      if (!daily || !(e instanceof DataError) || !/kind|days|column/i.test(e.message)) throw e;
      await mutate('POST', 'goals', token, { body: base, ignoreDuplicates: true });
    }
    const enr = str(form, 'enrollment_id', 40);
    if (UUID.test(enr)) await mutate('POST', 'goal_enrollments', token, { body: { goal_id: id, enrollment_id: enr }, ignoreDuplicates: true });
    return { to: `/journey/goals/${id}`, flash: 'تم حفظ هدفك' };
  },
  'goal-checkin': async ({ token, form }) => {
    const g = uuid(form, 'goal_id'), day = str(form, 'day', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadInput('day');
    const done = str(form, 'done', 1) !== '0';
    // إدخال، فإن كان اليوم معلَّمًا من قبل نحدّث «done» فقط (لا upsert: يحتاج صلاحية تعديل كل الأعمدة)
    try {
      await mutate('POST', 'goal_checkins', token, { body: { goal_id: g, day, done } });
    } catch (e) {
      if (!(e instanceof DataError) || !(e.status === 409 || e.code === '23505')) throw e;
      await mutate('PATCH', 'goal_checkins', token, { params: { goal_id: `eq.${g}`, day: `eq.${day}` }, body: { done } });
    }
    return { to: back(form, `/journey/goals/${g}`), flash: done ? 'بارك الله فيك' : undefined };
  },
  'goal-update': async ({ token, form }) => {
    const id = uuid(form, 'id');
    await mutate('PATCH', 'goals', token, { params: { id: `eq.${id}` }, body: { ...goalFields(form), domain_id: await domainId(str(form, 'domain', 80)) } });
    return { to: `/journey/goals/${id}`, flash: 'حُفظت التعديلات' };
  },
  'goal-status': async ({ token, form }) => {
    const id = uuid(form, 'id'), status = str(form, 'status', 20);
    if (!GOAL_STATUS.includes(status)) throw new BadInput('status');
    await mutate('PATCH', 'goals', token, { params: { id: `eq.${id}` }, body: { status } });
    return { to: `/journey/goals/${id}` };
  },
  'goal-restore': async ({ token, form }) => {
    const id = uuid(form, 'id');
    await rpc('restore_goal', { p_goal_id: id }, token);
    return { to: `/journey/goals/${id}`, flash: 'استُعيد الهدف' };
  },
  'goal-delete': async ({ token, form }) => {
    await mutate('DELETE', 'goals', token, { params: { id: `eq.${uuid(form, 'id')}` } });
    return { to: '/journey/goals', flash: 'حُذف الهدف نهائيًا' };
  },
  'goal-link': async ({ token, form }) => {
    const g = uuid(form, 'goal_id');
    await mutate('POST', 'goal_enrollments', token, { body: { goal_id: g, enrollment_id: uuid(form, 'enrollment_id') }, ignoreDuplicates: true });
    return { to: back(form, `/journey/goals/${g}`), flash: 'رُبط المسار بالهدف' };
  },
  'goal-unlink': async ({ token, form }) => {
    const g = uuid(form, 'goal_id');
    await mutate('DELETE', 'goal_enrollments', token, { params: { goal_id: `eq.${g}`, enrollment_id: `eq.${uuid(form, 'enrollment_id')}` } });
    return { to: back(form, `/journey/goals/${g}`), flash: 'أُزيل الربط' };
  },
  'goal-material-add': async ({ token, form }) => {
    const g = uuid(form, 'goal_id');
    await mutate('POST', 'goal_materials', token, { body: { goal_id: g, material_id: uuid(form, 'material_id') }, ignoreDuplicates: true });
    return { to: `/journey/goals/${g}`, flash: 'رُبطت المادة بالهدف' };
  },
  'goal-material-remove': async ({ token, form }) => {
    const g = uuid(form, 'goal_id');
    await mutate('DELETE', 'goal_materials', token, { params: { goal_id: `eq.${g}`, material_id: `eq.${uuid(form, 'material_id')}` } });
    return { to: `/journey/goals/${g}`, flash: 'أُزيل الربط' };
  },
  'support-request': async ({ token, form }) => {
    const name = str(form, 'name', 80);
    const phone = str(form, 'phone', 30) || null, other = str(form, 'other_contact', 200) || null;
    if (!name || (!phone && !other)) throw new BadInput('contact');
    const topic = str(form, 'topic', 30), gender = str(form, 'gender', 10);
    const share = str(form, 'share_progress', 3) === 'on';
    const shareGoals = str(form, 'share_goals', 3) === 'on';
    const body = { name, phone, other_contact: other, preferred_time: str(form, 'preferred_time', 100) || null, topic, gender };
    // موافقة المشاركة من الهجرة 13؛ قبلها يُرسل الطلب بدونها
    // الموافقتان من الهجرتين 13 و14؛ قبلهما يُرسل الطلب بدونهما
    const extra = { ...(share ? { share_progress: true } : {}), ...(shareGoals ? { share_goals: true } : {}) };
    await mutate('POST', 'mentorship_requests', token, { body: { ...body, ...extra } })
      .catch((e) => { if ((share || shareGoals) && e instanceof DataError && /share_|column/i.test(e.message)) return mutate('POST', 'mentorship_requests', token, { body }); throw e; });
    await notifyTeam(`طلب متابعة جديد.\nافتح اللوحة: ${import.meta.env.SITE ?? ''}/admin/requests?status=new`);
    return { to: '/support', flash: 'وصل طلبك إلى فريق يقظة. سنتواصل معك قريبًا بإذن الله' };
  },
  'share-progress': async ({ token, form }) => {
    const on = str(form, 'on', 1) === '1';
    await rpc('set_share_progress', { on_off: on }, token);
    return { to: back(form, '/support'), flash: on ? 'صار مشرفك يرى تقدّمك في مساراتك' : 'أوقفت مشاركة تقدّمك' };
  },
  'share-goals': async ({ token, form }) => {
    const on = str(form, 'on', 1) === '1';
    await rpc('set_share_goals', { on_off: on }, token);
    return { to: back(form, '/support'), flash: on ? 'صار مشرفك يرى التزامك بعاداتك اليومية' : 'أوقفت مشاركة عاداتك' };
  },
  'support-withdraw': async ({ token, form }) => {
    await mutate('DELETE', 'mentorship_requests', token, { params: { id: `eq.${uuid(form, 'id')}` } });
    return { to: '/support', flash: 'سُحب طلبك وحُذفت بياناته' };
  },
  'delete-account': async ({ token, form }) => {
    if (str(form, 'confirm', 20) !== 'احذف') throw new BadInput('confirm');
    await rpc('delete_my_account', {}, token);
    return { to: '/', flash: 'حُذف حسابك وكل بياناتك' };
  },
};

const MESSAGES: [RegExp, string][] = [
  [/path is not available/, 'لم يعد هذا المسار متاحًا'],
  [/enrollment is archived/, 'هذا المسار مؤرشف ولا يقبل تعديلًا'],
  [/this version was withdrawn/, 'سُحب هذا الإصدار مؤقتًا للمراجعة'],
  [/goal limit reached/, 'بلغت الحد الأقصى من الأهداف (100). احذف أو أرشف بعضها'],
  [/last manager/, 'لا يمكن حذف حساب آخر مدير في الموقع'],
  [/already on the latest version/, 'أنت على آخر إصدار فعلًا'],
  [/no published version available/, 'لا يوجد إصدار منشور حاليًا'],
  [/mentorship requests are closed/, 'استقبال طلبات المتابعة متوقف مؤقتًا. جرّب لاحقًا أو تواصل عبر واتساب'],
  [/women section is not open/, 'قسم الأخوات لم يُفتح بعد، نسأل الله أن يكون قريبًا'],
  [/mentorship_one_open/, 'لديك طلب متابعة مفتوح فعلًا'],
  [/mentorship_requests_phone_check|mentorship_requests_check/, 'تأكد من رقم الهاتف (أرقام فقط مع رمز الدولة) أو اكتب وسيلة تواصل أخرى'],
  [/mentorship_requests_(topic|gender)_check/, 'اختر الموضوع والجنس من القائمة'],
  [/checkin day out of range/, 'لا يمكن تعليم يوم بعيد. علّم يومك فقط'],
  [/rate limited/, 'أرسلت كثيرًا خلال وقت قصير. جرّب بعد قليل'],
  [/row-level security|violates|permission denied/, 'تعذر تنفيذ العملية. قد لا تكون المادة متاحة'],
];

export async function runAction(name: string, form: FormData, token: string): Promise<Result> {
  const h = HANDLERS[name];
  if (!h) throw new BadInput('action');
  const to = back(form, name.startsWith('goal') ? '/journey/goals' : name.startsWith('support') ? '/support' : '/journey');
  try {
    return await h({ token, form });
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    if (e instanceof BadInput) return { to, flash: 'بيانات غير صالحة. راجع الحقول وحاول مرة أخرى', error: true };
    if (e instanceof DataError) {
      console.error(`[action:${name}]`, e.status, e.code, e.message);
      const m = MESSAGES.find(([re]) => re.test(e.message));
      return { to, flash: m?.[1] ?? 'تعذر تنفيذ العملية. حاول مرة أخرى', error: true };
    }
    throw e;
  }
}
