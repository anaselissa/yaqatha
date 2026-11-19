import type { APIRoute } from 'astro';
import { UnauthorizedError, rest } from '../../lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

// حالة المستخدم لصفحات عامة مخبَّأة: هل بدأ هذا المسار؟ هل حفظ هذه المادة؟
export const GET: APIRoute = async ({ url, locals }) => {
  const s = locals.session;
  const out: { signedIn: boolean; enrollmentId?: string; saved?: boolean } = { signedIn: !!s };
  if (!s) return json(out);
  try {
    const path = url.searchParams.get('path'), mat = url.searchParams.get('material');
    if (path && UUID.test(path)) {
      const { rows } = await rest<{ id: string }>('enrollments', { select: 'id', path_id: `eq.${path}`, status: 'eq.active', limit: 1 }, { token: s.token });
      out.enrollmentId = rows[0]?.id;
    }
    if (mat && UUID.test(mat)) {
      const { rows } = await rest('saved_materials', { select: 'material_id', material_id: `eq.${mat}`, limit: 1 }, { token: s.token });
      out.saved = rows.length > 0;
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) return json({ signedIn: false });
    return json({ signedIn: true });
  }
  return json(out);
};
