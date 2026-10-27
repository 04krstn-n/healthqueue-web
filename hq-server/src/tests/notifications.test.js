// Notifications (Isip – System #3): timely alerts and DELAYED / FAILED delivery.
// Push (Firebase) and SMS (Semaphore) are replaced with controllable fakes so
// each failure mode can be forced and the fallback behaviour checked.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, load } = require('./helpers/stub');

let pushResult; let smsResult; let pushCalls; let smsCalls; let logged;
stub('models/Notification.js', { create: async (doc) => ({ ...doc }) });
stub('services/pushService.js', { sendPushToUser: async () => { pushCalls += 1; return typeof pushResult === 'function' ? pushResult() : pushResult; } });
stub('services/smsService.js', { sendSMS: async (to, msg) => { smsCalls.push({ to, msg }); return smsResult; }, sendOTP: async () => ({ success: true }) });
stub('models/QueueEntry.js', { updateOne: (_q, upd) => { logged.push(upd.$push.notifyLog.$each); return { catch: () => {} }; } });

const { notifyQueueEntry } = load('utils/notify.js');

const appUserTicket = { _id: 't1', patient: 'u1', patientPhone: '09171234567', queueNumber: 'A007' };
const walkInTicket = { _id: 't2', patient: null, patientPhone: '09181234567', queueNumber: 'A008' };
const walkInNoPhone = { _id: 't3', patient: null, patientPhone: '', queueNumber: 'A009' };

beforeEach(() => { pushCalls = 0; smsCalls = []; logged = []; pushResult = { success: true }; smsResult = { success: true }; });

test('push delivered -> no SMS is sent', async () => {
  const r = await notifyQueueEntry(appUserTicket, { kind: 'called', title: 't', message: 'Your turn' });
  assert.equal(r.channel, 'push'); assert.equal(r.success, true);
  assert.equal(smsCalls.length, 0);
  assert.equal(logged[0][0].success, true);
});

test('push FAILS for a time-critical alert -> falls back to SMS and logs both attempts', async () => {
  pushResult = { success: false, error: 'messaging/server-unavailable' };
  const r = await notifyQueueEntry(appUserTicket, { kind: 'called', title: 't', message: 'Your turn' });
  assert.equal(r.channel, 'sms'); assert.equal(r.fallback, true); assert.equal(r.success, true);
  assert.equal(smsCalls.length, 1);
  assert.match(smsCalls[0].msg, /^\[HealthQueue\+\]/);
  assert.deepEqual(logged[0].map((a) => [a.channel, a.success]), [['push', false], ['sms', true]]);
});

test('patient has no registered device -> SMS fallback for "no_show"', async () => {
  pushResult = { success: false, error: 'no device registered' };
  const r = await notifyQueueEntry(appUserTicket, { kind: 'no_show', title: 't', message: 'Missed' });
  assert.equal(r.channel, 'sms');
});

test('routine position update (#5) with failed push -> NOT texted (saves SMS credits), in-app only', async () => {
  pushResult = { success: false, error: 'push not configured' };
  const r = await notifyQueueEntry(appUserTicket, { kind: 'position_5', title: 't', message: '5 ahead' });
  assert.equal(smsCalls.length, 0);
  assert.equal(r.inAppOnly, true);
});

test('push AND SMS both fail -> failure is reported and logged, request does not crash', async () => {
  pushResult = { success: false, error: 'messaging/internal-error' };
  smsResult = { success: false, error: 'Semaphore 500' };
  const r = await notifyQueueEntry(appUserTicket, { kind: 'next', title: 't', message: 'You are next' });
  assert.equal(r.success, false); assert.equal(r.inAppOnly, true);
  assert.deepEqual(logged[0].map((a) => a.success), [false, false]);
  assert.equal(logged[0][1].error, 'Semaphore 500');
});

test('DELAYED push (slow provider) still resolves and is recorded', async () => {
  pushResult = () => new Promise((ok) => setTimeout(() => ok({ success: true }), 300));
  const t0 = Date.now();
  const r = await notifyQueueEntry(appUserTicket, { kind: 'called', title: 't', message: 'Your turn' });
  assert.ok(Date.now() - t0 >= 290);
  assert.equal(r.success, true);
});

test('push throws an exception -> caught, never breaks the queue action', async () => {
  pushResult = () => { throw new Error('network down'); };
  const r = await notifyQueueEntry(appUserTicket, { kind: 'called', title: 't', message: 'Your turn' });
  assert.equal(typeof r.channel, 'string');
});

test('walk-in with phone -> SMS; walk-in without phone -> channel "none"', async () => {
  const a = await notifyQueueEntry(walkInTicket, { kind: 'called', title: 't', message: 'Your turn' });
  assert.equal(a.channel, 'sms'); assert.equal(pushCalls, 0);
  const b = await notifyQueueEntry(walkInNoPhone, { kind: 'called', title: 't', message: 'Your turn' });
  assert.equal(b.channel, 'none'); assert.equal(b.success, false);
});

test('SMS not configured (mock) counts as NOT delivered', async () => {
  smsResult = { success: true, mock: true };
  const r = await notifyQueueEntry(walkInTicket, { kind: 'called', title: 't', message: 'x' });
  assert.equal(r.success, false);
  assert.equal(r.error, 'SMS not configured');
});
