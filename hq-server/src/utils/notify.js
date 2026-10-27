/**
 * notifyUser — creates the in-app Notification record (unchanged
 * behavior — still shows in GET /notifications) AND sends a real push
 * via Firebase so the patient is reached even if the app isn't open.
 * Use this everywhere a patient-facing notification is created, instead
 * of calling Notification.create() directly.
 */
const Notification = require('../models/Notification');
const { sendPushToUser } = require('../services/pushService');
const { sendSMS } = require('../services/smsService');
const QueueEntry = require('../models/QueueEntry');

async function notifyUser(userId, { title, message, type = 'system', refType = null, refId = null, data = {} }) {
  const notification = await Notification.create({
    user: userId,
    title,
    message,
    type,
    refType,
    refId,
  });

  // Fire-and-forget — a push failure must never fail the caller's actual
  // request (joining a queue, calling a patient, etc. all still need to
  // succeed even if the push itself doesn't go through).
  // `pushPromise` is exposed (non-enumerable) so notifyQueueEntry can wait
  // for the real outcome and fall back to SMS; other callers ignore it.
  const pushPromise = sendPushToUser(userId, {
    title,
    message,
    data: { type, refType: refType || '', refId: refId ? String(refId) : '', ...data },
  }).catch((err) => ({ success: false, error: err.message }));
  Object.defineProperty(notification, 'pushPromise', { value: pushPromise, enumerable: false });

  return notification;
}

// Time-critical alerts. If the push for one of these does not go out, the
// patient is texted instead (when a phone number is on file). Routine
// position updates (#7, #5, #3) are not texted, to save SMS credits; they
// stay in the in-app list and the next queue change retries them.
const SMS_FALLBACK_KINDS = new Set(['next', 'called', 'no_show']);

const smsOutcome = (sms) => {
  const delivered = Boolean(sms.success && !sms.mock);
  return {
    success: delivered,
    error: delivered ? '' : (sms.mock ? 'SMS not configured' : (sms.error || 'send failed')),
  };
};

/**
 * notifyQueueEntry — one call for "tell the person behind this ticket".
 *   - Ticket linked to an app account  -> in-app notification + push
 *       (push is retried once on a temporary error; if it still fails, or the
 *        phone has no registered device, important alerts fall back to SMS)
 *   - Walk-in ticket WITH a phone      -> SMS via Semaphore
 *   - Walk-in ticket with NO phone     -> nothing can be sent; returns
 *                                         { channel:'none' } so staff know to
 *                                         call the ticket aloud / use the board.
 * Never throws (a failed notification must not fail the queue action) and
 * records every attempt — including failed pushes — in entry.notifyLog.
 *
 * SMS text carries the ticket number only — never the patient's name or
 * service — since SMS is not a private channel.
 */
async function notifyQueueEntry(entry, { kind, title, message, type = 'turn_alert' }) {
  const attempts = []; // every channel tried, for the delivery log
  let result = { channel: 'none', success: false, error: 'no contact method' };

  try {
    if (entry.patient) {
      const notif = await notifyUser(entry.patient, { title, message, type, refType: 'QueueEntry', refId: entry._id });
      const push = (await notif.pushPromise) || { success: false, error: 'unknown' };
      attempts.push({ channel: 'push', success: push.success, error: push.error || '' });
      result = { channel: 'push', success: push.success, error: push.error || '' };

      if (!push.success && entry.patientPhone && SMS_FALLBACK_KINDS.has(kind)) {
        const sms = smsOutcome(await sendSMS(entry.patientPhone, `[HealthQueue+] ${message}`));
        attempts.push({ channel: 'sms', ...sms, fallback: true });
        if (sms.success) result = { channel: 'sms', success: true, error: '', fallback: true };
      }

      // The in-app notification is always created, so an app user is never
      // left with nothing even if push and SMS both fail.
      if (!result.success) result.inAppOnly = true;
    } else if (entry.patientPhone) {
      const sms = smsOutcome(await sendSMS(entry.patientPhone, `[HealthQueue+] ${message}`));
      attempts.push({ channel: 'sms', ...sms });
      result = { channel: 'sms', ...sms };
    }
  } catch (err) {
    const channel = result.channel === 'none' ? 'push' : result.channel;
    attempts.push({ channel, success: false, error: err.message });
    result = { channel, success: false, error: err.message };
  }

  if (attempts.length) {
    const at = new Date();
    QueueEntry.updateOne(
      { _id: entry._id },
      {
        $push: {
          notifyLog: {
            $each: attempts.map((a) => ({ kind, channel: a.channel, success: a.success, error: a.error || '', at })),
            $slice: -20,
          },
        },
      }
    ).catch(() => {});
  }
  return result;
}

module.exports = { notifyUser, notifyQueueEntry };
