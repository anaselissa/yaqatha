// نقطة دخول Cloudflare: نفس معالج Astro للطلبات، ومعه:
// 1) ذاكرة مؤقتة على الحافة للصفحات العامة لمن ليس داخلًا (دقيقة واحدة، كما تقول ترويسة s-maxage)،
//    فلا يُسأل Supabase عن الصفحة نفسها مع كل زائر. المستخدم الداخل لا يمر بها أبدًا.
// 2) مهمة يومية مجدولة تطلب من Supabase طلبًا عامًا صغيرًا كي لا يُوقَف المشروع المجاني لقلة النشاط.
import astro from '@astrojs/cloudflare/entrypoints/server';

type Ctx = { waitUntil(p: Promise<unknown>): void; passThroughOnException?(): void };

async function keepalive(base = import.meta.env.PUBLIC_SUPABASE_URL, key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY) {
  if (!base || !key) return 0;
  const r = await fetch(`${base}/rest/v1/doors?select=id&limit=1`, { headers: { apikey: key } });
  console.log(`keepalive status=${r.status}`);
  return r.status;
}

// مسارات لا تُخزَّن أبدًا: النماذج والدخول ولوحة الإدارة وكل ما يخص المستخدم
const NEVER = /^\/(api|auth|admin|journey|login|logout|account)(\/|$)/;
// أي ملف دخول أو رسالة عابرة يعني أن الصفحة قد تختلف لهذا الزائر
const PERSONAL_COOKIE = /(?:^|;\s*)(yq-at|yq-rt|yq-flash|yq-intent|mock_user)=/;

function cacheable(req: Request): boolean {
  if (req.method !== 'GET') return false;
  const u = new URL(req.url);
  if (NEVER.test(u.pathname) || u.pathname.startsWith('/_astro/')) return false;
  return !PERSONAL_COOKIE.test(req.headers.get('cookie') ?? '');
}

export default {
  async fetch(req: Request, env: unknown, ctx: Ctx) {
    const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    if (!edge || !cacheable(req)) return astro.fetch(req, env as never, ctx as never);
    const key = new Request(new URL(req.url).toString(), { method: 'GET' });
    const hit = await edge.match(key).catch(() => undefined);
    if (hit) return hit;
    const res = await astro.fetch(req, env as never, ctx as never);
    const cc = res.headers.get('cache-control') ?? '';
    if ((res.status === 200 || res.status === 404) && /s-maxage=\d+/.test(cc) && !res.headers.has('set-cookie')) {
      ctx.waitUntil(edge.put(key, res.clone()).catch(() => undefined));
    }
    return res;
  },
  async scheduled(_event: unknown, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(keepalive());
  },
};
