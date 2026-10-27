// Appointment reminders (Isip – System #3): the 24-hour and 1-hour reminders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stub, load, query } = require('./helpers/stub');

const sent = [];
let pushOk = true;
const appts = new Map();
stub('utils/notify.js', {
  notifyUser: async (userId, n) => {
    sent.push({ userId, ...n });
    const p = Promise.resolve(pushOk ? { success: true } : { success: false, error: 'no device registered' });
    return Object.defineProperty({ ...n }, 'pushPromise', { value: p });
  },
});
const smsSent = [];
stub('services/smsService.js', { sendSMS: async (to, msg) => { smsSent.push({ to, msg }); return { success: true }; } });
stub('models/Appointment.js', {
  find: () => query(() => [...appts.values()].map((a) => ({ ...a }))),
  findOneAndUpdate: async (filter, update) => {
    const a = appts.get(filter._id);
    const flag = Object.keys(filter).find((k) => k.startsWith('reminder'));
    if (!a || a[flag] === true) return null; // already claimed
    Object.assign(a, update.$set);
    return { ...a };
  },
  updateOne: () => ({ catch: () => {} }),
});

const { dueReminder, sweepReminders } = load('services/appointmentReminder.js');
const H = 3600 * 1000;

test('dueReminder picks the right reminder for each lead time', () => {
  const now = new Date('2026-10-27T08:00:00+08:00');
  const at = (h) => new Date(now.getTime() + h * H);
  const fresh = { reminderSent: false, reminder1hSent: false };
  assert.equal(dueReminder(fresh, at(30), now), null, '30 h ahead: nothing yet');
  assert.equal(dueReminder(fresh, at(20), now), 'day');
  assert.equal(dueReminder(fresh, at(1.5), now), null, 'inside 2 h, before 1 h: no day reminder');
  assert.equal(dueReminder(fresh, at(0.5), now), 'hour');
  assert.equal(dueReminder({ ...fresh, reminder1hSent: true }, at(0.5), now), null, 'not sent twice');
  assert.equal(dueReminder(fresh, at(-0.1), now), null, 'past appointment ignored');
});

test('sweep sends a day reminder, then an hour reminder, never duplicates', async () => {
  // 10:00 AM slot "tomorrow" relative to a fixed clock
  appts.set('a1', { _id: 'a1', patient: 'u1', patientPhone: '09171234567', serviceName: 'Check-up', timeSlot: '10:00 AM',
    appointmentDate: new Date('2026-10-28T00:00:00+08:00'), status: 'confirmed', reminderSent: false, reminder1hSent: false, clinic: { name: 'Clinic A' } });

  const evening = new Date('2026-10-27T18:00:00+08:00'); // 16 h before
  assert.equal(await sweepReminders(evening), 1);
  assert.equal(await sweepReminders(evening), 0, 'second sweep: already sent');
  assert.equal(sent.at(-1).title, 'Appointment reminder');

  const nineAm = new Date('2026-10-28T09:15:00+08:00'); // 45 min before
  assert.equal(await sweepReminders(nineAm), 1);
  assert.equal(sent.at(-1).title, 'Appointment in 1 hour');
  assert.equal(await sweepReminders(nineAm), 0);
});

test('1-hour reminder falls back to SMS when the push fails', async () => {
  pushOk = false;
  appts.clear();
  appts.set('a2', { _id: 'a2', patient: 'u2', patientPhone: '09181234567', serviceName: 'Dental', timeSlot: '02:00 PM',
    appointmentDate: new Date('2026-10-28T00:00:00+08:00'), status: 'pending', reminderSent: true, reminder1hSent: false, clinic: { name: 'Clinic B' } });
  await sweepReminders(new Date('2026-10-28T13:20:00+08:00'));
  assert.equal(smsSent.length, 1);
  assert.doesNotMatch(smsSent[0].msg, /Dental/, 'SMS does not reveal the service');
  pushOk = true;
});
