import type { APIRoute } from 'astro';
import { mutate } from '../../lib/api';
import { safeNext } from '../../lib/auth';

// «اختبر فهمك»: للجميع. المسجّل تُحفظ إجابته الأولى (والقاعدة تحسب الصحة)، والزائر يرى النتيجة فقط.
// النتيجة تُعرض عبر ?qa= في صفحة المادة نفسها، فلا حالة في الخادم ولا JavaScript.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const f = await request.formData();
  const slug = String(f.get('slug') ?? ''), q = String(f.get('question_id') ?? ''), a = Number(f.get('choice'));
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !UUID.test(q)) return new Response('Bad request', { status: 400 });
  // من داخل خطوة: تعود النتيجة إلى الخطوة نفسها، وإلا إلى صفحة المادة
  const nx = safeNext(String(f.get('next') ?? ''), '');
  const base = nx.startsWith('/journey/paths/') ? nx.split(/[?#]/)[0] : `/library/${slug}`;
  if (!Number.isInteger(a) || a < 0 || a > 4) return redirect(`${base}#q-${q}`, 303);
  if (locals.session) {
    try { await mutate('POST', 'quiz_attempts', locals.session.token, { body: { question_id: q, chosen_index: a }, ignoreDuplicates: true }); }
    catch (e) { console.error('[quiz]', (e as Error).message); } // الحفظ إضافة: النتيجة تظهر على أي حال
  }
  return redirect(`${base}?qa=${q}.${a}#q-${q}`, 303);
};
