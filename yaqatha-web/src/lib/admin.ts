/**
 * لوحة الإدارة: القراءة والعمليات بجلسة الموظف نفسه (لا مفتاح خدمة).
 * الحماية الحقيقية في القاعدة (RLS + منح الأعمدة + مشغّلات شروط النشر)؛ هنا التحقق من المدخلات وترجمة الأخطاء فقط.
 */
import { DataError, UnauthorizedError, inList, mutate, rest, rpc } from './api';
import { BadInput, SLUG, UUID, httpUrl, oneOf, opt, slugify, str, uuid, uuids, type AdminResult, type Handler } from './admin-form';
import { PATH_HANDLERS, PATH_MESSAGES } from './admin-paths';
import { SERIES_HANDLERS, SERIES_MESSAGES } from './admin-series';
import { FOLLOWUP_HANDLERS, FOLLOWUP_MESSAGES } from './admin-followup';
import { REPORT_HANDLERS } from './admin-reports';
import { parseYoutubeId, youtubeUrl } from './youtube';
export { parseYoutubeId, youtubeInfo, youtubeThumb, youtubeUrl } from './youtube';
export { slugify };
export type { AdminResult };

export type StaffRole = 'manager' | 'editor' | 'mentor';

/** دور المستخدم في الفريق أو null. RLS تسمح لكل مستخدم بقراءة صفّه فقط. */
export async function getStaffRole(token: string, userId: string): Promise<StaffRole | null> {
  const { rows } = await rest<{ role: StaffRole }>('staff_roles', { select: 'role', user_id: `eq.${userId}`, limit: 1 }, { token });
  if (rows[0]) return rows[0].role;
  // المتابِع ليس من فريق المحتوى: يرى طلبات المتابعة المسندة إليه فقط
  try { return (await rpc<boolean>('is_mentor', {}, token)) ? 'mentor' : null; } catch { return null; }
}

/** دعوة معلّقة لمستخدم سجّل قبل دعوته: تُطبَّق عند زيارته اللوحة (الدالة تتحقق من البريد المؤكَّد) */
export async function claimStaffInvite(token: string): Promise<StaffRole | null> {
  return (await rpc<StaffRole | null>('claim_staff_invite', {}, token)) ?? null;
}

export const ROLE: Record<StaffRole, string> = { manager: 'مدير', editor: 'محرر محتوى', mentor: 'متابِع' };

export async function listTeam(token: string) {
  const [members, invites] = await Promise.all([
    rest<{ user_id: string; email: string; role: StaffRole; created_at: string }>('staff_roles', { select: 'user_id,email,role,created_at', order: 'created_at' }, { token }).then((r) => r.rows),
    rest<{ email: string; role: StaffRole; created_at: string }>('staff_invites', { select: 'email,role,created_at', order: 'created_at' }, { token }).then((r) => r.rows),
  ]);
  return { members, invites };
}

export const PUBLISH_STATUS: Record<string, string> = { draft: 'مسودة', published: 'منشورة', hidden: 'مخفية', archived: 'مؤرشفة' };
export const REVIEW_STATUS: Record<string, string> = { experimental: 'تجريبية', needs_review: 'تحتاج مراجعة', reviewed: 'تمت مراجعتها', approved: 'معتمدة' };
const MATERIAL_TYPES = ['article', 'video', 'external_link', 'guidance', 'exercise', 'reflection'];
const NATURES = ['original_source', 'yaqatha_summary'];

// ---------- القراءة ----------
export interface AdminMaterial {
  id: string; slug: string; title: string; description: string | null; type: string; body: string | null; url: string | null;
  source_title: string | null; source_url: string | null; author: string | null; nature: string; status: string; updated_at: string;
}
export interface Option { id: string; title: string; status: string; door_id?: number }

const count = async (token: string, table: string, params: Record<string, string> = {}) =>
  (await rest(table, { select: 'id', ...params }, { token, count: true, range: [0, 0] })).total ?? 0;

export async function dashboardStats(token: string) {
  const [published, draft, hidden, needsPub, needsAll, reports] = await Promise.all([
    count(token, 'materials', { status: 'eq.published' }),
    count(token, 'materials', { status: 'eq.draft' }),
    count(token, 'materials', { status: 'eq.hidden' }),
    count(token, 'needs', { status: 'eq.published' }),
    count(token, 'needs'),
    rest('material_reports', { select: 'id', status: 'eq.open' }, { token, count: true, range: [0, 0] }).then((r) => r.total ?? 0),
  ]);
  return { published, draft, hidden, needsPub, needsAll, reports };
}

export interface MaterialFilters { status?: string; type?: string; q?: string; page?: number }
const ADMIN_PAGE = 20;
export async function listAdminMaterials(token: string, f: MaterialFilters) {
  const params: Record<string, string> = { select: 'id,slug,title,type,status,url,updated_at', order: 'updated_at.desc' };
  if (f.status && PUBLISH_STATUS[f.status]) params.status = `eq.${f.status}`;
  if (f.type && MATERIAL_TYPES.includes(f.type)) params.type = `eq.${f.type}`;
  const q = (f.q ?? '').replace(/[*,()%]/g, ' ').trim();
  if (q) params.title = `ilike.*${q}*`;
  const page = Math.max(1, f.page ?? 1), from = (page - 1) * ADMIN_PAGE;
  const { rows, total } = await rest<AdminMaterial>('materials', params, { token, count: true, range: [from, from + ADMIN_PAGE - 1] });
  const reviews = rows.length
    ? (await rest<{ entity_id: string; review_status: string }>('content_review', { select: 'entity_id,review_status', entity_type: 'eq.material', entity_id: inList(rows.map((r) => r.id)) }, { token })).rows
    : [];
  const review = Object.fromEntries(reviews.map((r) => [r.entity_id, r.review_status]));
  const n = total ?? rows.length;
  return { items: rows.map((m) => ({ ...m, review: review[m.id] ?? 'experimental' })), total: n, page, pages: Math.max(1, Math.ceil(n / ADMIN_PAGE)) };
}

export async function getAdminMaterial(token: string, id: string) {
  const questions = await rest<{ id: string; prompt: string; options: string[]; correct_index: number; explanation: string | null }>('material_questions', { select: 'id,prompt,options,correct_index,explanation', material_id: `eq.${id}`, order: 'position,created_at' }, { token }).then((r) => r.rows).catch(() => []);
  const [m, needs, domains, review] = await Promise.all([
    rest<AdminMaterial>('materials', { select: '*', id: `eq.${id}` }, { token }).then((r) => r.rows[0] ?? null),
    rest<{ need_id: string }>('material_needs', { select: 'need_id', material_id: `eq.${id}` }, { token }).then((r) => r.rows.map((x) => x.need_id)),
    rest<{ domain_id: string }>('material_domains', { select: 'domain_id', material_id: `eq.${id}` }, { token }).then((r) => r.rows.map((x) => x.domain_id)),
    rest<{ review_status: string; internal_note: string | null }>('content_review', { select: 'review_status,internal_note', entity_type: 'eq.material', entity_id: `eq.${id}` }, { token }).then((r) => r.rows[0] ?? null),
  ]);
  return m ? { material: m, needIds: needs, domainIds: domains, review, questions } : null;
}

export async function taxonomyOptions(token: string) {
  const [doors, needs, domains] = await Promise.all([
    rest<{ id: number; title: string }>('doors', { select: 'id,title', order: 'sort_order' }, { token }).then((r) => r.rows),
    rest<Option>('needs', { select: 'id,title,status,door_id', order: 'door_id,sort_order' }, { token }).then((r) => r.rows),
    rest<Option>('domains', { select: 'id,title,status', order: 'sort_order' }, { token }).then((r) => r.rows),
  ]);
  return { doors, needs, domains };
}

/** عدد المواد المنشورة لكل احتياج ومجال: لتنبيه المحرر قبل نشر تصنيف بلا محتوى */
export async function contentCounts(token: string) {
  const [mn, md] = await Promise.all([
    rest<{ need_id: string; materials: { status: string } }>('material_needs', { select: 'need_id,materials!inner(status)', 'materials.status': 'eq.published' }, { token }).then((r) => r.rows),
    rest<{ domain_id: string; materials: { status: string } }>('material_domains', { select: 'domain_id,materials!inner(status)', 'materials.status': 'eq.published' }, { token }).then((r) => r.rows),
  ]);
  const tally = (ids: string[]) => ids.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
  return { needs: tally(mn.map((x) => x.need_id)), domains: tally(md.map((x) => x.domain_id)) };
}

// ---------- العمليات ----------
/** يجعل روابط المادة مطابقة للمختار: يحذف الزائد ويضيف الناقص */
async function syncLinks(token: string, table: 'material_needs' | 'material_domains', col: 'need_id' | 'domain_id', materialId: string, wanted: string[]) {
  const { rows } = await rest<Record<string, string>>(table, { select: col, material_id: `eq.${materialId}` }, { token });
  const have = rows.map((r) => r[col]);
  const remove = have.filter((x) => !wanted.includes(x)), add = wanted.filter((x) => !have.includes(x));
  if (remove.length) await mutate('DELETE', table, token, { params: { material_id: `eq.${materialId}`, [col]: inList(remove) } });
  if (add.length) await mutate('POST', table, token, { body: add.map((x) => ({ material_id: materialId, [col]: x })), ignoreDuplicates: true });
}


export const ADMIN_HANDLERS: Record<string, Handler> = {
  'material-save': async ({ token, form }) => {
    const type = oneOf(form, 'type', MATERIAL_TYPES);
    const title = str(form, 'title', 200);
    if (!title) throw new BadInput('title');
    let url = httpUrl(form, 'url');
    if (type === 'video' && url) { const id = parseYoutubeId(url); if (id) url = youtubeUrl(id); }
    const slug = (str(form, 'slug', 80) || slugify(title)).toLowerCase();
    if (!SLUG.test(slug) || slug.length < 2) throw new BadInput('slug');
    const fields = {
      slug, title, type, url,
      description: opt(form, 'description', 1000), body: opt(form, 'body', 60000), author: opt(form, 'author', 200),
      source_title: opt(form, 'source_title', 300), source_url: httpUrl(form, 'source_url'),
      nature: oneOf(form, 'nature', NATURES),
    };
    const status = oneOf(form, 'status', Object.keys(PUBLISH_STATUS));
    const review = oneOf(form, 'review_status', Object.keys(REVIEW_STATUS));

    let id = str(form, 'id', 40);
    if (id) {
      if (!UUID.test(id)) throw new BadInput('id');
      // تعارض التعديل المتزامن: لا يُحفظ إن عدّلها غيرك بعد فتحك الصفحة
      const since = str(form, 'updated_at', 40);
      const done = await mutate('PATCH', 'materials', token, { params: { id: `eq.${id}`, ...(since ? { updated_at: `eq.${since}` } : {}) }, body: fields, returning: true });
      if (!done.length) return { to: `/admin/materials/${id}`, flash: 'عدّل أحد أعضاء الفريق هذه المادة بعد أن فتحتها. أُعيد تحميلها؛ أعد تعديلك عليها', error: true };
    } else {
      const [m] = await mutate<{ id: string }>('POST', 'materials', token, { body: { ...fields, status: 'draft' }, returning: true });
      id = m.id;
    }
    await syncLinks(token, 'material_needs', 'need_id', id, uuids(form, 'need'));
    await syncLinks(token, 'material_domains', 'domain_id', id, uuids(form, 'domain'));
    await mutate('PATCH', 'content_review', token, { params: { entity_type: 'eq.material', entity_id: `eq.${id}` }, body: { review_status: review, internal_note: opt(form, 'internal_note', 2000) } });
    // الحالة آخرًا: شروط النشر في القاعدة تتطلب المصدر والربط أولًا
    try {
      await mutate('PATCH', 'materials', token, { params: { id: `eq.${id}`, status: `neq.${status}` }, body: { status } });
    } catch (e) {
      if (e instanceof DataError && e.code === 'P0001') return { to: `/admin/materials/${id}`, flash: `حُفظت المادة، لكنها لم تُنشر: ${translate(e.message)}`, error: true };
      throw e;
    }
    return { to: `/admin/materials/${id}`, flash: status === 'published' ? 'حُفظت المادة وهي منشورة الآن' : 'حُفظت المادة' };
  },

  'material-status': async ({ token, form }) => {
    const id = uuid(form, 'id'), status = oneOf(form, 'status', Object.keys(PUBLISH_STATUS));
    await mutate('PATCH', 'materials', token, { params: { id: `eq.${id}` }, body: { status } });
    const back = str(form, 'next', 300);
    return { to: back.startsWith('/admin') ? back : '/admin/materials', flash: `أصبحت المادة: ${PUBLISH_STATUS[status]}` };
  },

  'need-status': async ({ token, form }) => {
    const status = oneOf(form, 'status', ['draft', 'published', 'hidden']);
    await mutate('PATCH', 'needs', token, { params: { id: `eq.${uuid(form, 'id')}` }, body: { status } });
    return { to: '/admin/taxonomy', flash: status === 'published' ? 'نُشر الاحتياج وصار ظاهرًا للزوار' : 'أُخفي الاحتياج عن الزوار' };
  },

  'domain-status': async ({ token, form }) => {
    const status = oneOf(form, 'status', ['draft', 'published', 'hidden']);
    await mutate('PATCH', 'domains', token, { params: { id: `eq.${uuid(form, 'id')}` }, body: { status } });
    return { to: '/admin/taxonomy', flash: status === 'published' ? 'نُشر المجال' : 'أُخفي المجال عن الزوار' };
  },

  'team-invite': async ({ token, form }) => {
    const email = str(form, 'email', 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadInput('email');
    const role = oneOf(form, 'role', ['manager', 'editor']);
    const { rows } = await rest<{ role: string }>('staff_roles', { select: 'role', email: `eq.${email}` }, { token });
    if (rows.length) return { to: '/admin/team', flash: 'هذا البريد عضو في الفريق فعلًا. غيّر دوره من القائمة', error: true };
    await mutate('POST', 'staff_invites', token, { body: { email, role }, merge: true });
    return { to: '/admin/team', flash: `أُضيف ${email}. يصبح ${ROLE[role as StaffRole]} بمجرد دخوله الموقع بحساب Google بهذا البريد` };
  },
  'team-role': async ({ token, form }) => {
    const role = oneOf(form, 'role', ['manager', 'editor']);
    await mutate('PATCH', 'staff_roles', token, { params: { user_id: `eq.${uuid(form, 'user_id')}` }, body: { role } });
    return { to: '/admin/team', flash: `تغيّر الدور إلى: ${ROLE[role as StaffRole]}` };
  },
  'team-remove': async ({ token, form }) => {
    await mutate('DELETE', 'staff_roles', token, { params: { user_id: `eq.${uuid(form, 'user_id')}` } });
    return { to: '/admin/team', flash: 'أُزيل من الفريق. حسابه في الموقع باقٍ كمستخدم عادي' };
  },
  'team-uninvite': async ({ token, form }) => {
    await mutate('DELETE', 'staff_invites', token, { params: { email: `eq.${str(form, 'email', 200).toLowerCase()}` } });
    return { to: '/admin/team', flash: 'أُلغيت الإضافة' };
  },
};

ADMIN_HANDLERS['question-add'] = async ({ token, form }) => {
  const mid = uuid(form, 'material_id');
  const prompt = str(form, 'prompt', 500);
  const options = str(form, 'options', 3000).split('\n').map((o) => o.trim()).filter(Boolean).slice(0, 6);
  if (!prompt) throw new BadInput('prompt');
  if (options.length < 2 || options.length > 5 || options.some((o) => o.length > 300)) throw new BadInput('options');
  const correct = Number(str(form, 'correct', 2)) - 1;
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new BadInput('correct');
  const { rows } = await rest<{ position: number }>('material_questions', { select: 'position', material_id: `eq.${mid}`, order: 'position.desc', limit: 1 }, { token });
  await mutate('POST', 'material_questions', token, { body: { material_id: mid, prompt, options, correct_index: correct, explanation: opt(form, 'explanation', 2000), position: (rows[0]?.position ?? 0) + 1 } });
  return { to: `/admin/materials/${mid}#questions`, flash: 'أُضيف السؤال' };
};
ADMIN_HANDLERS['question-delete'] = async ({ token, form }) => {
  const mid = uuid(form, 'material_id');
  await mutate('DELETE', 'material_questions', token, { params: { id: `eq.${uuid(form, 'question_id')}`, material_id: `eq.${mid}` } });
  return { to: `/admin/materials/${mid}#questions`, flash: 'حُذف السؤال' };
};

// ---------- الأسئلة التعريفية ----------
type OnbAdminQ = { id: string; position: number; prompt: string; hint: string | null; status: string; branch: 'fix' | 'grow'; onboarding_options: { id: string; label: string; need_id: string | null; weight: number; position: number }[] };
/** قبل الهجرة 12 لا يوجد عمود branch: تُعرض كل الأسئلة في فرع «أصلح»، ويُخفى فرع «أزداد» */
export async function listOnboarding(token: string): Promise<{ qs: OnbAdminQ[]; branches: boolean }> {
  const sel = 'id,position,prompt,hint,status,onboarding_options(id,label,need_id,weight,position)';
  const tidy = (rows: OnbAdminQ[]) => rows.map((q) => ({ ...q, branch: q.branch ?? 'fix', onboarding_options: [...q.onboarding_options].sort((a, b) => a.position - b.position) }));
  try {
    return { qs: tidy((await rest<OnbAdminQ>('onboarding_questions', { select: `${sel},branch`, order: 'position,created_at' }, { token })).rows), branches: true };
  } catch (e) {
    if (!(e instanceof DataError) || e.status !== 400) throw e;
    return { qs: tidy((await rest<OnbAdminQ>('onboarding_questions', { select: sel, order: 'position,created_at' }, { token })).rows), branches: false };
  }
}
const ONB = '/admin/onboarding';
const nextPos = async (token: string, table: string, filter: Record<string, string> = {}) =>
  ((await rest<{ position: number }>(table, { select: 'position', order: 'position.desc', limit: 1, ...filter }, { token })).rows[0]?.position ?? 0) + 1;
ADMIN_HANDLERS['onb-question-add'] = async ({ token, form }) => {
  const prompt = str(form, 'prompt', 300); if (!prompt) throw new BadInput('prompt');
  const body: Record<string, unknown> = { prompt, hint: opt(form, 'hint', 300) };
  if (form.has('branch')) {
    body.branch = oneOf(form, 'branch', ['fix', 'grow']);
    body.position = await nextPos(token, 'onboarding_questions', { branch: `eq.${body.branch}` });
  } else body.position = await nextPos(token, 'onboarding_questions');
  await mutate('POST', 'onboarding_questions', token, { body });
  return { to: `${ONB}${body.branch ? `#b-${body.branch}` : ''}`, flash: 'أُضيف السؤال. أضف خياراته الآن' };
};
ADMIN_HANDLERS['onb-question-status'] = async ({ token, form }) => {
  const status = oneOf(form, 'status', ['published', 'hidden']);
  await mutate('PATCH', 'onboarding_questions', token, { params: { id: `eq.${uuid(form, 'question_id')}` }, body: { status } });
  return { to: ONB, flash: status === 'hidden' ? 'أُخفي السؤال' : 'أُظهر السؤال' };
};
ADMIN_HANDLERS['onb-question-delete'] = async ({ token, form }) => {
  await mutate('DELETE', 'onboarding_questions', token, { params: { id: `eq.${uuid(form, 'question_id')}` } });
  return { to: ONB, flash: 'حُذف السؤال وخياراته' };
};
ADMIN_HANDLERS['onb-option-add'] = async ({ token, form }) => {
  const qid = uuid(form, 'question_id'), label = str(form, 'label', 200); if (!label) throw new BadInput('label');
  const need = str(form, 'need_id', 40), weight = Number(str(form, 'weight', 1) || 1);
  if (!Number.isInteger(weight) || weight < 0 || weight > 5) throw new BadInput('weight');
  await mutate('POST', 'onboarding_options', token, { body: { question_id: qid, label, need_id: need ? uuid(form, 'need_id') : null, weight, position: await nextPos(token, 'onboarding_options', { question_id: `eq.${qid}` }) } });
  return { to: `${ONB}#q-${qid}`, flash: 'أُضيف الخيار' };
};
ADMIN_HANDLERS['onb-option-delete'] = async ({ token, form }) => {
  await mutate('DELETE', 'onboarding_options', token, { params: { id: `eq.${uuid(form, 'option_id')}` } });
  return { to: ONB, flash: 'حُذف الخيار' };
};

Object.assign(ADMIN_HANDLERS, PATH_HANDLERS, SERIES_HANDLERS, FOLLOWUP_HANDLERS, REPORT_HANDLERS);

const MESSAGES: [RegExp, string][] = [
  ...PATH_MESSAGES,
  ...SERIES_MESSAGES,
  ...FOLLOWUP_MESSAGES,
  [/needs a body or a url/, 'أضف نص المادة أو رابطها'],
  [/need a url/, 'الفيديو والمصدر الخارجي يحتاجان رابطًا'],
  [/original source/, 'أضف المصدر الأصلي (عنوانه أو رابطه)'],
  [/link the material/, 'اربط المادة باحتياج أو مجال واحد على الأقل'],
  [/slug .* was used before|duplicate key.*slug|materials_slug_key/, 'هذا الرابط مستخدم من قبل. غيّر حقل «الرابط»'],
  [/last manager/, 'لا يمكن إزالة آخر مدير أو تغيير دوره. أضف مديرًا آخر أولًا'],
  [/staff only|row-level security|permission denied/, 'ليست لديك صلاحية لهذه العملية'],
];
const translate = (m: string) => MESSAGES.find(([re]) => re.test(m))?.[1] ?? 'تعذر تنفيذ العملية';

export async function runAdminAction(name: string, form: FormData, token: string): Promise<AdminResult> {
  const h = ADMIN_HANDLERS[name];
  const id = str(form, 'id', 40);
  const mid = str(form, 'material_id', 40);
  const fallback = name.startsWith('question-') && UUID.test(mid) ? `/admin/materials/${mid}#questions`
    : name === 'material-save' && !UUID.test(id) ? '/admin/materials/new'
    : name.startsWith('material') ? (UUID.test(id) ? `/admin/materials/${id}` : '/admin/materials')
    : name.startsWith('series-') ? (UUID.test(str(form, 'series_id', 40)) ? `/admin/series/${str(form, 'series_id', 40)}` : '/admin/series/new')
    : /^(path|step|version)-/.test(name) ? (UUID.test(str(form, 'path_id', 40)) ? `/admin/paths/${str(form, 'path_id', 40)}` : '/admin/paths')
    : name.endsWith('-status') ? '/admin/taxonomy' : name.startsWith('team') ? '/admin/team'
    : name.startsWith('onb-') ? '/admin/onboarding'
    : name.startsWith('report') ? '/admin/reports'
    : name.startsWith('request') ? '/admin/requests' : /^(settings|mentor)-/.test(name) ? '/admin/settings' : '/admin';
  if (!h) return { to: '/admin', flash: 'عملية غير معروفة', error: true };
  try {
    return await h({ token, form });
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    if (e instanceof BadInput) return { to: fallback, flash: `قيمة غير صالحة في الحقل: ${FIELD[e.message] ?? e.message}`, error: true };
    if (e instanceof DataError) {
      console.error(`[admin:${name}]`, e.status, e.code, e.message);
      return { to: fallback, flash: translate(e.message), error: true };
    }
    throw e;
  }
}
const FIELD: Record<string, string> = { label: 'نص الخيار', weight: 'الوزن (0 إلى 5)', prompt: 'السؤال', options: 'الخيارات (من 2 إلى 5، كل خيار في سطر)', correct: 'رقم الإجابة الصحيحة', team_whatsapp: 'رقم واتساب (مع رمز الدولة)', mentorship_response_days: 'مدة الرد بالأيام', assigned_to: 'المسنَد إليه', links: 'روابط الحلقات (لم نجد رابط يوتيوب صالحًا)', duration_days: 'المدة', email: 'البريد', role: 'الدور', user_id: 'العضو', title: 'العنوان', slug: 'الرابط', url: 'رابط المادة', source_url: 'رابط المصدر', type: 'النوع', status: 'الحالة', id: 'المعرّف' };

