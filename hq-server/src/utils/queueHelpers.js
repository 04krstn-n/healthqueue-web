/**
 * Queue Utility Helpers
 */
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');

/**
 * Generate the next queue number for a clinic today.
 * Format: <prefix><3-digit-number> e.g. Q001, Q002 …
 */
const getNextQueueNumber = async (clinicId, prefix = 'Q') => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const count = await QueueEntry.countDocuments({
    clinic: clinicId,
    joinedAt: { $gte: start },
  });

  const num = String(count + 1).padStart(3, '0');
  return `${prefix}${num}`;
};

/**
 * Estimate wait time in minutes based on active queue + base wait time per person.
 */
const estimateWaitTime = async (clinicId) => {
  const clinic = await Clinic.findById(clinicId).select('baseWaitTimePerPerson');
  const base = clinic?.baseWaitTimePerPerson || 10;

  const active = await QueueEntry.countDocuments({
    clinic: clinicId,
    status: { $in: ['waiting', 'serving'] },
  });

  return active * base;
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