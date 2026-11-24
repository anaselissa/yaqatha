// نقطة دخول Cloudflare: نفس معالج Astro للطلبات، ومعه مهمة يومية مجدولة.
// المهمة تطلب من Supabase طلبًا عامًا صغيرًا (مفتاح anon العام فقط) كي لا يُوقَف المشروع المجاني لقلة النشاط.
import astro from '@astrojs/cloudflare/entrypoints/server';

async function keepalive(base = import.meta.env.PUBLIC_SUPABASE_URL, key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY) {
  if (!base || !key) return 0;
  const r = await fetch(`${base}/rest/v1/doors?select=id&limit=1`, { headers: { apikey: key } });
  console.log(`keepalive status=${r.status}`);
  return r.status;
}

export default {
  fetch: astro.fetch,
  async scheduled(_event: unknown, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(keepalive());
  },
};
