// يحاكي Supabase محليًا على :54321 — للتطوير والاختبار فقط (لا يُنشر).
//   /rest/v1/*  ← PostgREST الحقيقي (RLS حقيقية)
//   /auth/v1/*  ← محاكٍ لعقد GoTrue (PKCE) يوقّع JWT بنفس سر PostgREST المحلي
// المستخدم التجريبي يُختار بكوكي mock_user (بريد)، و mock_deny=1 يحاكي رفض Google.
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SECRET = 'dev-only-secret-dev-only-secret-0123456789';
const DB = 'yaqatha_dev';
const REST = { host: '127.0.0.1', port: 3001 };
const codes = new Map();    // code -> { challenge, email }
const refreshes = new Map(); // refresh_token -> email
const ACCESS_TTL = Number(process.env.MOCK_ACCESS_TTL || 3600);

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const uid = (email) => { const h = crypto.createHash('sha1').update(email).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const nameOf = (email) => email.split('@')[0];
function ensureUser(email) {
  const id = uid(email), name = nameOf(email);
  execFileSync('su', ['postgres', '-c', `psql -d ${DB} -qAt -c "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('${id}','${email}',now(),'{\\"full_name\\":\\"${name}\\"}') on conflict (id) do nothing"`]);
  return id;
}
function tokens(email) {
  const id = ensureUser(email), now = Math.floor(Date.now() / 1000);
  const access_token = sign({ sub: id, role: 'authenticated', aud: 'authenticated', email, iat: now, exp: now + ACCESS_TTL, user_metadata: { full_name: nameOf(email) } });
  const refresh_token = crypto.randomBytes(18).toString('base64url');
  refreshes.set(refresh_token, email);
  return { access_token, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token, user: { id, email, user_metadata: { full_name: nameOf(email) } } };
}
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === n)?.[1];
const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/rest/v1/')) {
    const up = http.request({ ...REST, method: req.method, path: req.url.slice('/rest/v1'.length), headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end('upstream down'); });
    return req.pipe(up);
  }
  if (!url.pathname.startsWith('/auth/v1/')) { res.writeHead(404); return res.end('not found'); }
  const route = url.pathname.slice('/auth/v1'.length);
  // /authorize تنقّل متصفح بلا apikey (كما في GoTrue الحقيقي)؛ بقية المسارات تتطلبه
  if (route !== '/authorize' && !req.headers.apikey) return json(res, 401, { message: 'No API key found in request' });
  if (route === '/authorize' && req.method === 'GET') {
    const redirect = url.searchParams.get('redirect_to'), challenge = url.searchParams.get('code_challenge');
    if (!redirect || !challenge || url.searchParams.get('code_challenge_method')?.toLowerCase() !== 's256' || url.searchParams.get('provider') !== 'google') return json(res, 400, { msg: 'bad authorize request' });
    const sep = redirect.includes('?') ? '&' : '?';
    if (cookie(req, 'mock_deny') === '1') { res.writeHead(302, { location: `${redirect}${sep}error=access_denied&error_code=access_denied&error_description=User+denied+access` }); return res.end(); }
    const email = decodeURIComponent(cookie(req, 'mock_user') || 'demo@y.test').toLowerCase().replace(/[^a-z0-9@._-]/g, '');
    const code = crypto.randomBytes(12).toString('hex');
    codes.set(code, { challenge, email });
    res.writeHead(302, { location: `${redirect}${sep}code=${code}` }); return res.end();
  }
  if (route === '/token' && req.method === 'POST') {
    const b = await body(req), gt = url.searchParams.get('grant_type');
    if (gt === 'pkce') {
      const c = codes.get(b.auth_code); codes.delete(b.auth_code);
      if (!c || crypto.createHash('sha256').update(String(b.code_verifier)).digest('base64url') !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'invalid flow state or verifier' });
      return json(res, 200, tokens(c.email));
    }
    if (gt === 'refresh_token') {
      const email = refreshes.get(b.refresh_token); refreshes.delete(b.refresh_token);
      if (!email) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      return json(res, 200, tokens(email));
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }
  if (route === '/logout' && req.method === 'POST') { res.writeHead(204); return res.end(); }
  json(res, 404, { msg: 'not found' });
}).listen(54321, '127.0.0.1', () => console.log('mock supabase on :54321'));
