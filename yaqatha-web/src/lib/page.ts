import { DataError, UnauthorizedError } from './api';

/** يشغّل جلب بيانات صفحة؛ عند تعذر الاتصال يُرجع null ويضبط الحالة 503 لتعرض الصفحة رسالة خطأ ودودة. */
export async function load<T>(res: { status?: number }, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e; // يعالجها middleware: ينهي الجلسة ويعيد إلى الدخول
    if (e instanceof DataError) {
      console.error('[data]', e.message);
      res.status = 503;
      return null;
    }
    throw e;
  }
}
