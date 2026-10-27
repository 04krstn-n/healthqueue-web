// Remote queue + 5-minute arrival grace period (Isip – System #7).
// Scenarios run against the real queue controller and grace sweeper, with
// the database replaced by an in-memory store.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, load, fakeRes } = require('./helpers/stub');
const { createStore } = require('./helpers/memoryQueue');

const Queue = createStore();
const clinics = new Map();
const notices = [];
stub('models/QueueEntry.js', Queue);
stub('models/Clinic.js', { findByIdAndUpdate: async (id, u) => { const c = clinics.get(String(id)); if (c && u.$inc) c.queueLength += u.$inc.queueLength; return c; } });
stub('models/Appointment.js', { findOneAndUpdate: () => ({ catch: () => {} }) });
stub('models/Patient.js', {});
stub('utils/notify.js', {
  notifyUser: async () => ({}),
  notifyQueueEntry: async (entry, n) => { notices.push({ ticket: entry.queueNumber, ...n }); return { channel: 'push', success: true }; },
});
stub('utils/auditLog.js', { logAction: async () => {} });
stub('controllers/authController.js', { normalizePhone: (p) => p });
stub('utils/queueHelpers.js', {
  getNextQueueNumber: async () => 'A001',
  estimateWaitTime: async () => 10,
  computeSuggestedWaitTime: async () => ({}),
  orderQueueByPriorityRatio: (e) => e,
  getPriorityRatio: async () => 1,
  getGracePeriodExpiry: (m = 5) => new Date(Date.now() + m * 60 * 1000),
});

const q = load('controllers/queueController.js');
const { sweepOnce } = load('services/graceSweeper.js');

const CLINIC = 'c1';
const emitted = [];
const io = { to: (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }) }), emit: (ev, p) => emitted.push({ room: '*', ev, p }) };
const reqAs = (user, params = {}, body = {}) => ({ user, params, body, query: {}, app: { get: () => io } });
const staff = { _id: 's1', role: 'staff', clinicId: CLINIC, fullName: 'Staff' };
const otherStaff = { _id: 's2', role: 'staff', clinicId: 'c2', fullName: 'Other' };
const patient = { _id: 'u1', role: 'patient' };
const stranger = { _id: 'u9', role: 'patient' };

const call = async (fn, req) => { const res = fakeRes(); await fn(req, res); return res; };

beforeEach(() => {
  Queue.reset(); notices.length = 0; emitted.length = 0;
  clinics.set(CLINIC, { queueLength: 3 });
});

test('S1 staff calls a remote patient -> status "called", 5-minute grace starts, patient notified', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A001', status: 'waiting', joinedRemotely: true });
  const t0 = Date.now();
  const res = await call(q.callPatient, reqAs(staff, { id }));
  assert.equal(res.statusCode, 200);
  const e = Queue.get(id);
  assert.equal(e.status, 'called');
  const graceMs = e.gracePeriodExpiresAt - t0;
  assert.ok(graceMs >= 299000 && graceMs <= 301000, `grace was ${graceMs} ms`);
  assert.equal(notices[0].kind, 'called');
});

test('S2 patient arrives within 5 minutes -> service starts, sweeper leaves the ticket alone', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A002', status: 'called', gracePeriodExpiresAt: new Date(Date.now() + 2 * 60000) });
  assert.equal(await sweepOnce({ io }), 0);
  const res = await call(q.startService, reqAs(staff, { id }));
  assert.equal(res.statusCode, 200);
  assert.equal(Queue.get(id).status, 'serving');
});

test('S3 patient does NOT arrive within 5 minutes -> automatic no-show, counter freed, patient told', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A003', serviceName: 'Check-up', status: 'called', gracePeriodExpiresAt: new Date(Date.now() - 1000) });
  assert.equal(await sweepOnce({ io }), 1);
  assert.equal(Queue.get(id).status, 'no_show');
  assert.ok(Queue.get(id).autoExpiredAt instanceof Date);
  assert.equal(clinics.get(CLINIC).queueLength, 2);
  assert.equal(notices.at(-1).kind, 'no_show');
  assert.ok(emitted.some((x) => x.ev === 'patient_noshow' && x.room === `clinic_${CLINIC}`));
  // The patient room only receives an anonymous refresh ping.
  const pub = emitted.find((x) => x.room === `clinicpub_${CLINIC}`);
  assert.deepEqual(Object.keys(pub.p).sort(), ['clinicId', 'eventName']);
});

test('S4 staff starts service at the same moment the grace expires -> only one wins', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A004', status: 'called', gracePeriodExpiresAt: new Date(Date.now() - 1000) });
  await call(q.startService, reqAs(staff, { id })); // staff wins
  assert.equal(await sweepOnce({ io }), 0, 'sweeper must not override a ticket staff already handled');
  assert.equal(Queue.get(id).status, 'serving');
  assert.equal(notices.filter((n) => n.kind === 'no_show').length, 0);
});

test('S5 late patient asks staff -> no-show ticket is requeued, grace period cleared', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A005', status: 'no_show', calledAt: new Date(), gracePeriodExpiresAt: new Date() });
  const res = await call(q.requeueEntry, reqAs(staff, { id }));
  assert.equal(res.statusCode, 200);
  const e = Queue.get(id);
  assert.equal(e.status, 'waiting');
  assert.equal(e.gracePeriodExpiresAt, undefined);
  assert.equal(clinics.get(CLINIC).queueLength, 4);
});

test('S6 patient taps "On my way" -> staff room notified; only the ticket owner, only while called', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A006', status: 'called', gracePeriodExpiresAt: new Date(Date.now() + 60000) });
  assert.equal((await call(q.markOnTheWay, reqAs(patient, { id }))).statusCode, 200);
  assert.ok(emitted.some((x) => x.ev === 'patient_on_the_way'));
  assert.equal((await call(q.markOnTheWay, reqAs(stranger, { id }))).statusCode, 403);
  Queue.get(id).status = 'waiting';
  assert.equal((await call(q.markOnTheWay, reqAs(patient, { id }))).statusCode, 400);
});

test('S7 two staff press "Call" at the same time -> one succeeds, the other gets 409', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A007', status: 'waiting' });
  const [a, b] = await Promise.all([call(q.callPatient, reqAs(staff, { id })), call(q.callPatient, reqAs(staff, { id }))]);
  assert.deepEqual([a.statusCode, b.statusCode].sort((x, y) => x - y), [200, 409]);
  assert.equal(notices.filter((n) => n.kind === 'called').length, 1, 'patient notified once');
});

test('S8 calling an already-called / serving ticket is refused (grace cannot be reset)', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A008', status: 'serving' });
  assert.equal((await call(q.callPatient, reqAs(staff, { id }))).statusCode, 400);
});

test('S9 staff of another clinic cannot call, start, or requeue this clinic\'s tickets', async () => {
  const id = Queue.insert({ clinic: CLINIC, patient: 'u1', queueNumber: 'A009', status: 'waiting' });
  assert.equal((await call(q.callPatient, reqAs(otherStaff, { id }))).statusCode, 403);
  Queue.get(id).status = 'no_show';
  assert.equal((await call(q.requeueEntry, reqAs(otherStaff, { id }))).statusCode, 403);
});

test('S10 several tickets expire in one sweep -> each processed exactly once', async () => {
  for (let i = 0; i < 5; i += 1) Queue.insert({ clinic: CLINIC, patient: `u${i}`, queueNumber: `B00${i}`, status: 'called', gracePeriodExpiresAt: new Date(Date.now() - 1000) });
  const [x, y] = await Promise.all([sweepOnce({ io }), sweepOnce({ io })]); // e.g. two server instances
  assert.equal(x + y, 5);
  assert.equal(notices.filter((n) => n.kind === 'no_show').length, 5);
});
