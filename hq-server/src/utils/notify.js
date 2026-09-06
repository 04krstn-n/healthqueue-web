/**
 * notifyUser — creates the in-app Notification record (unchanged
 * behavior — still shows in GET /notifications) AND sends a real push
 * via Firebase so the patient is reached even if the app isn't open.
 * Use this everywhere a patient-facing notification is created, instead
 * of calling Notification.create() directly.
 */
const Notification = require('../models/Notification');
const { sendPushToUser } = require('../services/pushService');

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

module.exports = { notifyUser };
