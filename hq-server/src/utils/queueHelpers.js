/**
 * Queue Utility Helpers
 */
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const Counter = require('../models/Counter');

/**
 * Generate the next queue number for a clinic today.
 * Format: <prefix><3-digit-number> e.g. Q001, Q002 …
 *
 * This used to count today's existing entries and return count+1 — that's
 * a classic non-atomic "read, then use read+1" pattern. Two patients
 * joining within milliseconds of each other could both read the count
 * BEFORE either one's new entry was actually saved, so both would compute
 * the same "next" number — same displayed queue number, even though their
 * actual join order (and position in the queue) differed. This is the
 * exact bug reported: same number, different position.
 *
 * findOneAndUpdate with $inc is a single atomic database operation —
 * MongoDB guarantees two concurrent callers can never be handed the same
 * resulting seq value, no matter how close together the requests arrive.
 * Numbers stay fully sequential/consecutive (1, 2, 3, ...) with zero
 * collisions, and the daily reset behavior is unchanged (see Counter.js).
 */
const getNextQueueNumber = async (clinicId, prefix = 'Q') => {
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC) — resets the counter daily
  const counterId = `${clinicId}_${dateKey}_${prefix}`;

  const counter = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const num = String(counter.seq).padStart(3, '0');
  return `${prefix}${num}`;
};

/**
 * Estimate wait time in minutes based on active queue + per-person duration.
 *
 * When `serviceId` is given, the estimate uses THAT service's own
 * `durationMinutes` (set via the Waiting Time Update screen /
 * PUT /api/services/:clinicId/:serviceId) instead of the clinic's generic
 * `baseWaitTimePerPerson`. Previously this function only ever read
 * baseWaitTimePerPerson — meaning updating a service's duration had NO
 * effect on anyone's displayed wait time anywhere in the app, staff or
 * patient side, since nothing ever consulted that field. Falls back to
 * baseWaitTimePerPerson when no serviceId is given or the service can't be
 * found, so existing callers that don't pass one keep working exactly as
 * before.
 */
const estimateWaitTime = async (clinicId, serviceId = null) => {
  const clinic = await Clinic.findById(clinicId).select('baseWaitTimePerPerson services');
  let perPerson = clinic?.baseWaitTimePerPerson || 10;

  if (serviceId && clinic?.services?.length) {
    const svc = clinic.services.id(serviceId);
    if (svc?.durationMinutes) perPerson = svc.durationMinutes;
  }

  const active = await QueueEntry.countDocuments({
    clinic: clinicId,
    status: { $in: ['waiting', 'serving'] },
  });

  return active * perPerson;
};

/**
 * Get average wait time (AWT) for completed entries today at a clinic.
 * Excludes cancelled and no_show transactions.
 */
const getAvgWaitTime = async (clinicId) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const completed = await QueueEntry.find({
    clinic: clinicId,
    status: { $in: ['done', 'completed'] }, // Filter out cancelled/skipped entries
    calledAt: { $ne: null },
    joinedAt: { $gte: start },
  }).select('joinedAt calledAt');

  if (!completed.length) return 0;

  const total = completed.reduce(
    (sum, entry) => sum + (new Date(entry.calledAt) - new Date(entry.joinedAt)) / 60000,
    0
  );

  return Math.round(total / completed.length);
};

/**
 * Get average Turnaround Time (TAT) from join to completion today.
 */
const getAvgTurnaroundTime = async (clinicId) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const completed = await QueueEntry.find({
    clinic: clinicId,
    status: { $in: ['done', 'completed'] },
    completedAt: { $ne: null },
    joinedAt: { $gte: start },
  }).select('joinedAt completedAt');

  if (!completed.length) return 0;

  const total = completed.reduce(
    (sum, entry) => sum + (new Date(entry.completedAt) - new Date(entry.joinedAt)) / 60000,
    0
  );

  return Math.round(total / completed.length);
};

/**
 * En-Route Queueing: Calculates 5-minute arrival grace period expiry
 */
const getGracePeriodExpiry = (minutes = 5) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};

/**
 * Checks if patient's 5-minute grace period has expired
 */
const isGracePeriodExpired = (gracePeriodExpiresAt) => {
  if (!gracePeriodExpiresAt) return false;
  return new Date() > new Date(gracePeriodExpiresAt);
};

module.exports = {
  getNextQueueNumber,
  estimateWaitTime,
  getAvgWaitTime,
  getAvgTurnaroundTime,
  getGracePeriodExpiry,
  isGracePeriodExpired,
};