import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = site!.toString().replace(/\/$/, '');
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /search',
    'Disallow: /journey',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /auth',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
