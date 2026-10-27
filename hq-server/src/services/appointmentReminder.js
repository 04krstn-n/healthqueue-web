/**
 * Appointment reminders (panel: "ensure timely notifications for relevant
 * transactions"). Chapter 1.5 promises patients "appointment reminders";
 * before this file the Appointment.reminderSent flag existed but nothing ever
 * sent one.
 *
 * Every REMINDER_SWEEP_MS the sweeper looks at active appointments
 * (pending/confirmed) and sends:
 *   - a "day" reminder once the slot is within 24 hours (and more than
 *     DAY_REMINDER_MIN_LEAD away, so a same-hour booking isn't double-pinged)
 *   - an "hour" reminder once the slot is within 60 minutes
 *
 * Each reminder is claimed with one atomic update ({reminderSent:false} ->
 * true) before sending, so two server instances can never send it twice.
 * Delivery: in-app + push; if the push does not go out and the patient has a
 * phone number, the 1-hour reminder falls back to SMS. Every attempt is
 * written to appointment.reminderLog.
 */
const Appointment = require('../models/Appointment');
const { notifyUser } = require('../utils/notify');
const { sendSMS } = require('./smsService');
const { slotInstant } = require('../utils/clinicHours');

const REMINDER_SWEEP_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_REMINDER_MIN_LEAD = 2 * HOUR_MS;
const ACTIVE = ['pending', 'confirmed'];

/** Which reminder (if any) is due for an appointment at `slotAt`. */
const dueReminder = (appt, slotAt, now = new Date()) => {
  if (!slotAt) return null;
  const lead = slotAt.getTime() - now.getTime();
  if (lead <= 0) return null; // already started / passed
  if (lead <= HOUR_MS && !appt.reminder1hSent) return 'hour';
  if (lead <= DAY_MS && lead > DAY_REMINDER_MIN_LEAD && !appt.reminderSent) return 'day';
  return null;
};

const formatWhen = (slotAt) => new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(slotAt);

const sendReminder = async (appt, kind, slotAt, clinicName) => {
  const when = formatWhen(slotAt);
  const title = kind === 'hour' ? 'Appointment in 1 hour' : 'Appointment reminder';
  const message = kind === 'hour'
    ? `Your ${appt.serviceName} appointment${clinicName ? ` at ${clinicName}` : ''} starts at ${appt.timeSlot} (in about 1 hour). Please arrive on time.`
    : `Reminder: you have a ${appt.serviceName} appointment${clinicName ? ` at ${clinicName}` : ''} on ${when}.`;

  const attempts = [];
  try {
    const notif = await notifyUser(appt.patient, {
      title, message, type: 'reminder', refType: 'Appointment', refId: appt._id,
    });
    const push = (await notif.pushPromise) || { success: false, error: 'unknown' };
    attempts.push({ kind, channel: 'push', success: push.success, error: push.error || '' });

    if (!push.success && kind === 'hour' && appt.patientPhone) {
      // SMS text omits the service name — SMS is not a private channel.
      const sms = await sendSMS(appt.patientPhone, `[HealthQueue+] Reminder: your appointment${clinicName ? ` at ${clinicName}` : ''} is at ${appt.timeSlot} today.`);
      const ok = Boolean(sms && sms.success && !sms.mock);
      attempts.push({ kind, channel: 'sms', success: ok, error: ok ? '' : (sms?.mock ? 'SMS not configured' : (sms?.error || 'send failed')) });
    }
  } catch (err) {
    attempts.push({ kind, channel: 'push', success: false, error: err.message });
  }

  const at = new Date();
  await Appointment.updateOne(
    { _id: appt._id },
    { $push: { reminderLog: { $each: attempts.map((a) => ({ ...a, at })), $slice: -10 } } }
  ).catch(() => {});
  return attempts;
};

const sweepReminders = async (now = new Date()) => {
  // Appointment.appointmentDate holds the calendar day; the exact time comes
  // from timeSlot (see clinicHours.slotInstant). A 3-day window keeps the
  // query small.
  const from = new Date(now.getTime() - DAY_MS);
  const to = new Date(now.getTime() + 2 * DAY_MS);
  const candidates = await Appointment.find({
    status: { $in: ACTIVE },
    appointmentDate: { $gte: from, $lte: to },
    $or: [{ reminderSent: { $ne: true } }, { reminder1hSent: { $ne: true } }],
  }).populate('clinic', 'name').lean();

  let sent = 0;
  for (const appt of candidates) {
    const slotAt = slotInstant(appt.appointmentDate, appt.timeSlot);
    const kind = dueReminder(appt, slotAt, now);
    if (!kind) continue;

    // Claim it atomically. The "hour" reminder also marks the day reminder
    // as done, so a booking made 30 minutes ahead gets one reminder, not two.
    const flag = kind === 'hour' ? 'reminder1hSent' : 'reminderSent';
    const set = kind === 'hour' ? { reminder1hSent: true, reminderSent: true } : { reminderSent: true };
    const claimed = await Appointment.findOneAndUpdate(
      { _id: appt._id, [flag]: { $ne: true }, status: { $in: ACTIVE } },
      { $set: set },
      { new: true }
    );
    if (!claimed) continue;

    await sendReminder(claimed, kind, slotAt, appt.clinic?.name);
    sent += 1;
  }
  return sent;
};

let timer = null;
const startAppointmentReminders = () => {
  if (timer) return timer;
  timer = setInterval(() => {
    sweepReminders().catch((err) => console.error('appointmentReminder error:', err.message));
  }, REMINDER_SWEEP_MS);
  if (timer.unref) timer.unref();
  return timer;
};

module.exports = { sweepReminders, startAppointmentReminders, dueReminder, REMINDER_SWEEP_MS };
