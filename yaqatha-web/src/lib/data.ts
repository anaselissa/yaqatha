import { PAGE_SIZE } from '../config';
import { DataError, inList, one, rest, rpc } from './api';

export interface Door { id: number; slug: string; title: string; description: string | null; sort_order: number }
export interface Domain { id: string; slug: string; title: string; description: string | null; updated_at: string }
export interface Topic { id: string; slug: string; title: string; description: string | null; domain_id: string | null; updated_at: string }
export interface Need {
  id: string; slug: string; door_id: number; domain_id: string | null; change_type: string | null;
  title: string; description: string | null; updated_at: string;
}
export interface MaterialCard {
  id: string; slug: string; title: string; description: string | null; type: string;
  author: string | null; nature: string; updated_at: string;
}
export interface Material extends MaterialCard {
  body: string | null; url: string | null; source_title: string | null; source_url: string | null;
}
export interface PathCard {
  path_id: string; slug: string; change_type: string | null; version_id: string; version_no: number;
  title: string; description: string | null; purpose: string | null; duration_days: number | null;
  published_at: string | null; steps_count?: number; level?: string | null;
}
export interface Step {
  id: string; position: number; type: string; title: string; instructions: string | null;
  step_materials: { position: number; materials: MaterialCard | null }[];
}
export interface SearchHit { kind: 'need' | 'topic' | 'path' | 'material'; id: string; slug: string; title: string; description: string | null; rank: number }

const MATERIAL_CARD = 'id,slug,title,description,type,author,nature,updated_at';

// ---------- الأبواب والاحتياجات ----------
export const getDoors = async () => (await rest<Door>('doors', { select: '*', order: 'sort_order' })).rows;
export const getDoor = (slug: string) => one<Door>('doors', { select: '*', slug: `eq.${slug}` });

export const getNeedsByDoor = async (doorId: number) =>
  (await rest<Need>('needs', { select: '*', door_id: `eq.${doorId}`, order: 'sort_order' })).rows;

export const getNeed = (slug: string) => one<Need>('needs', { select: '*', slug: `eq.${slug}` });

async function idsFrom(table: string, filterCol: string, filterVal: string, idCol: string): Promise<string[]> {
  const { rows } = await rest<Record<string, string>>(table, { select: idCol, [filterCol]: `eq.${filterVal}`, limit: 500 });
  return rows.map((r) => r[idCol]);
}

/** مواد مرتبطة عبر جدول ربط (التصفية في القاعدة بـ !inner؛ لا قوائم id في العنوان) */
async function materialsVia(linkTable: string, col: string, id: string, limit: number): Promise<MaterialCard[]> {
  const { rows } = await rest<MaterialCard>('materials', {
    select: `${MATERIAL_CARD},${linkTable}!inner(${col})`,
    [`${linkTable}.${col}`]: `eq.${id}`, order: 'updated_at.desc', limit,
  });
  return rows;
}

export async function getMaterialsByIds(ids: string[], limit = 100): Promise<MaterialCard[]> {
  if (!ids.length) return [];
  return (await rest<MaterialCard>('materials', { select: MATERIAL_CARD, id: inList(ids), order: 'updated_at.desc', limit })).rows;
}

export async function withStepCounts(paths: PathCard[]): Promise<PathCard[]> {
  if (!paths.length) return paths;
  const { rows } = await rest<{ version_id: string }>('steps', {
    select: 'version_id', version_id: inList(paths.map((p) => p.version_id)), limit: 2000,
  });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.version_id, (counts.get(r.version_id) ?? 0) + 1);
  return paths.map((p) => ({ ...p, steps_count: counts.get(p.version_id) ?? 0 }));
}

export async function getPathsByIds(ids: string[]): Promise<PathCard[]> {
  if (!ids.length) return [];
  const { rows } = await rest<PathCard>('paths_current', { select: '*', path_id: inList(ids), order: 'published_at.desc' });
  return withStepCounts(rows);
}

export async function getNeedContent(needId: string, materialLimit = 12) {
  const pathIds = await idsFrom('path_needs', 'need_id', needId, 'path_id');
  const [paths, materials, topicLinks] = await Promise.all([
    getPathsByIds(pathIds),
    materialsVia('material_needs', 'need_id', needId, materialLimit + 1),
    idsFrom('need_topics', 'need_id', needId, 'topic_id'),
  ]);
  const topics = topicLinks.length
    ? (await rest<Topic>('topics', { select: '*', id: inList(topicLinks), order: 'title' })).rows
    : [];
  return { paths, materials: materials.slice(0, materialLimit), hasMoreMaterials: materials.length > materialLimit, topics };
}

// ---------- المجالات والموضوعات ----------
export const getDomains = async () => (await rest<Domain>('domains', { select: '*', order: 'sort_order' })).rows;
export const getDomain = (slug: string) => one<Domain>('domains', { select: '*', slug: `eq.${slug}` });
export const getTopic = (slug: string) => one<Topic>('topics', { select: '*', slug: `eq.${slug}` });
export const getTopicsByDomain = async (domainId: string) =>
  (await rest<Topic>('topics', { select: '*', domain_id: `eq.${domainId}`, order: 'title' })).rows;

export async function getDomainContent(domainId: string) {
  const [pathIds, topics] = await Promise.all([
    idsFrom('path_domains', 'domain_id', domainId, 'path_id'),
    getTopicsByDomain(domainId),
  ]);
  const [paths, materials, needs] = await Promise.all([
    getPathsByIds(pathIds),
    materialsVia('material_domains', 'domain_id', domainId, 13),
    rest<Need>('needs', { select: '*', domain_id: `eq.${domainId}`, order: 'sort_order' }).then((r) => r.rows),
  ]);
  return { paths, materials: materials.slice(0, 12), hasMoreMaterials: materials.length > 12, topics, needs };
}

export async function getTopicContent(topicId: string) {
  const needIds = await idsFrom('need_topics', 'topic_id', topicId, 'need_id');
  const [materials, needs] = await Promise.all([
    materialsVia('material_topics', 'topic_id', topicId, 13),
    needIds.length ? rest<Need>('needs', { select: '*', id: inList(needIds), order: 'sort_order' }).then((r) => r.rows) : [],
  ]);
  return { materials: materials.slice(0, 12), hasMoreMaterials: materials.length > 12, needs };
}

// ---------- المواد ----------
export interface LibraryFilters { type?: string; domain?: string; need?: string; topic?: string; page?: number }

export async function listMaterials(f: LibraryFilters) {
  const page = Math.max(1, f.page ?? 1);
  const params: Record<string, string | number> = { select: MATERIAL_CARD, order: 'updated_at.desc,id' };
  if (f.type) params.type = `eq.${f.type}`;

  // التصفية بالمجال/الاحتياج/الموضوع عبر !inner على جداول الربط (لا قوائم id)
  const links: [string, string, string, string][] = [
    ['domain', 'domains', 'material_domains', 'domain_id'],
    ['need', 'needs', 'material_needs', 'need_id'],
    ['topic', 'topics', 'material_topics', 'topic_id'],
  ];
  const selects = [MATERIAL_CARD];
  for (const [key, table, linkTable, col] of links) {
    const slug = f[key as 'domain' | 'need' | 'topic'];
    if (!slug) continue;
    const entity = await one<{ id: string }>(table, { select: 'id', slug: `eq.${slug}` });
    if (!entity) return { items: [], total: 0, page, pages: 1 };
    selects.push(`${linkTable}!inner(${col})`);
    params[`${linkTable}.${col}`] = `eq.${entity.id}`;
  }
  params.select = selects.join(',');

  const from = (page - 1) * PAGE_SIZE;
  const { rows, total } = await rest<MaterialCard>('materials', params, { range: [from, from + PAGE_SIZE - 1], count: true });
  return { items: rows, total: total ?? rows.length, page, pages: Math.max(1, Math.ceil((total ?? rows.length) / PAGE_SIZE)) };
}

export const getMaterial = (slug: string) =>
  one<Material>('materials', { select: `${MATERIAL_CARD},body,url,source_title,source_url`, slug: `eq.${slug}` });

export async function getMaterialRelations(materialId: string) {
  const [needIds, topicIds] = await Promise.all([
    idsFrom('material_needs', 'material_id', materialId, 'need_id'),
    idsFrom('material_topics', 'material_id', materialId, 'topic_id'),
  ]);
  const [needs, topics] = await Promise.all([
    needIds.length ? rest<Need>('needs', { select: '*', id: inList(needIds), order: 'sort_order' }).then((r) => r.rows) : [],
    topicIds.length ? rest<Topic>('topics', { select: '*', id: inList(topicIds), order: 'title' }).then((r) => r.rows) : [],
  ]);
  return { needs, topics };
}

// ---------- المسارات ----------
export interface PathFilters { domain?: string; duration?: 'open' | 'fixed'; level?: string; page?: number }

export async function listPaths(f: PathFilters) {
  const page = Math.max(1, f.page ?? 1);
  const params: Record<string, string | number> = { select: '*', order: 'published_at.desc,slug' };
  if (f.duration === 'open') params.duration_days = 'is.null';
  if (f.duration === 'fixed') params.duration_days = 'not.is.null';
  if (f.level) params.level = `eq.${f.level}`;
  if (f.domain) {
    const d = await getDomain(f.domain);
    const ids = d ? await idsFrom('path_domains', 'domain_id', d.id, 'path_id') : [];
    params.path_id = inList(ids);
  }
  const from = (page - 1) * PAGE_SIZE;
  const { rows, total } = await rest<PathCard>('paths_current', params, { range: [from, from + PAGE_SIZE - 1], count: true });
  return { items: await withStepCounts(rows), total: total ?? rows.length, page, pages: Math.max(1, Math.ceil((total ?? rows.length) / PAGE_SIZE)) };
}

export async function getPath(slug: string) {
  const path = await one<PathCard>('paths_current', { select: '*', slug: `eq.${slug}` });
  if (!path) return null;
  const [steps, needIds, domainIds] = await Promise.all([
    rest<Step>('steps', {
      select: `id,position,type,title,instructions,step_materials(position,materials(${MATERIAL_CARD}))`,
      version_id: `eq.${path.version_id}`, order: 'position',
    }).then((r) => r.rows),
    idsFrom('path_needs', 'path_id', path.path_id, 'need_id'),
    idsFrom('path_domains', 'path_id', path.path_id, 'domain_id'),
  ]);
  const [needs, domains, version] = await Promise.all([
    needIds.length ? rest<Need>('needs', { select: '*', id: inList(needIds), order: 'sort_order' }).then((r) => r.rows) : [],
    domainIds.length ? rest<Domain>('domains', { select: '*', id: inList(domainIds), order: 'sort_order' }).then((r) => r.rows) : [],
    one<{ changelog: string | null }>('path_versions', { select: 'changelog', id: `eq.${path.version_id}` }),
  ]);
  for (const s of steps) s.step_materials.sort((a, b) => a.position - b.position);
  // «بعده»: المستوى التالي إن حدده الفريق (الهجرة 16؛ قبلها لا شيء)
  const nl = await rest<{ next_path_id: string }>('path_next', { select: 'next_path_id', path_id: `eq.${path.path_id}`, kind: 'eq.next_level', order: 'position', limit: 1 })
    .then((r) => r.rows[0]?.next_path_id).catch(() => undefined);
  const nextLevel = nl ? await one<PathCard>('paths_current', { select: '*', path_id: `eq.${nl}` }).catch(() => null) : null;
  return { path: { ...path, steps_count: steps.length }, steps, needs, domains, changelog: version?.changelog ?? null, nextLevel };
}

// ---------- الرئيسية ----------
export async function getHomepage() {
  const { rows } = await rest<{ section: string; path_id: string | null; material_id: string | null; position: number }>(
    'homepage_items', { select: 'section,path_id,material_id,position', order: 'position' });
  const pathIds = rows.filter((r) => r.path_id).map((r) => r.path_id!);
  const materialIds = rows.filter((r) => r.material_id).map((r) => r.material_id!);
  const [paths, materials] = await Promise.all([getPathsByIds(pathIds), getMaterialsByIds(materialIds)]);
  const pBy = new Map(paths.map((p) => [p.path_id, p]));
  const mBy = new Map(materials.map((m) => [m.id, m]));
  const pick = <T,>(section: string, key: 'path_id' | 'material_id', map: Map<string, T>) =>
    rows.filter((r) => r.section === section && r[key]).map((r) => map.get(r[key]!)).filter((x): x is T => Boolean(x));
  return {
    startHere: pick('start_here', 'path_id', pBy),
    featuredPaths: pick('featured_paths', 'path_id', pBy),
    featuredMaterials: pick('featured_materials', 'material_id', mBy),
  };
}

// ---------- البحث والتحويلات ----------
export const search = (q: string) => rpc<SearchHit[]>('search_content', { q, max_results: 30 });

const REDIRECT_TABLE = { need: 'needs', domain: 'domains', topic: 'topics', material: 'materials', path: 'paths' } as const;
/** إن كان الـslug قديمًا فأعد الـslug الحالي لكيانه (لتحويل 301) */
export async function resolveRedirect(type: keyof typeof REDIRECT_TABLE, slug: string): Promise<string | null> {
  const r = await one<{ entity_id: string }>('slug_redirects', { select: 'entity_id', entity_type: `eq.${type}`, old_slug: `eq.${slug}` });
  if (!r) return null;
  const cur = await one<{ slug: string }>(REDIRECT_TABLE[type], { select: 'slug', id: `eq.${r.entity_id}` });
  return cur && cur.slug !== slug ? cur.slug : null;
}

// ---------- ابدأ من هنا (الأسئلة التعريفية) ----------
export interface OnbOption { id: string; label: string; need_id: string | null; weight: number; position: number }
export type Branch = 'fix' | 'grow';
export const BRANCHES: Record<Branch, string> = { fix: 'أريد أن أُصلح شيئًا في نفسي', grow: 'أريد أن أتقرّب إلى الله أكثر' };
export interface OnbQuestion { id: string; prompt: string; hint: string | null; branch: Branch; onboarding_options: OnbOption[] }
/** أسئلة «من أين أبدأ» (لفرع واحد أو للكل). قبل الهجرة 12 لا يوجد عمود branch: تُعامَل كلها كفرع «أصلح» */
export async function getOnboarding(branch?: Branch): Promise<OnbQuestion[]> {
  const sel = 'id,prompt,hint,onboarding_options(id,label,need_id,weight,position)';
  const tidy = (rows: OnbQuestion[]) => rows
    .map((q) => ({ ...q, branch: q.branch ?? 'fix', onboarding_options: [...q.onboarding_options].sort((a, b) => a.position - b.position) }))
    .filter((q) => q.onboarding_options.length && (!branch || q.branch === branch));
  try {
    return tidy((await rest<OnbQuestion>('onboarding_questions', { select: `${sel},branch`, order: 'position' })).rows);
  } catch (e) {
    if (e instanceof DataError && (e.code === '42703' || e.code === 'PGRST100' || e.status === 400)) {
      try { return tidy((await rest<OnbQuestion>('onboarding_questions', { select: sel, order: 'position' })).rows); } catch { /* يقع أدناه */ }
    }
    console.error('[onboarding]', (e as Error).message); return [];
  }
}

/** الاقتراح من الاختيارات (لا يُحفظ شيء): أعلى الاحتياجات وزنًا، مع مساراته وأول مواده */
export async function recommend(chosen: string[]) {
  const qs = await getOnboarding();
  const opts = qs.flatMap((q) => q.onboarding_options).filter((o) => chosen.includes(o.id));
  const score = new Map<string, number>();
  for (const o of opts) if (o.need_id && o.weight > 0) score.set(o.need_id, (score.get(o.need_id) ?? 0) + o.weight);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const needs = ranked.length ? (await rest<Need>('needs', { select: '*', id: inList(ranked) })).rows.sort((a, b) => ranked.indexOf(a.id) - ranked.indexOf(b.id)) : [];
  const top = needs[0] ?? null;
  const content = top ? await getNeedContent(top.id, 3) : null;
  return { answered: opts.length, top, others: needs.slice(1, 3), content };
}

// ---------- اختبر فهمك ----------
export interface Question { id: string; prompt: string; options: string[]; correct_index: number; explanation: string | null }
export async function getMaterialQuestions(materialId: string): Promise<Question[]> {
  try {
    return (await rest<Question>('material_questions', { select: 'id,prompt,options,correct_index,explanation', material_id: `eq.${materialId}`, order: 'position,created_at' })).rows;
  } catch (e) { console.error('[questions]', (e as Error).message); return []; }
}

// ---------- السلاسل ----------
export interface SeriesInfo { id: string; slug: string; title: string; description: string | null; author: string | null; source_url: string | null; updated_at: string }

export async function getSeries(slug: string) {
  const series = await one<SeriesInfo>('series', { select: 'id,slug,title,description,author,source_url,updated_at', slug: `eq.${slug}` });
  if (!series) return null;
  const { rows } = await rest<{ position: number; materials: MaterialCard | null }>('series_items', { select: `position,materials(${MATERIAL_CARD})`, series_id: `eq.${series.id}`, order: 'position' });
  return { series, items: rows.map((r) => r.materials).filter((m): m is MaterialCard => !!m) };
}

/** سلسلة المادة وموقعها فيها (السابقة والتالية). لا تُفشل الصفحة إن تعذّر الجلب: التنقل إضافة لا أساس. */
export async function getMaterialSeries(materialId: string) {
  try {
    const link = await one<{ series_id: string; series: { slug: string; title: string } | null }>('series_items', { select: 'series_id,series(slug,title)', material_id: `eq.${materialId}` });
    if (!link?.series) return null;
    const { rows } = await rest<{ material_id: string; materials: { slug: string; title: string } | null }>('series_items', { select: 'material_id,materials(slug,title)', series_id: `eq.${link.series_id}`, order: 'position' });
    const items = rows.filter((r) => r.materials);
    const i = items.findIndex((r) => r.material_id === materialId);
    if (i < 0) return null;
    return { slug: link.series.slug, title: link.series.title, index: i + 1, total: items.length, prev: items[i - 1]?.materials ?? null, next: items[i + 1]?.materials ?? null };
  } catch (e) {
    console.error('[series-nav]', (e as Error).message);
    return null;
  }
}

// ---------- خريطة الموقع ----------
export async function getSitemapData() {
  const [doors, needs, domains, topics, paths, materials] = await Promise.all([
    getDoors(),
    rest<{ slug: string; updated_at: string }>('needs', { select: 'slug,updated_at', limit: 1000 }).then((r) => r.rows),
    rest<{ slug: string; updated_at: string }>('domains', { select: 'slug,updated_at', limit: 1000 }).then((r) => r.rows),
    rest<{ slug: string; updated_at: string }>('topics', { select: 'slug,updated_at', limit: 1000 }).then((r) => r.rows),
    rest<{ slug: string; published_at: string | null }>('paths_current', { select: 'slug,published_at', limit: 1000 }).then((r) => r.rows),
    rest<{ slug: string; updated_at: string }>('materials', { select: 'slug,updated_at', limit: 5000 }).then((r) => r.rows),
  ]);
  const series = await rest<{ slug: string; updated_at: string }>('series', { select: 'slug,updated_at', limit: 1000 }).then((r) => r.rows).catch(() => []);
  return { doors, needs, domains, topics, paths, materials, series };
}

/** مواد الخطوة كاملة (النص والرابط) مع أسئلتها، بترتيب المعرّفات المعطاة. المنشور فقط (RLS). */
export async function getMaterialsFull(ids: string[]): Promise<(Material & { questions: Question[] })[]> {
  if (!ids.length) return [];
  const { rows } = await rest<Material>('materials', { select: `${MATERIAL_CARD},body,url,source_title,source_url`, id: inList(ids) });
  let qs: (Question & { material_id: string })[] = [];
  try {
    qs = (await rest<Question & { material_id: string }>('material_questions', { select: 'id,material_id,prompt,options,correct_index,explanation', material_id: inList(ids), order: 'position,created_at' })).rows;
  } catch (e) { console.error('[questions]', (e as Error).message); }
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).map((m) => ({ ...m, questions: qs.filter((q) => q.material_id === m.id) }));
}
