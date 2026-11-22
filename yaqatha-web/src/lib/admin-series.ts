/**
 * لوحة الإدارة — السلاسل: سلسلة = حلقات مرتبة (مواد). استيراد دفعة من روابط يوتيوب، وتحويل السلسلة إلى مسار.
 */
import { DataError, inList, mutate, rest } from './api';
import { BadInput, httpUrl, oneOf, opt, slugify, str, uuid, uuids, type Handler } from './admin-form';
import { freeSlug } from './admin-paths';
import { parseYoutubeId, youtubeInfo, youtubeUrl } from './youtube';

/** حد الحلقات في الدفعة الواحدة: كل حلقة جديدة طلب oEmbed، وCloudflare تحدّ عدد الطلبات الفرعية لكل زيارة */
export const MAX_BATCH = 25;

export interface SeriesRow { id: string; slug: string; title: string; description: string | null; author: string | null; source_url: string | null; status: string; updated_at: string }
export interface Episode { position: number; material_id: string; materials: { id: string; title: string; status: string; type: string; url: string | null; slug: string } }

// ---------- القراءة ----------
export async function listAdminSeries(token: string) {
  const { rows } = await rest<SeriesRow & { series_items: { material_id: string }[] }>('series', { select: '*,series_items(material_id)', order: 'updated_at.desc' }, { token });
  return rows.map((s) => ({ ...s, count: s.series_items.length }));
}

export async function getSeriesEditor(token: string, id: string) {
  const [series, episodes] = await Promise.all([
    rest<SeriesRow>('series', { select: '*', id: `eq.${id}` }, { token }).then((r) => r.rows[0] ?? null),
    rest<Episode>('series_items', { select: 'position,material_id,materials(id,title,status,type,url,slug)', series_id: `eq.${id}`, order: 'position' }, { token }).then((r) => r.rows),
  ]);
  return series ? { series, episodes } : null;
}

// ---------- الاستيراد ----------
/** يحوّل نص الروابط (رابط في كل سطر) إلى معرّفات يوتيوب فريدة بترتيبها */
export function parseLinks(text: string): { ids: string[]; bad: number } {
  const lines = text.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
  const ids: string[] = []; let bad = 0;
  for (const l of lines) { const id = parseYoutubeId(l); if (!id) bad++; else if (!ids.includes(id)) ids.push(id); }
  return { ids, bad };
}

/** ينشئ مواد فيديو للمقاطع الجديدة (ويعيد استخدام الموجود) ويضيفها حلقاتٍ في آخر السلسلة */
async function addVideos(token: string, seriesId: string, form: FormData) {
  const { ids, bad } = parseLinks(str(form, 'links', 20000));
  if (!ids.length) throw new BadInput('links');
  if (ids.length > MAX_BATCH) throw new DataError(`too many links (${ids.length})`);
  const urls = ids.map(youtubeUrl);
  const existing = (await rest<{ id: string; url: string }>('materials', { select: 'id,url', url: `in.(${urls.map((u) => `"${u}"`).join(',')})` }, { token })).rows;
  const known = new Map(existing.map((m) => [m.url, m.id]));
  const fresh = ids.filter((id) => !known.has(youtubeUrl(id)));

  const infos = await Promise.all(fresh.map((id) => youtubeInfo(id)));
  const { rows: last } = await rest<{ position: number }>('series_items', { select: 'position', series_id: `eq.${seriesId}`, order: 'position.desc', limit: 1 }, { token });
  const base = last[0]?.position ?? 0;
  const created: string[] = [];
  if (fresh.length) {
    const taken = new Set((await rest<{ slug: string }>('materials', { select: 'slug', slug: `like.yt-*` }, { token })).rows.map((r) => r.slug));
    const body = fresh.map((id, i) => {
      const info = infos[i];
      let slug = `yt-${slugify(info?.title || 'video').slice(0, 40)}-${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`.replace(/--+/g, '-');
      while (taken.has(slug)) slug += '-x';
      taken.add(slug);
      return {
        slug, type: 'video', url: youtubeUrl(id), title: info?.title || `حلقة ${base + urls.indexOf(youtubeUrl(id)) + 1}`, nature: 'original_source', status: 'draft',
        author: info?.channel || opt(form, 'author', 200), source_title: info?.channel ? `${info.channel} — يوتيوب` : 'يوتيوب', source_url: info?.channelUrl || youtubeUrl(id),
      };
    });
    const rows = await mutate<{ id: string; url: string }>('POST', 'materials', token, { body, returning: true });
    rows.forEach((r) => known.set(r.url, r.id));
    created.push(...rows.map((r) => r.id));
    const needs = uuids(form, 'need'), domains = uuids(form, 'domain');
    if (needs.length) await mutate('POST', 'material_needs', token, { body: created.flatMap((m) => needs.map((n) => ({ material_id: m, need_id: n }))), ignoreDuplicates: true });
    if (domains.length) await mutate('POST', 'material_domains', token, { body: created.flatMap((m) => domains.map((d) => ({ material_id: m, domain_id: d }))), ignoreDuplicates: true });
  }

  const inSeries = new Set((await rest<{ material_id: string }>('series_items', { select: 'material_id', series_id: `eq.${seriesId}` }, { token })).rows.map((r) => r.material_id));
  let pos = base;
  const items = urls.map((u) => known.get(u)!).filter((m) => !inSeries.has(m)).map((m) => ({ series_id: seriesId, material_id: m, position: ++pos }));
  if (items.length) await mutate('POST', 'series_items', token, { body: items, ignoreDuplicates: true });

  let publishNote = '';
  if (form.get('publish') === 'on' && created.length) {
    try { await mutate('PATCH', 'materials', token, { params: { id: inList(created) }, body: { status: 'published' } }); }
    catch (e) { if (e instanceof DataError && e.code === 'P0001') publishNote = ' لم تُنشر الحلقات لأنها غير مربوطة باحتياج أو مجال؛ اربطها ثم انشرها.'; else throw e; }
  }
  const reused = ids.length - fresh.length;
  return `أُضيفت ${items.length} حلقة${reused ? ` (منها ${reused} موجودة مسبقًا في المكتبة)` : ''}${bad ? `، وتُجوهل ${bad} رابط غير صالح` : ''}.${publishNote}`;
}

// ---------- العمليات ----------
const seriesFields = (form: FormData) => {
  const title = str(form, 'title', 200);
  if (!title) throw new BadInput('title');
  return { title, description: opt(form, 'description', 2000), author: opt(form, 'author', 200), source_url: httpUrl(form, 'source_url') };
};
const to = (id: string, hash = '') => `/admin/series/${id}${hash}`;

export const SERIES_HANDLERS: Record<string, Handler> = {
  'series-create': async ({ token, form }) => {
    const f = seriesFields(form);
    const [s] = await mutate<{ id: string }>('POST', 'series', token, { body: { ...f, slug: await freeSlug(token, slugify(f.title), 'series') }, returning: true });
    const hasLinks = str(form, 'links', 20000).length > 0;
    const msg = hasLinks ? await addVideos(token, s.id, form) : 'أُنشئت السلسلة. أضف حلقاتها الآن.';
    return { to: to(s.id), flash: msg };
  },

  'series-save': async ({ token, form }) => {
    const id = uuid(form, 'series_id');
    await mutate('PATCH', 'series', token, { params: { id: `eq.${id}` }, body: { ...seriesFields(form), status: oneOf(form, 'status', ['draft', 'published', 'hidden', 'archived']) } });
    return { to: to(id), flash: 'حُفظت السلسلة' };
  },

  'series-add-videos': async ({ token, form }) => {
    const id = uuid(form, 'series_id');
    return { to: to(id, '#episodes'), flash: await addVideos(token, id, form) };
  },

  'series-add-material': async ({ token, form }) => {
    const id = uuid(form, 'series_id'), m = uuid(form, 'material_id');
    const { rows } = await rest<{ position: number }>('series_items', { select: 'position', series_id: `eq.${id}`, order: 'position.desc', limit: 1 }, { token });
    await mutate('POST', 'series_items', token, { body: { series_id: id, material_id: m, position: (rows[0]?.position ?? 0) + 1 }, ignoreDuplicates: true });
    return { to: to(id, '#episodes'), flash: 'أُضيفت المادة إلى السلسلة' };
  },

  'series-move': async ({ token, form }) => {
    const id = uuid(form, 'series_id'), m = uuid(form, 'material_id'), dir = oneOf(form, 'dir', ['up', 'down']);
    const list = (await rest<{ material_id: string; position: number }>('series_items', { select: 'material_id,position', series_id: `eq.${id}`, order: 'position' }, { token })).rows;
    const i = list.findIndex((x) => x.material_id === m), j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return { to: to(id, '#episodes') };
    // لا قيد فرادة على الموضع، فيُبدَّل الموضعان بطلبين مستقلين بأمان
    await mutate('PATCH', 'series_items', token, { params: { series_id: `eq.${id}`, material_id: `eq.${list[i].material_id}` }, body: { position: list[j].position } });
    await mutate('PATCH', 'series_items', token, { params: { series_id: `eq.${id}`, material_id: `eq.${list[j].material_id}` }, body: { position: list[i].position } });
    return { to: to(id, '#episodes') };
  },

  'series-remove': async ({ token, form }) => {
    const id = uuid(form, 'series_id');
    await mutate('DELETE', 'series_items', token, { params: { series_id: `eq.${id}`, material_id: `eq.${uuid(form, 'material_id')}` } });
    return { to: to(id, '#episodes'), flash: 'أُزيلت من السلسلة (المادة باقية في المكتبة)' };
  },

  'series-publish-episodes': async ({ token, form }) => {
    const id = uuid(form, 'series_id');
    const ids = (await rest<{ material_id: string }>('series_items', { select: 'material_id', series_id: `eq.${id}` }, { token })).rows.map((r) => r.material_id);
    if (ids.length) await mutate('PATCH', 'materials', token, { params: { id: inList(ids), status: 'eq.draft' }, body: { status: 'published' } });
    return { to: to(id, '#episodes'), flash: 'نُشرت كل حلقات السلسلة' };
  },

  /** يبني مسارًا (مسودة) خطوةً لكل حلقة بترتيبها، ثم يفتح محرر المسار لإكماله */
  'series-to-path': async ({ token, form }) => {
    const id = uuid(form, 'series_id');
    const ed = await getSeriesEditor(token, id);
    if (!ed || !ed.episodes.length) throw new DataError('series has no episodes');
    const [p] = await mutate<{ id: string }>('POST', 'paths', token, { body: { slug: await freeSlug(token, slugify(ed.series.title)) }, returning: true });
    const [v] = await mutate<{ id: string }>('POST', 'path_versions', token, { body: { path_id: p.id, title: ed.series.title, description: ed.series.description }, returning: true });
    const steps = await mutate<{ id: string; position: number }>('POST', 'steps', token, {
      body: ed.episodes.map((e, i) => ({ version_id: v.id, position: i + 1, type: 'watch', title: e.materials.title.slice(0, 200), instructions: 'شاهد الحلقة، ثم دوّن فكرة واحدة ستعمل بها اليوم.' })), returning: true });
    const byPos = new Map(steps.map((s) => [s.position, s.id]));
    await mutate('POST', 'step_materials', token, { body: ed.episodes.map((e, i) => ({ step_id: byPos.get(i + 1), material_id: e.material_id, position: 1 })) });
    // يرث المسار احتياجات الحلقات ومجالاتها
    const mids = ed.episodes.map((e) => e.material_id);
    const [needs, domains] = await Promise.all([
      rest<{ need_id: string }>('material_needs', { select: 'need_id', material_id: inList(mids) }, { token }).then((r) => [...new Set(r.rows.map((x) => x.need_id))]),
      rest<{ domain_id: string }>('material_domains', { select: 'domain_id', material_id: inList(mids) }, { token }).then((r) => [...new Set(r.rows.map((x) => x.domain_id))]),
    ]);
    if (needs.length) await mutate('POST', 'path_needs', token, { body: needs.map((n) => ({ path_id: p.id, need_id: n })), ignoreDuplicates: true });
    if (domains.length) await mutate('POST', 'path_domains', token, { body: domains.map((d) => ({ path_id: p.id, domain_id: d })), ignoreDuplicates: true });
    return { to: `/admin/paths/${p.id}#steps`, flash: `أُنشئ مسار من ${ed.episodes.length} خطوة، حلقةً لكل خطوة. عدّل التعليمات وأضف أسئلة التفكير، ثم انشره.` };
  },
};

export const SERIES_MESSAGES: [RegExp, string][] = [
  [/too many links \((\d+)\)/, `الحد ${MAX_BATCH} رابطًا في المرة الواحدة. أضف الباقي على دفعة ثانية`],
  [/series has no episodes/, 'أضف حلقات للسلسلة أولًا'],
];
