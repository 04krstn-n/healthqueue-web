/**
 * Analytics Service — Aggregates AWT & TAT metrics per clinic
 * Rule: Excludes 'cancelled' and 'no_show' transactions from computations
 */
const QueueEntry = require('../models/QueueEntry');

/**
 * Calculates raw metrics for a specific clinic or set of clinics
 */
const getClinicQueueMetrics = async (clinicId) => {
  // 1. Count active queues (waiting + serving)
  const activeQueueCount = await QueueEntry.countDocuments({
    clinic: clinicId,
    status: { $in: ['waiting', 'serving'] },
  });

  // 2. Aggregate average wait time (AWT) and turnaround time (TAT)
  // CRITICAL: Filter out cancelled and no_show transactions for data integrity
  const stats = await QueueEntry.aggregate([
    {
      $match: {
        clinic: clinicId,
        status: { $in: ['completed', 'done'] }, // ONLY completed visits
      },
    },
    {
      $group: {
        _id: '$clinic',
        avgWaitTime: { $avg: '$waitTimeInMinutes' },
        avgTurnaroundTime: { $avg: '$turnaroundTimeInMinutes' },
        totalCompleted: { $sum: 1 },
      },
    },
  ]);

  const metric = stats[0] || {};

  return {
    clinicId,
    activeQueueCount,
    avgWaitMinutes: Math.round(metric.avgWaitTime || 15),
    avgTurnaroundMinutes: Math.round(metric.avgTurnaroundTime || 20),
    totalCompletedToday: metric.totalCompleted || 0,
  };
};

module.exports = { getClinicQueueMetrics };