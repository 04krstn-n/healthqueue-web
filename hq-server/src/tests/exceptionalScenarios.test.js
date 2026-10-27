// Exceptional scenarios (Isip – System #11, Saac-Nape #3): cancellations,
// no-shows, duplicate registrations and repeated / simultaneous requests.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, load, fakeRes, query } = require('./helpers/stub');
const { createStore } = require('./helpers/memoryQueue');

const Queue = createStore();
const clinics = new Map();
let existingUser = null; let pendingSaved = null;
stub('models/QueueEntry.js', Queue);
stub('models/Clinic.js', { findByIdAndUpdate: async (id, u) => { const c = clinics.get(String(id)); if (c && u.$inc) c.queueLength += u.$inc.queueLength; return c; } });
stub('models/Appointment.js', { findOneAndUpdate: () => ({ catch: () => {} }) });
stub('models/Patient.js', {});
stub('utils/notify.js', { notifyUser: async () => ({}), notifyQueueEntry: async () => ({ channel: 'push', success: true }) });
stub('utils/auditLog.js', { logAction: async () => {} });
stub('utils/queueHelpers.js', {
  getNextQueueNumber: async () => 'A001', estimateWaitTime: async () => 10, computeSuggestedWaitTime: async () => ({}),
  orderQueueByPriorityRatio: (e) => e, getPriorityRatio: async () => 1, getGracePeriodExpiry: () => new Date(Date.now() + 300000),
});
stub('models/User.js', { findOne: (f) => query(() => (existingUser && (f.phone === existingUser.phone || f.email === existingUser.email) ? existingUser : null)) });
stub('models/PendingRegistration.js', { findOneAndUpdate: async (_f, doc) => { pendingSaved = doc; return { _id: 'pending1' }; } });
stub('models/PasswordReset.js', {}); stub('models/RevokedToken.js', {});
stub('services/smsService.js', { sendOTP: async () => ({ success: true, mock: true }), sendSMS: async () => ({ success: true }) });
stub('services/emailService.js', { validateEmailAddress: async (e) => ({ ok: true, email: e.toLowerCase() }), sendOTPEmail: async () => ({}), sendPasswordChangedEmail: async () => {} });

const auth = load('controllers/authController.js');
const q = load('controllers/queueController.js');
const { sweepOnce } = load('services/graceSweeper.js');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };
const reqAs = (user, params = {}, body = {}) => ({ user, params, body, query: {}, app: { get: () => io } });
const run = async (fn, req) => { const res = fakeRes(); await fn(req, res); return res; };
const P = { _id: 'u1', role: 'patient' };
const staff = { _id: 's1', role: 'staff', clinicId: 'c1' };

beforeEach(() => { Queue.reset(); clinics.set('c1', { queueLength: 5 }); existingUser = null; pendingSaved = null; });

test('patient cancels own waiting ticket -> cancelled, live counter decremented once', async () => {
  const id = Queue.insert({ clinic: 'c1', patient: 'u1', status: 'waiting' });
  assert.equal((await run(q.cancelEntry, reqAs(P, { id }))).statusCode, 200);
  assert.equal(Queue.get(id).status, 'cancelled');
  assert.equal(clinics.get('c1').queueLength, 4);
});

test('double-tap cancel (two requests at once) -> counter drops only once', async () => {
  const id = Queue.insert({ clinic: 'c1', patient: 'u1', status: 'waiting' });
  const [a, b] = await Promise.all([run(q.cancelEntry, reqAs(P, { id })), run(q.cancelEntry, reqAs(P, { id }))]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 400]);
  assert.equal(clinics.get('c1').queueLength, 4);
});

test('cancelling someone else\'s ticket, or a finished ticket, is refused', async () => {
  const other = Queue.insert({ clinic: 'c1', patient: 'u2', status: 'waiting' });
  assert.equal((await run(q.cancelEntry, reqAs(P, { id: other }))).statusCode, 403);
  const done = Queue.insert({ clinic: 'c1', patient: 'u1', status: 'completed' });
  assert.equal((await run(q.cancelEntry, reqAs(P, { id: done }))).statusCode, 400);
});

test('no-show: only a CALLED ticket can be marked; manual and automatic no-show cannot both apply', async () => {
  const waiting = Queue.insert({ clinic: 'c1', patient: 'u1', status: 'waiting' });
  assert.equal((await run(q.markNoShow, reqAs(staff, { id: waiting }))).statusCode, 400);
  const called = Queue.insert({ clinic: 'c1', patient: 'u1', status: 'called', gracePeriodExpiresAt: new Date(Date.now() - 1000) });
  const [manual, swept] = await Promise.all([run(q.markNoShow, reqAs(staff, { id: called })), sweepOnce({ io })]);
  assert.equal(manual.statusCode === 200 ? 1 : 0, 1 - swept, 'exactly one of them processed the ticket');
  assert.equal(clinics.get('c1').queueLength, 4, 'counter decremented exactly once');
});

const register = async (body) => run(auth.register, { body: { fullName: 'Ana Cruz', password: 'Str0ng!pass', ...body } });

test('duplicate registration: a phone already in use is refused (any format of the same number)', async () => {
  existingUser = { phone: '09171234567' };
  for (const phone of ['09171234567', '+639171234567', '9171234567']) {
    const res = await register({ phone });
    assert.equal(res.statusCode, 400, phone);
    assert.match(res.body.message, /already in use/);
  }
});

test('duplicate registration: an email already in use is refused', async () => {
  existingUser = { phone: '09000000000', email: 'ana@example.com' };
  const res = await register({ phone: '09181234567', email: 'Ana@Example.com' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /email already exists/);
});

test('registration input validation (invalid / incomplete data)', async () => {
  assert.equal((await register({ phone: '' })).statusCode, 400, 'missing phone');
  assert.equal((await register({ phone: '12345' })).statusCode, 400, 'bad phone');
  assert.equal((await register({ phone: '09181234567', password: 'weak' })).statusCode, 400, 'weak password');
  assert.equal((await register({ phone: '09181234567', fullName: 'A' })).statusCode, 400, 'name too short');
  assert.equal((await register({ phone: '09181234567', dateOfBirth: '2999-01-01' })).statusCode, 400, 'future birth date');
  assert.equal((await register({ phone: '09181234567', gender: 'X' })).statusCode, 400, 'bad gender');
});

test('valid registration stores a HASHED password in the pending record (never plain text)', async () => {
  const res = await register({ phone: '+639181234567' });
  assert.equal(res.statusCode, 201);
  assert.equal(pendingSaved.phone, '09181234567');
  assert.match(pendingSaved.password, /^\$2[aby]\$/);
  assert.notEqual(pendingSaved.password, 'Str0ng!pass');
});
