// Security testing (Isip – System #9): authentication, authorization,
// role-based access, API security and patient data protection.
// Boots the REAL Express app (real routes, real auth middleware, helmet,
// CORS, rate limiting, sanitizer) on a random port. Only the database is
// replaced: users and revoked tokens live in memory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { stub, load, query } = require('./helpers/stub');

process.env.PORT = '0';
process.env.FRONTEND_ORIGINS = 'https://www.healthqueue.org';
require('mongoose').set('bufferCommands', false); // a stray DB call fails fast instead of hanging

const users = new Map();
const revoked = new Set();
stub('config/db.js', async () => {});
stub('models/RevokedToken.js', { exists: async ({ jti }) => (revoked.has(jti) ? { _id: jti } : null), updateOne: async () => ({}) });
stub('models/User.js', {
  findById: (id) => query(() => users.get(String(id)) || null),
  findOne: () => query(null),
  updateOne: async () => ({}),
});

const SECRET = process.env.JWT_SECRET;
const mk = (id, role, clinicId = null, isActive = true) => { users.set(id, { _id: id, role, clinicId, isActive, fullName: id }); };
mk('aaaaaaaaaaaaaaaaaaaaaaa1', 'patient');
mk('aaaaaaaaaaaaaaaaaaaaaaa2', 'staff', 'cccccccccccccccccccccc01');
mk('aaaaaaaaaaaaaaaaaaaaaaa3', 'facility_admin', 'cccccccccccccccccccccc01');
mk('aaaaaaaaaaaaaaaaaaaaaaa4', 'super_admin');
mk('aaaaaaaaaaaaaaaaaaaaaaa5', 'staff', 'cccccccccccccccccccccc01', false);

const token = (id, extra = {}, opts = {}) => jwt.sign({ id, role: users.get(id)?.role, ...extra }, opts.secret || SECRET, { expiresIn: opts.expiresIn || '1h', jwtid: opts.jti || `j-${id}` });
const T = {
  patient: token('aaaaaaaaaaaaaaaaaaaaaaa1'),
  staff: token('aaaaaaaaaaaaaaaaaaaaaaa2'),
  facility: token('aaaaaaaaaaaaaaaaaaaaaaa3'),
};

let base; let server; let app;
before(async () => {
  ({ app, server } = load('server.js'));
  if (!server.listening) await new Promise((ok) => server.once('listening', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  app.get('io')?.close();
  await new Promise((ok) => server.close(ok));
});

const req = (method, path, { tok, body, headers = {} } = {}) => fetch(base + path, {
  method,
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers },
  body: body && !['GET', 'HEAD'].includes(method) ? JSON.stringify(body) : undefined,
});

const ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

test('AUTHN: protected endpoints refuse requests with no token (401)', async () => {
  for (const [m, p] of [['GET', '/api/users'], ['GET', '/api/queues'], ['GET', '/api/patients'], ['POST', '/api/queues/join'], ['GET', '/api/analytics/effectiveness'], ['GET', `/api/patient-type-requests/${ID}/photo`]]) {
    assert.equal((await req(m, p)).status, 401, `${m} ${p}`);
  }
});

test('AUTHN: tampered, wrong-secret, expired, revoked and garbage tokens are rejected (401)', async () => {
  const [h, p] = T.patient.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ id: 'aaaaaaaaaaaaaaaaaaaaaaa4', role: 'super_admin' })).toString('base64url');
  const cases = {
    tampered: `${h}.${forgedPayload}.${T.patient.split('.')[2]}`,
    wrongSecret: token('aaaaaaaaaaaaaaaaaaaaaaa4', {}, { secret: 'not-the-real-secret-0000000000000000' }),
    expired: token('aaaaaaaaaaaaaaaaaaaaaaa1', {}, { expiresIn: '-1s' }),
    garbage: 'abc.def.ghi',
    noneAlg: `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`,
  };
  revoked.add('j-revoked');
  cases.revoked = token('aaaaaaaaaaaaaaaaaaaaaaa1', {}, { jti: 'j-revoked' });
  for (const [name, tok] of Object.entries(cases)) {
    assert.equal((await req('GET', '/api/auth/me', { tok })).status, 401, name);
  }
});

test('AUTHN: a deactivated account is refused even with a valid token (403)', async () => {
  assert.equal((await req('GET', '/api/auth/me', { tok: token('aaaaaaaaaaaaaaaaaaaaaaa5') })).status, 403);
});

test('RBAC: role comes from the database, not from the token claims', async () => {
  // Validly signed, but claims super_admin for a patient account.
  const lying = token('aaaaaaaaaaaaaaaaaaaaaaa1', { role: 'super_admin' }, { jti: 'j-lie' });
  assert.equal((await req('GET', '/api/system-config', { tok: lying })).status, 403);
  assert.equal((await req('GET', '/api/users', { tok: lying })).status, 403);
});

test('RBAC: a PATIENT cannot reach staff/admin endpoints (403)', async () => {
  for (const [m, p] of [
    ['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/patients'], ['GET', `/api/patients/${ID}`],
    ['GET', '/api/queues'], ['PUT', `/api/queues/${ID}/call`], ['PUT', `/api/queues/${ID}/no-show`], ['POST', '/api/queues/add-walkin'],
    ['GET', '/api/system-config'], ['GET', '/api/audit-logs'], ['GET', '/api/analytics/effectiveness'],
    ['GET', '/api/patient-type-requests'], ['PUT', `/api/patient-type-requests/${ID}/approve`], ['GET', '/api/staff'],
    ['GET', '/api/dashboard/super-admin'], ['POST', '/api/clinics'],
  ]) {
    assert.equal((await req(m, p, { tok: T.patient, body: {} })).status, 403, `${m} ${p}`);
  }
});

test('RBAC: STAFF cannot reach admin-only endpoints (403)', async () => {
  for (const [m, p] of [
    ['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/system-config'], ['GET', '/api/audit-logs'],
    ['GET', '/api/analytics/effectiveness'], ['DELETE', `/api/patients/${ID}`], ['GET', '/api/staff'],
    ['POST', '/api/clinics'], ['GET', '/api/dashboard/super-admin'], ['POST', '/api/queues/join'],
  ]) {
    assert.equal((await req(m, p, { tok: T.staff, body: {} })).status, 403, `${m} ${p}`);
  }
});

test('RBAC: FACILITY ADMIN cannot reach super-admin-only endpoints (403)', async () => {
  for (const [m, p] of [['GET', '/api/system-config'], ['POST', '/api/clinics'], ['DELETE', `/api/clinics/${ID}`], ['GET', '/api/dashboard/super-admin']]) {
    assert.equal((await req(m, p, { tok: T.facility, body: {} })).status, 403, `${m} ${p}`);
  }
});

test('API: MongoDB operator injection in the login body is neutralised', async () => {
  const res = await req('POST', '/api/auth/login', { body: { identifier: { $ne: null }, password: { $ne: null } } });
  assert.notEqual(res.status, 200);
  assert.ok([400, 401].includes(res.status), `got ${res.status}`);
});

test('API: invalid IDs and malformed input are rejected before reaching the database', async () => {
  assert.equal((await req('POST', '/api/auth/verify-otp', { body: { userId: { $gt: '' }, otp: '123456' } })).status, 400);
  assert.equal((await req('POST', '/api/auth/register', { body: { fullName: 'Ana Cruz', phone: '12345', password: 'Str0ng!pass' } })).status, 400);
  assert.equal((await req('POST', '/api/queues/join', { tok: T.patient, body: { clinicId: 'not-an-id' } })).status, 400);
});

test('API: security headers are set (helmet) and unknown origins get no CORS grant', async () => {
  const res = await req('GET', '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('x-frame-options'));
  assert.ok(res.headers.get('strict-transport-security'));
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const ok = await req('GET', '/health', { headers: { Origin: 'https://www.healthqueue.org' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.healthqueue.org');
});

test('API: login endpoint is rate-limited per IP (brute-force protection)', async () => {
  let limited = false;
  for (let i = 0; i < 12 && !limited; i += 1) {
    const r = await req('POST', '/api/auth/login', { body: { identifier: '09171234567', password: 'Wrong!pass1' } });
    if (r.status === 429 || (r.status === 400 && /Too many/.test((await r.json()).message || ''))) limited = true;
  }
  assert.ok(limited, 'expected the auth limiter to block within 12 attempts');
});
