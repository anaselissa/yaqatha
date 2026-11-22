import type { APIRoute } from 'astro';
import { getSitemapData } from '../lib/data';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ site }) => {
  const base = site!.toString().replace(/\/$/, '');
  const urls: { loc: string; lastmod?: string }[] = ['/', '/discover', '/domains', '/paths', '/library', '/about', '/privacy', '/terms'].map((p) => ({ loc: p }));
  try {
    const d = await getSitemapData();
    for (const x of d.doors) urls.push({ loc: `/doors/${x.slug}` });
    for (const x of d.needs) urls.push({ loc: `/needs/${x.slug}`, lastmod: x.updated_at });
    for (const x of d.domains) urls.push({ loc: `/domains/${x.slug}`, lastmod: x.updated_at });
    for (const x of d.topics) urls.push({ loc: `/topics/${x.slug}`, lastmod: x.updated_at });
    for (const x of d.paths) urls.push({ loc: `/paths/${x.slug}`, lastmod: x.published_at ?? undefined });
    for (const x of d.materials) urls.push({ loc: `/library/${x.slug}`, lastmod: x.updated_at });
    for (const x of d.series) urls.push({ loc: `/series/${x.slug}`, lastmod: x.updated_at });
  } catch (e) {
    console.error('[sitemap]', (e as Error).message);
    return new Response('خدمة مؤقتًا غير متاحة', { status: 503, headers: { 'Retry-After': '120' } });
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(base + u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('\n') +
    `\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
};
