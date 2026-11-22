/**
 * لوحة الإدارة — المسارات: القراءة والعمليات بجلسة الموظف.
 * قواعد الإصدارات في القاعدة (مشغّلات + RPC): الإصدار المنشور مجمّد البنية، ويُعدَّل عبر إصدار مسودة جديد.
 */
import { DataError, inList, mutate, rest, rpc } from './api';
import { BadInput, oneOf, opt, slugify, str, uuid, uuids, type Handler } from './admin-form';

export const STEP_TYPES = ['watch', 'read', 'guidance', 'exercise', 'reflection', 'review'];
const CHANGE_TYPES = ['quit_haram', 'perform_duty', 'acquire_good_deed', 'increase_knowledge'];
export const VERSION_STATUS: Record<string, string> = { draft: 'مسودة', published: 'منشور', retired: 'إصدار سابق', withdrawn: 'مسحوب' };
export const PATH_STATUS: Record<string, string> = { draft: 'لم يُنشر', published: 'منشور', hidden: 'موقوف للبدء الجديد', archived: 'مؤرشف' };

export interface Version { id: string; version_no: number; status: string; title: string; description: string | null; purpose: string | null; duration_days: number | null; changelog: string | null; withdrawn_note: string | null; published_at: string | null }
export interface StepRow { id: string; position: number; type: string; title: string; instructions: string | null; step_materials: { material_id: string; materials: { id: string; title: string; status: string; type: string } | null }[] }

// ---------- القراءة ----------
export async function listAdminPaths(token: string) {
  const { rows } = await rest<{ id: string; slug: string; status: string; updated_at: string; path_versions: { version_no: number; status: string; title: string }[] }>(
    'paths', { select: 'id,slug,status,updated_at,path_versions(version_no,status,title)', order: 'updated_at.desc' }, { token });
  return rows.map((p) => {
    const vs = [...p.path_versions].sort((a, b) => b.version_no - a.version_no);
    const published = vs.find((v) => v.status === 'published');
    const draft = vs.find((v) => v.status === 'draft');
    return { ...p, title: (draft ?? published ?? vs[0])?.title ?? p.slug, published, draft };
  });
}

export async function getPathEditor(token: string, pathId: string) {
  const [path, versions, needIds, domainIds, review] = await Promise.all([
    rest<{ id: string; slug: string; status: string; change_type: string | null }>('paths', { select: 'id,slug,status,change_type', id: `eq.${pathId}` }, { token }).then((r) => r.rows[0] ?? null),
    rest<Version>('path_versions', { select: 'id,version_no,status,title,description,purpose,duration_days,changelog,withdrawn_note,published_at', path_id: `eq.${pathId}`, order: 'version_no.desc' }, { token }).then((r) => r.rows),
    rest<{ need_id: string }>('path_needs', { select: 'need_id', path_id: `eq.${pathId}` }, { token }).then((r) => r.rows.map((x) => x.need_id)),
    rest<{ domain_id: string }>('path_domains', { select: 'domain_id', path_id: `eq.${pathId}` }, { token }).then((r) => r.rows.map((x) => x.domain_id)),
    rest<{ review_status: string; internal_note: string | null }>('content_review', { select: 'review_status,internal_note', entity_type: 'eq.path', entity_id: `eq.${pathId}` }, { token }).then((r) => r.rows[0] ?? null),
  ]);
  if (!path) return null;
  const [goals, next] = await Promise.all([
    rest<{ id: string; title: string; description: string | null; position: number }>('path_suggested_goals', { select: 'id,title,description,position', path_id: `eq.${pathId}`, order: 'position' }, { token }).then((r) => r.rows),
    rest<{ next_path_id: string; position: number }>('path_next', { select: 'next_path_id,position', path_id: `eq.${pathId}`, order: 'position' }, { token }).then((r) => r.rows),
  ]);
  // نسخة العمل: المسودة إن وُجدت، وإلا الإصدار المنشور، وإلا الأحدث
  const work = versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.status === 'published') ?? versions[0] ?? null;
  const steps = work
    ? (await rest<StepRow>('steps', { select: 'id,position,type,title,instructions,step_materials(material_id,materials(id,title,status,type))', version_id: `eq.${work.id}`, order: 'position' }, { token })).rows
    : [];
  return { path, versions, work, steps, needIds, domainIds, review, goals, next, published: versions.find((v) => v.status === 'published') ?? null };
}

export async function materialOptions(token: string) {
  return (await rest<{ id: string; title: string; status: string; type: string }>('materials', { select: 'id,title,status,type', status: 'neq.archived', order: 'updated_at.desc', limit: 500 }, { token })).rows;
}

// ---------- مساعدات ----------
export async function freeSlug(token: string, base: string, table: 'paths' | 'series' | 'materials' = 'paths') {
  const { rows } = await rest<{ slug: string }>(table, { select: 'slug', slug: `like.${base}*` }, { token });
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}
async function syncPathLinks(token: string, table: 'path_needs' | 'path_domains', col: 'need_id' | 'domain_id', pathId: string, wanted: string[]) {
  const { rows } = await rest<Record<string, string>>(table, { select: col, path_id: `eq.${pathId}` }, { token });
  const have = rows.map((r) => r[col]);
  const remove = have.filter((x) => !wanted.includes(x)), add = wanted.filter((x) => !have.includes(x));
  if (remove.length) await mutate('DELETE', table, token, { params: { path_id: `eq.${pathId}`, [col]: inList(remove) } });
  if (add.length) await mutate('POST', table, token, { body: add.map((x) => ({ path_id: pathId, [col]: x })), ignoreDuplicates: true });
}
function versionFields(form: FormData) {
  const title = str(form, 'title', 200);
  if (!title) throw new BadInput('title');
  const d = str(form, 'duration_days', 4);
  const duration_days = d ? Number(d) : null;
  if (duration_days !== null && !(Number.isInteger(duration_days) && duration_days >= 1 && duration_days <= 365)) throw new BadInput('duration_days');
  return { title, description: opt(form, 'description', 1000), purpose: opt(form, 'purpose', 2000), duration_days };
}
function stepFields(form: FormData) {
  const title = str(form, 'title', 200);
  if (!title) throw new BadInput('title');
  return { type: oneOf(form, 'type', STEP_TYPES), title, instructions: opt(form, 'instructions', 10000) };
}
const materialOf = (form: FormData) => { const v = str(form, 'material_id', 40); return v ? uuid(form, 'material_id') : null; };
const editor = (pathId: string, hash = '') => `/admin/paths/${pathId}${hash}`;

/** يجعل مادة الخطوة هي المختارة. في الإصدار المنشور يُسمح بالاستبدال فقط (القاعدة تفرض ذلك). */
async function setStepMaterial(token: string, stepId: string, materialId: string | null, isDraft: boolean) {
  const { rows } = await rest<{ material_id: string }>('step_materials', { select: 'material_id', step_id: `eq.${stepId}`, order: 'position' }, { token });
  const current = rows[0]?.material_id ?? null;
  if (current === materialId && rows.length <= 1) return;
  if (!isDraft) {
    if (!current || !materialId) throw new DataError('step materials of a non-draft version may only be swapped');
    await mutate('PATCH', 'step_materials', token, { params: { step_id: `eq.${stepId}`, material_id: `eq.${current}` }, body: { material_id: materialId } });
    return;
  }
  if (rows.length) await mutate('DELETE', 'step_materials', token, { params: { step_id: `eq.${stepId}` } });
  if (materialId) await mutate('POST', 'step_materials', token, { body: { step_id: stepId, material_id: materialId, position: 1 } });
}
async function versionOfStep(token: string, stepId: string) {
  const { rows } = await rest<{ version_id: string; path_versions: { status: string } }>('steps', { select: 'version_id,path_versions(status)', id: `eq.${stepId}` }, { token });
  if (!rows[0]) throw new BadInput('step_id');
  return { versionId: rows[0].version_id, isDraft: rows[0].path_versions.status === 'draft' };
}

// ---------- العمليات ----------
export const PATH_HANDLERS: Record<string, Handler> = {
  'path-create': async ({ token, form }) => {
    const v = versionFields(form);
    const slug = await freeSlug(token, slugify(v.title));
    const change_type = str(form, 'change_type', 30) ? oneOf(form, 'change_type', CHANGE_TYPES) : null;
    const [p] = await mutate<{ id: string }>('POST', 'paths', token, { body: { slug, change_type }, returning: true });
    await mutate('POST', 'path_versions', token, { body: { path_id: p.id, ...v } });
    await syncPathLinks(token, 'path_needs', 'need_id', p.id, uuids(form, 'need'));
    await syncPathLinks(token, 'path_domains', 'domain_id', p.id, uuids(form, 'domain'));
    return { to: editor(p.id, '#steps'), flash: 'أُنشئ المسار. أضف خطواته الآن' };
  },

  'path-links': async ({ token, form }) => {
    const id = uuid(form, 'path_id');
    const change_type = str(form, 'change_type', 30) ? oneOf(form, 'change_type', CHANGE_TYPES) : null;
    await mutate('PATCH', 'paths', token, { params: { id: `eq.${id}` }, body: { change_type } });
    await syncPathLinks(token, 'path_needs', 'need_id', id, uuids(form, 'need'));
    await syncPathLinks(token, 'path_domains', 'domain_id', id, uuids(form, 'domain'));
    const review = str(form, 'review_status', 30);
    if (review) await mutate('PATCH', 'content_review', token, { params: { entity_type: 'eq.path', entity_id: `eq.${id}` }, body: { review_status: oneOf(form, 'review_status', ['experimental', 'needs_review', 'reviewed', 'approved']), internal_note: opt(form, 'internal_note', 2000) } });
    return { to: editor(id), flash: 'حُفظت إعدادات المسار' };
  },

  'path-status': async ({ token, form }) => {
    const id = uuid(form, 'path_id'), status = oneOf(form, 'status', ['published', 'hidden']);
    await mutate('PATCH', 'paths', token, { params: { id: `eq.${id}` }, body: { status } });
    return { to: editor(id), flash: status === 'hidden' ? 'أُوقف البدء الجديد. من بدأ المسار يكمله عاديًا' : 'عاد المسار ظاهرًا ويقبل البدء' };
  },

  'version-save': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id'), id = uuid(form, 'version_id');
    const v = versionFields(form);
    const body: Record<string, unknown> = { title: v.title, description: v.description, purpose: v.purpose };
    if (form.has('duration_days')) body.duration_days = v.duration_days; // المدة لا تتغير بعد النشر (الحقل لا يُرسل)
    await mutate('PATCH', 'path_versions', token, { params: { id: `eq.${id}` }, body });
    return { to: editor(pathId), flash: 'حُفظت بيانات الإصدار' };
  },

  'step-add': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id'), versionId = uuid(form, 'version_id');
    const { rows } = await rest<{ position: number }>('steps', { select: 'position', version_id: `eq.${versionId}`, order: 'position.desc', limit: 1 }, { token });
    const [s] = await mutate<{ id: string }>('POST', 'steps', token, { body: { version_id: versionId, position: (rows[0]?.position ?? 0) + 1, ...stepFields(form) }, returning: true });
    const m = materialOf(form);
    if (m) await mutate('POST', 'step_materials', token, { body: { step_id: s.id, material_id: m, position: 1 } });
    return { to: editor(pathId, '#steps'), flash: 'أُضيفت الخطوة' };
  },

  'step-save': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id'), stepId = uuid(form, 'step_id');
    const { isDraft } = await versionOfStep(token, stepId);
    const f = stepFields(form);
    await mutate('PATCH', 'steps', token, { params: { id: `eq.${stepId}` }, body: isDraft ? f : { title: f.title, instructions: f.instructions } });
    await setStepMaterial(token, stepId, materialOf(form), isDraft);
    return { to: editor(pathId, `#s-${stepId}`), flash: 'حُفظت الخطوة' };
  },

  'step-delete': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id'), stepId = uuid(form, 'step_id');
    await mutate('DELETE', 'steps', token, { params: { id: `eq.${stepId}` } });
    return { to: editor(pathId, '#steps'), flash: 'حُذفت الخطوة' };
  },

  'step-move': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id'), stepId = uuid(form, 'step_id');
    const dir = oneOf(form, 'dir', ['up', 'down']);
    const { versionId } = await versionOfStep(token, stepId);
    const ids = (await rest<{ id: string }>('steps', { select: 'id', version_id: `eq.${versionId}`, order: 'position' }, { token })).rows.map((r) => r.id);
    const i = ids.indexOf(stepId), j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return { to: editor(pathId, `#s-${stepId}`) };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await rpc('reorder_steps', { p_version_id: versionId, p_step_ids: ids }, token);
    return { to: editor(pathId, `#s-${stepId}`) };
  },

  'version-publish': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id');
    await rpc('publish_path_version', { p_version_id: uuid(form, 'version_id'), p_changelog: opt(form, 'changelog', 2000) }, token);
    // إعادة إظهار مسار موقوف عند نشر إصدار جديد له
    await mutate('PATCH', 'paths', token, { params: { id: `eq.${pathId}`, status: 'eq.hidden' }, body: { status: 'published' } });
    return { to: editor(pathId), flash: 'نُشر المسار وصار متاحًا للزوار' };
  },

  'version-new-draft': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id');
    await rpc('create_draft_version', { p_path_id: pathId }, token);
    return { to: editor(pathId, '#steps'), flash: 'أُنشئ إصدار مسودة نسخةً من المنشور. عدّل عليه ثم انشره؛ من بدأ المسار لا يتأثر' };
  },

  'path-goal-add': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id');
    const title = str(form, 'title', 120);
    if (!title) throw new BadInput('title');
    const { rows } = await rest<{ position: number }>('path_suggested_goals', { select: 'position', path_id: `eq.${pathId}`, order: 'position.desc', limit: 1 }, { token });
    await mutate('POST', 'path_suggested_goals', token, { body: { path_id: pathId, title, description: opt(form, 'description', 2000), position: (rows[0]?.position ?? 0) + 1 } });
    return { to: editor(pathId, '#ending'), flash: 'أُضيف الهدف المقترح' };
  },

  'path-goal-delete': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id');
    await mutate('DELETE', 'path_suggested_goals', token, { params: { id: `eq.${uuid(form, 'goal_id')}`, path_id: `eq.${pathId}` } });
    return { to: editor(pathId, '#ending'), flash: 'حُذف الهدف المقترح' };
  },

  'path-next-add': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id'), next = uuid(form, 'next_path_id');
    if (next === pathId) throw new BadInput('next_path_id');
    const { rows } = await rest<{ position: number }>('path_next', { select: 'position', path_id: `eq.${pathId}`, order: 'position.desc', limit: 1 }, { token });
    await mutate('POST', 'path_next', token, { body: { path_id: pathId, next_path_id: next, position: (rows[0]?.position ?? 0) + 1 }, ignoreDuplicates: true });
    return { to: editor(pathId, '#ending'), flash: 'أُضيف المسار التالي' };
  },

  'path-next-delete': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id');
    await mutate('DELETE', 'path_next', token, { params: { path_id: `eq.${pathId}`, next_path_id: `eq.${uuid(form, 'next_path_id')}` } });
    return { to: editor(pathId, '#ending'), flash: 'أُزيل من المسارات التالية' };
  },

  'version-withdraw': async ({ token, form }) => {
    const pathId = uuid(form, 'path_id');
    await rpc('withdraw_version', { p_version_id: uuid(form, 'version_id'), p_note: opt(form, 'note', 1000) }, token);
    return { to: editor(pathId), flash: 'سُحب الإصدار وأُوقف البدء الجديد. تقدم المستخدمين محفوظ' };
  },
};

export const PATH_MESSAGES: [RegExp, string][] = [
  [/needs at least one step/, 'أضف خطوة واحدة على الأقل قبل النشر'],
  [/changelog is required/, 'اكتب «ما الذي تغيّر» قبل نشر إصدار جديد'],
  [/draft version already exists/, 'يوجد إصدار مسودة لهذا المسار فعلًا'],
  [/cannot be added or removed|only title\/instructions/, 'بعد النشر يمكن تصحيح نص الخطوات فقط. لتعديل أكبر أنشئ إصدارًا جديدًا'],
  [/may only be swapped/, 'بعد النشر يمكن استبدال مادة الخطوة فقط، لا إضافتها أو حذفها'],
  [/published version is immutable/, 'مدة المسار لا تتغير بعد النشر. أنشئ إصدارًا جديدًا'],
  [/only a draft version/, 'هذه العملية للإصدار المسودة فقط'],
  [/only a published or retired version can be withdrawn/, 'لا يمكن سحب هذا الإصدار'],
];
