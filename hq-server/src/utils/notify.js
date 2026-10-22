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
  sendPushToUser(userId, {
    title,
    message,
    data: { type, refType: refType || '', refId: refId ? String(refId) : '', ...data },
  }).catch(() => {});

  return notification;
}

/**
 * notifyQueueEntry — one call for "tell the person behind this ticket".
 *   - Ticket linked to an app account  -> in-app notification + push (notifyUser)
 *   - Walk-in ticket WITH a phone      -> SMS via Semaphore
 *   - Walk-in ticket with NO phone     -> nothing can be sent; returns
 *                                         { channel:'none' } so staff know to
 *                                         call the ticket aloud / use the board.
 * Never throws (a failed notification must not fail the queue action) and
 * records the outcome in entry.notifyLog.
 *
 * SMS text carries the ticket number only — never the patient's name or
 * service — since SMS is not a private channel.
 */
async function notifyQueueEntry(entry, { kind, title, message, type = 'turn_alert' }) {
  let result = { channel: 'none', success: false, error: 'no contact method' };
  try {
    if (entry.patient) {
      await notifyUser(entry.patient, { title, message, type, refType: 'QueueEntry', refId: entry._id });
      result = { channel: 'push', success: true, error: '' };
    } else if (entry.patientPhone) {
      const sms = await sendSMS(entry.patientPhone, `[HealthQueue+] ${message}`);
      const delivered = Boolean(sms.success && !sms.mock);
      result = {
        channel: 'sms',
        success: delivered,
        error: delivered ? '' : (sms.mock ? 'SMS not configured' : (sms.error || 'send failed')),
      };
    }
  } catch (err) {
    result = { channel: result.channel === 'none' ? 'push' : result.channel, success: false, error: err.message };
  }

  if (result.channel !== 'none') {
    QueueEntry.updateOne(
      { _id: entry._id },
      { $push: { notifyLog: { $each: [{ kind, channel: result.channel, success: result.success, error: result.error, at: new Date() }], $slice: -20 } } }
    ).catch(() => {});
  }
  return result;
}

module.exports = { notifyUser, notifyQueueEntry };
