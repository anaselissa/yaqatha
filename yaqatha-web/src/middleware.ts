import { defineMiddleware } from 'astro:middleware';
import { UnauthorizedError } from './lib/api';
import { clearSession, getSession } from './lib/auth';
import { getStaffRole } from './lib/admin';

// صفحة الدخول وحدها تحتاج أن يعيد نموذجها التوجيه إلى Supabase ثم Google؛ Chrome يطبّق form-action على كل تحويلة
const SUPABASE_ORIGIN = (() => { try { return new URL(import.meta.env.PUBLIC_SUPABASE_URL).origin; } catch { return ''; } })();
const LOGIN_FORM_ACTION = `form-action 'self' ${SUPABASE_ORIGIN} https://accounts.google.com`;

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://i.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "frame-src https://www.youtube-nocookie.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const PRIVATE = ['/journey', '/api/', '/login', '/auth/', '/admin'];

export const onRequest = defineMiddleware(async (context, next) => {
  const p = context.url.pathname;
  const isPrivate = PRIVATE.some((x) => p === x.replace(/\/$/, '') || p.startsWith(x));
  context.locals.session = isPrivate ? await getSession(context.cookies, context.url.protocol === 'https:') : null;
  // /journey محمي افتراضيًا (deny by default). الاستثناء: إنشاء الهدف يعمل للزائر بمسودة محلية (F4)
  if (p.startsWith('/journey') && !p.startsWith('/journey/goals/new') && !context.locals.session) {
    return context.redirect(`/login?next=${encodeURIComponent(p + context.url.search)}&reason=journey`);
  }
  // /admin: يتطلب الدخول، وغير الموظف يرى 404 (لا نكشف وجود اللوحة). التحقق الحقيقي يبقى في القاعدة.
  const isAdmin = p === '/admin' || p.startsWith('/admin/');
  context.locals.staffRole = null;
  let denied: Response | null = null;
  if (isAdmin) {
    if (!context.locals.session) return context.redirect(`/login?next=${encodeURIComponent(p + context.url.search)}&reason=admin`);
    try {
      context.locals.staffRole = await getStaffRole(context.locals.session.token, context.locals.session.userId);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearSession(context.cookies);
        return context.redirect(`/login?next=${encodeURIComponent(p)}&reason=expired`);
      }
      throw e;
    }
    if (!context.locals.staffRole) {
      const nf = await context.rewrite('/404');
      denied = new Response(nf.body, { status: 404, headers: nf.headers });
    }
  }
  let res: Response;
  try {
    res = denied ?? await next();
  } catch (e) {
    // رفضت القاعدة رمز المستخدم (منتهٍ/ملغى): ننهي الجلسة ونعيده إلى الدخول بدل خطأ 500
    if (e instanceof UnauthorizedError) {
      clearSession(context.cookies);
      return context.redirect(`/login?next=${encodeURIComponent(p + context.url.search)}&reason=expired`);
    }
    throw e;
  }
  const h = res.headers;
  h.set('Content-Security-Policy', p === '/login' ? CSP.replace("form-action 'self'", LOGIN_FORM_ACTION) : CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const isAsset = context.url.pathname.startsWith('/_astro/');
  if (isPrivate) {
    h.set('Cache-Control', 'private, no-store');
  } else if (!isAsset && context.request.method === 'GET' && !h.has('Cache-Control')) {
    // صفحات عامة: تسري تعديلات النشر والإخفاء خلال دقيقة، مع تقديم نسخة قديمة قصيرًا عند بطء الأصل
    if (res.status === 200) h.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    else if (res.status === 404) h.set('Cache-Control', 'public, max-age=0, s-maxage=30');
    else h.set('Cache-Control', 'no-store');
  }
  return res;
});
