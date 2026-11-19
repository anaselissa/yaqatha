import type { APIRoute } from 'astro';
import { clearSession, setFlash, signOut } from '../../lib/auth';

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.session) await signOut(locals.session.token);
  clearSession(cookies);
  setFlash(cookies, 'تم تسجيل الخروج');
  return redirect('/', 303);
};
