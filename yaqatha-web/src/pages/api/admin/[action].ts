import type { APIRoute } from 'astro';
import { UnauthorizedError } from '../../../lib/api';
import { ADMIN_HANDLERS, runAdminAction } from '../../../lib/admin';
import { clearSession, setFlash } from '../../../lib/auth';

// عمليات لوحة الإدارة: POST فقط (فحص Origin من Astro)، وبجلسة الموظف نفسه؛ القاعدة ترفض غير الفريق.
export const POST: APIRoute = async ({ params, request, locals, cookies, redirect }) => {
  const name = params.action!;
  if (!(name in ADMIN_HANDLERS)) return new Response('Not found', { status: 404 });
  const session = locals.session;
  if (!session) return redirect('/login?next=%2Fadmin&reason=admin', 303);
  const form = await request.formData();
  try {
    const r = await runAdminAction(name, form, session.token);
    if (r.flash) setFlash(cookies, r.flash, r.error ? 'error' : 'ok');
    return redirect(r.to, 303);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      clearSession(cookies);
      return redirect('/login?next=%2Fadmin&reason=expired', 303);
    }
    throw e;
  }
};
