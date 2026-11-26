// يثبت أن كل عمليات الإدارة تعمل عبر REST/RPC بصلاحيات المحرر/المدير (RLS) دون أي مفتاح خدمة.
// هذه هي العمليات التي ستبني عليها لوحة الإدارة. تتطلب: dev/up.sh
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const URL_ = env.PUBLIC_SUPABASE_URL.replace('localhost', '127.0.0.1') + '/rest/v1', ANON = env.PUBLIC_SUPABASE_ANON_KEY;
const SECRET = 'dev-only-secret-dev-only-secret-0123456789';
const sql = (q) => execFileSync('su', ['postgres', '-c', 'psql -d yaqatha_dev -At'], { input: q }).toString().trim();
const jwt = (sub, email) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ sub, role: 'authenticated', aud: 'authenticated', email, exp: 4102444800 }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const ids = { mgr: 'a0000000-0000-4000-8000-000000000001', edt: 'a0000000-0000-4000-8000-000000000002', usr: 'a0000000-0000-4000-8000-000000000003' };
sql(`insert into auth.users (id,email,email_confirmed_at) values ('${ids.mgr}','mgr@admin.test',now()),('${ids.edt}','edt@admin.test',now()),('${ids.usr}','usr@admin.test',now()) on conflict do nothing;
     insert into staff_roles (user_id,email,role) values ('${ids.mgr}','mgr@admin.test','manager'),('${ids.edt}','edt@admin.test','editor') on conflict do nothing;`);
const T = { mgr: jwt(ids.mgr, 'mgr@admin.test'), edt: jwt(ids.edt, 'edt@admin.test'), usr: jwt(ids.usr, 'usr@admin.test') };

async function api(who, method, path, body, extra = {}) {
  const h = { apikey: ANON, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra };
  h.Authorization = `Bearer ${who ? T[who] : ANON}`;
  const r = await fetch(URL_ + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
const slug = 'admin-test-' + Date.now().toString(36);
let mat, pathId, v1, steps = [];

test('محرر ينشئ مادة ويربطها وينشرها؛ وشروط النشر تُطبَّق من القاعدة', async () => {
  const c = await api('edt', 'POST', '/materials', { slug, title: 'مادة اختبار الإدارة', type: 'article', body: 'نص', nature: 'original_source' });
  assert.equal(c.status, 201); mat = c.body[0];
  assert.equal((await api('usr', 'POST', '/materials', { slug: slug + '-x', title: 'x', type: 'article' })).status, 403, 'غير الفريق لا يكتب');
  const noLink = await api('edt', 'PATCH', `/materials?id=eq.${mat.id}`, { status: 'published' });
  assert.ok(noLink.status >= 400 && /original source|link the material/.test(noLink.body.message), noLink.body.message);
  await api('edt', 'PATCH', `/materials?id=eq.${mat.id}`, { source_title: 'مصدر' });
  const needId = sql(`select id from needs where slug='anger-control'`);
  assert.equal((await api('edt', 'POST', '/material_needs', { material_id: mat.id, need_id: needId })).status, 201);
  const pub = await api('edt', 'PATCH', `/materials?id=eq.${mat.id}`, { status: 'published' });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal((await api(null, 'GET', `/materials?id=eq.${mat.id}&select=id`)).body.length, 1, 'ظهرت للزائر');
});

test('الإخفاء بنقرة: يختفي عن الزائر، وأثره بالأعداد فقط، وحالة المراجعة إدارية', async () => {
  const impact = await api('edt', 'POST', '/rpc/material_impact', { p_material_id: mat.id });
  assert.deepEqual(Object.keys(impact.body[0]).sort(), ['paths_count', 'saved_count', 'steps_count']);
  const denied = await api('usr', 'POST', '/rpc/material_impact', { p_material_id: mat.id });
  assert.ok(denied.status >= 400 && /staff only/.test(denied.body.message), 'غير الفريق لا يستدعيها');
  await api('edt', 'PATCH', `/materials?id=eq.${mat.id}`, { status: 'hidden' });
  assert.equal((await api(null, 'GET', `/materials?id=eq.${mat.id}&select=id`)).body.length, 0);
  assert.equal((await api('edt', 'GET', `/materials?id=eq.${mat.id}&select=id`)).body.length, 1, 'الفريق يرى المخفي');
  const rv = await api('edt', 'PATCH', `/content_review?entity_type=eq.material&entity_id=eq.${mat.id}`, { review_status: 'needs_review', internal_note: 'سبب' });
  assert.equal(rv.status, 200);
  assert.ok([401, 403].includes((await api(null, 'GET', '/content_review')).status), 'الزائر لا يقرأ المراجعة');
  assert.equal((await api('usr', 'GET', '/content_review')).body.length, 0, 'المستخدم العادي لا يرى المراجعة');
  await api('edt', 'PATCH', `/materials?id=eq.${mat.id}`, { status: 'published' });
});

test('مسار: إنشاء، خطوات، إعادة ترتيب بعد COMMIT، نشر، إصدار جديد، سحب', async () => {
  pathId = (await api('edt', 'POST', '/paths', { slug })).body[0].id;
  const v = await api('edt', 'POST', '/path_versions', { path_id: pathId, title: 'مسار اختبار الإدارة', duration_days: 3 });
  assert.equal(v.status, 201); v1 = v.body[0];
  assert.equal(v1.version_no, 1);
  const bad = await api('edt', 'POST', '/path_versions', { path_id: pathId, title: 'x', status: 'published' });
  assert.equal(bad.status, 403, 'لا يمكن تحديد الحالة مباشرة (منح أعمدة)');
  for (const [i, t] of ['أ', 'ب', 'ج'].entries()) steps.push((await api('edt', 'POST', '/steps', { version_id: v1.id, position: i + 1, type: 'read', title: t })).body[0]);
  const order = [steps[2].id, steps[0].id, steps[1].id];
  const re = await api('edt', 'POST', '/rpc/reorder_steps', { p_version_id: v1.id, p_step_ids: order });
  assert.equal(re.status, 204, JSON.stringify(re.body));
  const got = (await api('edt', 'GET', `/steps?version_id=eq.${v1.id}&select=title&order=position`)).body.map((s) => s.title).join('');
  assert.equal(got, 'جأب', 'الترتيب ثابت بعد COMMIT الحقيقي');
  const noExam = await api('edt', 'POST', '/rpc/publish_path_version', { p_version_id: v1.id });
  assert.ok(noExam.status >= 400 && /exam/.test(noExam.body.message), 'لا نشر بلا امتحان');
  const ex = (await api('edt', 'POST', '/steps', { version_id: v1.id, position: 4, type: 'exam', title: 'الامتحان' })).body[0];
  const qs = Array.from({ length: 5 }, (_, i) => ({ step_id: ex.id, position: i + 1, prompt: `س${i + 1}`, options: ['أ', 'ب'], correct_index: 0 }));
  assert.equal((await api('edt', 'POST', '/exam_questions', qs)).status, 201);
  assert.equal((await api('usr', 'GET', `/exam_questions?step_id=eq.${ex.id}`)).body.length, 0, 'المستخدم لا يقرأ مفتاح الإجابات');
  assert.equal((await api('edt', 'POST', '/rpc/publish_path_version', { p_version_id: v1.id })).status, 204);
  assert.equal((await api(null, 'GET', `/paths_current?slug=eq.${slug}&select=version_no`)).body[0].version_no, 1);
  assert.equal((await api('edt', 'POST', '/steps', { version_id: v1.id, position: 9, type: 'read', title: 'متأخرة' })).status >= 400, true, 'الإصدار المنشور مجمّد');
  const d = await api('edt', 'POST', '/rpc/create_draft_version', { p_path_id: pathId });
  assert.equal(d.status, 200); const v2 = d.body;
  const noLog = await api('edt', 'POST', '/rpc/publish_path_version', { p_version_id: v2 });
  assert.ok(noLog.status >= 400 && /changelog/.test(noLog.body.message));
  assert.equal((await api('edt', 'POST', '/rpc/publish_path_version', { p_version_id: v2, p_changelog: 'تحديث' })).status, 204);
  assert.equal((await api('edt', 'POST', '/rpc/withdraw_version', { p_version_id: v2, p_note: 'خطأ' })).status, 204);
  assert.equal((await api(null, 'GET', `/paths_current?slug=eq.${slug}`)).body.length, 0, 'السحب يوقف البدء الجديد');
});

test('الفريق والتدقيق: المدير فقط يدعو ويقرأ السجل، والمحرر لا', async () => {
  const email = `invitee-${Date.now()}@admin.test`;
  assert.ok((await api('edt', 'POST', '/staff_invites', { email, role: 'editor' })).status >= 400, 'المحرر لا يدعو');
  assert.equal((await api('mgr', 'POST', '/staff_invites', { email, role: 'editor' })).status, 201);
  assert.ok((await api('mgr', 'GET', '/audit_log?select=id,actor_id,action,entity_type&order=id.desc&limit=5')).body.length > 0, 'المدير يقرأ السجل');
  assert.equal((await api('edt', 'GET', '/audit_log?select=id')).body.length, 0, 'المحرر لا يقرأ السجل');
  const mine = await api('edt', 'GET', '/staff_roles?select=email,role');
  assert.equal(mine.body.length, 1, 'المحرر يرى صفه فقط');
  const e = await api('mgr', 'GET', '/staff_roles?select=email,role');
  assert.ok(e.body.length >= 2);
  const lastMgr = sql(`select count(*) from staff_roles where role='manager'`);
  if (lastMgr === '1') assert.ok((await api('mgr', 'DELETE', `/staff_roles?user_id=eq.${ids.mgr}`)).status >= 400, 'حماية آخر مدير');
});

test('تعارض التعديل المتزامن: شرط updated_at يكشفه دون إضافات في القاعدة', async () => {
  const cur = (await api('edt', 'GET', `/materials?id=eq.${mat.id}&select=updated_at`)).body[0].updated_at;
  await api('mgr', 'PATCH', `/materials?id=eq.${mat.id}`, { description: 'تعديل المدير' });
  const stale = await api('edt', 'PATCH', `/materials?id=eq.${mat.id}&updated_at=eq.${encodeURIComponent(cur)}`, { description: 'تعديل المحرر' });
  assert.deepEqual(stale.body, [], 'لم يُطبَّق: عدّلها غيرك بعد أن فتحتها');
});

test('المراجعة والبلاغات: المحرر يعالج البلاغ ولا يراه غير صاحبه', async () => {
  sql(`insert into material_reports (material_id, reporter_id, note) values ('${mat.id}','${ids.usr}','بلاغ اختبار')`);
  assert.equal((await api('usr', 'GET', '/material_reports?select=id')).body.length, 1);
  const rep = (await api('edt', 'GET', `/material_reports?material_id=eq.${mat.id}&select=id,status`)).body[0];
  assert.equal(rep.status, 'open');
  const r = await api('edt', 'PATCH', `/material_reports?id=eq.${rep.id}`, { status: 'resolved', resolved_by: ids.edt, resolved_at: new Date().toISOString() });
  assert.equal(r.status, 200);
  assert.equal((await api('usr', 'PATCH', `/material_reports?id=eq.${rep.id}`, { status: 'open' })).body.length, 0, 'المستخدم لا يعيد فتح بلاغ');
});
