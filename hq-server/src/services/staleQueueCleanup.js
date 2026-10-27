/**
 * End-of-day clean-up for queue tickets left open.
 *
 * A ticket that is still "waiting", "called" or "serving" after its clinic day
 * has ended (the patient left, staff forgot to complete it, the app closed)
 * used to stay active forever. Those leftovers:
 *   - showed on the dashboards as "In Queue: 3" while the Queue page (which
 *     lists only today's tickets) was empty,
 *   - made the live clinic counter drift (even negative: "-1 waiting" in
 *     Nearby Clinics),
 *   - inflated wait-time estimates, which count people ahead in the queue.
 *
 * This job closes every active ticket that joined BEFORE today (Philippine
 * time) as `cancelled`, stamps autoClosedAt so reports can tell it apart from
 * a patient cancellation, and then resets each clinic's live counter to the
 * real number of active tickets today. It runs at server start and then every
 * CLEANUP_INTERVAL_MS. Today's tickets are never touched.
 */
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const ACTIVE = ['waiting', 'called', 'serving'];

/** Midnight today in the server's time zone (Asia/Manila, see config.js). */
const startOfToday = (now = new Date()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; };

const closeStaleTickets = async (now = new Date()) => {
  const cutoff = startOfToday(now);
  const result = await QueueEntry.updateMany(
    { status: { $in: ACTIVE }, joinedAt: { $lt: cutoff } },
    { $set: { status: 'cancelled', cancelledAt: now, autoClosedAt: now } }
  );
  return result.modifiedCount || 0;
};

/** Live counter = actual active tickets today, for every clinic. */
const resyncClinicCounters = async (now = new Date()) => {
  const cutoff = startOfToday(now);
  const counts = await QueueEntry.aggregate([
    { $match: { status: { $in: ACTIVE }, joinedAt: { $gte: cutoff } } },
    { $group: { _id: '$clinic', n: { $sum: 1 } } },
  ]);
  const byClinic = new Map(counts.map((c) => [String(c._id), c.n]));
  const clinics = await Clinic.find({}).select('_id queueLength').lean();
  let fixed = 0;
  for (const c of clinics) {
    const actual = byClinic.get(String(c._id)) || 0;
    if (c.queueLength !== actual) {
      await Clinic.updateOne({ _id: c._id }, { $set: { queueLength: actual } });
      fixed += 1;
    }
  }
  return fixed;
};

const runCleanup = async (now = new Date()) => {
  const closed = await closeStaleTickets(now);
  const fixed = await resyncClinicCounters(now);
  if (closed || fixed) {
    console.log(`[staleQueueCleanup] closed ${closed} leftover ticket(s) from previous days; corrected ${fixed} clinic counter(s).`);
  }
  return { closed, fixed };
};

let timer = null;
const startStaleQueueCleanup = () => {
  if (timer) return timer;
  runCleanup().catch((err) => console.error('staleQueueCleanup error:', err.message));
  timer = setInterval(() => {
    runCleanup().catch((err) => console.error('staleQueueCleanup error:', err.message));
  }, CLEANUP_INTERVAL_MS);
  if (timer.unref) timer.unref();
  return timer;
};

module.exports = { runCleanup, closeStaleTickets, resyncClinicCounters, startStaleQueueCleanup, startOfToday };
