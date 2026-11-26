/**
 * لوحة الإدارة — «واجهة الموقع» (الهجرة 18).
 * عبارات «أحسنت» ونصيحة اليوم: المدير والمحرر. روابط التواصل والصفحات النصية: المدير (تفرضها RLS أيضًا).
 */
import { mutate, rest } from './api';
import { BadInput, httpUrl, oneOf, opt, str, uuid, type Handler } from './admin-form';
import { clearSiteCache } from './site';

export const SITE_LISTS = {
  cheers: { table: 'cheers', title: 'عبارات «أحسنت»', one: 'العبارة', max: 300, hint: 'تظهر بالتناوب بعد كل خطوة. راجع النص ومصدره قبل الحفظ.' },
  tips: { table: 'daily_tips', title: 'نصيحة اليوم', one: 'النصيحة', max: 500, hint: 'نصيحة قصيرة بمصدرها تظهر أعلى «يومك»، واحدة كل يوم بالترتيب.' },
} as const;
export type SiteList = keyof typeof SITE_LISTS;
export interface SiteItem { id: string; text: string; source: string | null; position: number; status: string }

export async function listSiteItems(token: string, list: SiteList) {
  return (await rest<SiteItem>(SITE_LISTS[list].table, { select: 'id,text,source,position,status', order: 'position,created_at' }, { token })).rows;
}

const listOf = (form: FormData) => oneOf(form, 'list', Object.keys(SITE_LISTS)) as SiteList;
const back = (list: SiteList, hash = '') => `/admin/site/${list}${hash}`;
function itemFields(form: FormData, list: SiteList) {
  const text = str(form, 'text', SITE_LISTS[list].max);
  if (!text) throw new BadInput('text');
  return { text, source: opt(form, 'source', 200), status: form.get('hidden') ? 'hidden' : 'published' };
}

export const SITE_HANDLERS: Record<string, Handler> = {
  'site-item-add': async ({ token, form }) => {
    const list = listOf(form), t = SITE_LISTS[list].table;
    const { rows } = await rest<{ position: number }>(t, { select: 'position', order: 'position.desc', limit: 1 }, { token });
    await mutate('POST', t, token, { body: { ...itemFields(form, list), position: (rows[0]?.position ?? 0) + 1 } });
    clearSiteCache();
    return { to: back(list), flash: 'أُضيفت' };
  },
  'site-item-save': async ({ token, form }) => {
    const list = listOf(form);
    await mutate('PATCH', SITE_LISTS[list].table, token, { params: { id: `eq.${uuid(form, 'id')}` }, body: itemFields(form, list) });
    clearSiteCache();
    return { to: back(list), flash: 'حُفظت' };
  },
  'site-item-delete': async ({ token, form }) => {
    const list = listOf(form);
    await mutate('DELETE', SITE_LISTS[list].table, token, { params: { id: `eq.${uuid(form, 'id')}` } });
    clearSiteCache();
    return { to: back(list), flash: 'حُذفت' };
  },
  'site-item-move': async ({ token, form }) => {
    const list = listOf(form), t = SITE_LISTS[list].table, id = uuid(form, 'id');
    const dir = oneOf(form, 'dir', ['up', 'down']);
    const rows = await listSiteItems(token, list);
    const i = rows.findIndex((r) => r.id === id), j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return { to: back(list) };
    [rows[i], rows[j]] = [rows[j], rows[i]];
    await Promise.all(rows.map((r, k) => (r.position === k + 1 ? null : mutate('PATCH', t, token, { params: { id: `eq.${r.id}` }, body: { position: k + 1 } }))));
    return { to: back(list) };
  },
  'site-links-save': async ({ token, form }) => {
    const wa = httpUrl(form, 'community_whatsapp_url'), ig = httpUrl(form, 'instagram_url');
    await Promise.all([
      mutate('PATCH', 'app_settings', token, { params: { key: 'eq.community_whatsapp_url' }, body: { value: wa ?? '' } }),
      mutate('PATCH', 'app_settings', token, { params: { key: 'eq.instagram_url' }, body: { value: ig ?? '' } }),
    ]);
    clearSiteCache();
    return { to: '/admin/site/links', flash: 'حُفظت الروابط' };
  },
};

export async function getLinksForEdit(token: string) {
  const { rows } = await rest<{ key: string; value: unknown }>('app_settings', { select: 'key,value', key: 'in.(community_whatsapp_url,instagram_url)' }, { token });
  const v = (k: string) => { const x = rows.find((r) => r.key === k)?.value; return typeof x === 'string' ? x : ''; };
  return { whatsapp: v('community_whatsapp_url'), instagram: v('instagram_url'), ready: rows.length === 2 };
}
