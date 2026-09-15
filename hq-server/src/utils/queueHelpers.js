/**
 * Queue Utility Helpers
 *
 * ─── SINGLE SOURCE OF TRUTH (Capstone Requirement #1) ────────────────────────
 * Every wait-time / queue-ordering number shown anywhere in HealthQueue+
 * (patient mobile, staff tablet, web client) is produced by the functions in
 * this file and travels to the clients as data on the QueueEntry / API
 * response — mobile and tablet never recompute it themselves. If you need a
 * new number, add a function here rather than deriving it client-side.
 */
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const Counter = require('../models/Counter');

// Sanity bounds so a data glitch (e.g. one truly stuck ticket) can never
// produce an estimate that would visibly mislead a patient (item 2/6:
// "avoid unrealistic waiting-time predictions").
const MIN_PER_PERSON_MINUTES = 3;
const MAX_PER_PERSON_MINUTES = 90;
const MAX_TOTAL_ESTIMATE_MINUTES = 240; // 4 hours — cap, not a promise

const round5 = (n) => Math.round(n / 5) * 5;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Generate the next queue number for a clinic today.
 * Format: <prefix><3-digit-number> e.g. Q001, Q002 …
 * Atomic $inc via Counter — see Counter.js header for why this matters.
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
 * ─── Per-person service duration, blended from real data (item 2) ──────────
 * Blends, in order of preference:
 *   1. Today's own completed visits for this clinic+service ("recent
 *      performance" / current throughput) — needs >= MIN_RECENT samples.
 *   2. Last-30-day history for this clinic+service — needs >= MIN_HIST
 *      samples. This is what lets the estimate improve as real clinic data
 *      accumulates (item 6), and it is always scoped to ONE clinic (item 7 —
 *      never mixes clinics).
 *   3. Configured duration (Clinic.services[].durationMinutes, falling back
 *      to Clinic.baseWaitTimePerPerson) — the safe baseline used when there
 *      isn't enough real data yet.
 * Recent and historical are blended (not just "pick one") so a single busy
 * or quiet day doesn't swing the estimate — the same reasoning as a moving
 * average, kept intentionally simple for a capstone defense.
 */
const MIN_RECENT_SAMPLES = 3;
const MIN_HIST_SAMPLES = 5;

const getConfiguredDuration = async (clinicId, serviceId) => {
  const clinic = await Clinic.findById(clinicId).select('baseWaitTimePerPerson services');
  let perPerson = clinic?.baseWaitTimePerPerson || 10;
  if (serviceId && clinic?.services?.length) {
    const svc = clinic.services.id ? clinic.services.id(serviceId) : null;
    if (svc?.durationMinutes) perPerson = svc.durationMinutes;
  }
  return { perPerson, clinic };
};

const avgOf = (arr, field) => {
  const vals = arr.map((e) => e[field]).filter((v) => typeof v === 'number' && v > 0);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
};

const getPerPersonDuration = async (clinicId, serviceId) => {
  const { perPerson: configured } = await getConfiguredDuration(clinicId, serviceId);

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const since30d = new Date(); since30d.setDate(since30d.getDate() - 30);

  const baseMatch = { clinic: clinicId, status: { $in: ['completed', 'done'] } };
  if (serviceId) baseMatch.serviceId = serviceId;

  const [todayCompleted, historyCompleted] = await Promise.all([
    QueueEntry.find({ ...baseMatch, joinedAt: { $gte: start } })
      .select('serviceTimeInMinutes waitTimeInMinutes').lean(),
    QueueEntry.find({ ...baseMatch, joinedAt: { $gte: since30d } })
      .select('serviceTimeInMinutes').lean(),
  ]);

  const recentAvg = avgOf(todayCompleted, 'serviceTimeInMinutes');
  const historicalAvg = avgOf(historyCompleted, 'serviceTimeInMinutes');

  let perPerson;
  let basis;
  if (todayCompleted.length >= MIN_RECENT_SAMPLES && recentAvg) {
    perPerson = historicalAvg
      ? recentAvg * 0.6 + historicalAvg * 0.4
      : recentAvg;
    basis = historicalAvg ? 'recent+historical' : 'recent';
  } else if (historyCompleted.length >= MIN_HIST_SAMPLES && historicalAvg) {
    perPerson = historicalAvg;
    basis = 'historical';
  } else {
    perPerson = configured;
    basis = 'configured-baseline';
  }

  perPerson = clamp(Math.round(perPerson), MIN_PER_PERSON_MINUTES, MAX_PER_PERSON_MINUTES);

  return {
    perPerson,
    basis,
    recentSamples: todayCompleted.length,
    historicalSamples: historyCompleted.length,
    recentAvg: recentAvg ? Math.round(recentAvg) : null,
    historicalAvg: historicalAvg ? Math.round(historicalAvg) : null,
    configured,
  };
};

/**
 * Time-of-day / day-of-week adjustment (item 2/6). Only applied when there
 * are enough historical samples in this specific hour bucket to trust it —
 * otherwise it's left at 1.0 (no effect) rather than guessing, per the
 * "avoid unreliable predictions with insufficient data" requirement.
 */
const MIN_HOUR_SAMPLES = 8;

const getTimeOfDayFactor = async (clinicId, serviceId) => {
  const since30d = new Date(); since30d.setDate(since30d.getDate() - 30);
  const now = new Date();
  const match = { clinic: clinicId, joinedAt: { $gte: since30d }, waitTimeInMinutes: { $gt: 0 } };
  if (serviceId) match.serviceId = serviceId;

  const agg = await QueueEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { hour: { $hour: { date: '$joinedAt', timezone: 'Asia/Manila' } } },
        avgWait: { $avg: '$waitTimeInMinutes' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (!agg.length) return 1;

  const overallAvg = agg.reduce((s, b) => s + b.avgWait * b.count, 0) / agg.reduce((s, b) => s + b.count, 0);
  const currentHour = now.getHours();
  const bucket = agg.find((b) => b._id.hour === currentHour);
  if (!bucket || bucket.count < MIN_HOUR_SAMPLES || !overallAvg) return 1;

  return clamp(bucket.avgWait / overallAvg, 0.7, 1.4);
};

/**
 * ─── The authoritative live wait estimate (item 1 & 2) ──────────────────────
 * Used by joinQueue, addWalkIn, getQueueEntries and getMyQueueStatus — i.e.
 * every place that shows a wait-time number to a patient or to staff. There
 * is exactly one formula; nothing in mobile/tablet recomputes this.
 *
 * peopleAheadOverride lets a caller who has already computed the
 * priority-ratio-aware "people ahead of THIS patient" count (see
 * orderQueueByPriorityRatio below) pass it in for a personalized estimate;
 * otherwise this falls back to the general "if I joined right now" count.
 */
const estimateWaitTime = async (clinicId, serviceId = null, { peopleAheadOverride = null } = {}) => {
  // Staff-applied override always wins — this is what makes "apply
  // suggestion" actually become THE operational number for every client
  // (item 1), instead of just changing one screen's local state.
  const clinicOverride = await Clinic.findById(clinicId).select('waitTimeOverrideMinutes').lean();
  if (typeof clinicOverride?.waitTimeOverrideMinutes === 'number') {
    return clinicOverride.waitTimeOverrideMinutes;
  }

  const { perPerson } = await getPerPersonDuration(clinicId, serviceId);

  let peopleAhead;
  if (peopleAheadOverride !== null) {
    peopleAhead = peopleAheadOverride;
  } else {
    const activeMatch = { clinic: clinicId, status: { $in: ['waiting', 'serving'] } };
    if (serviceId) activeMatch.serviceId = serviceId;
    peopleAhead = await QueueEntry.countDocuments(activeMatch);
  }

  const timeFactor = await getTimeOfDayFactor(clinicId, serviceId);
  const raw = peopleAhead * perPerson * timeFactor;
  const estimate = peopleAhead === 0 ? 0 : clamp(round5(raw) || perPerson, perPerson, MAX_TOTAL_ESTIMATE_MINUTES);

  return estimate;
};

/**
 * Same computation as estimateWaitTime, but returns the explanation too —
 * this is what backs the staff-facing "suggested waiting time" (item 1) that
 * the tablet can accept or reject, instead of the tablet computing its own
 * separate ad-hoc suggestion.
 */
const computeSuggestedWaitTime = async (clinicId, serviceId = null) => {
  const durationInfo = await getPerPersonDuration(clinicId, serviceId);
  const activeMatch = { clinic: clinicId, status: { $in: ['waiting', 'serving'] } };
  if (serviceId) activeMatch.serviceId = serviceId;
  const peopleAhead = await QueueEntry.countDocuments(activeMatch);
  const timeFactor = await getTimeOfDayFactor(clinicId, serviceId);

  const raw = peopleAhead * durationInfo.perPerson * timeFactor;
  const suggestedMinutes = peopleAhead === 0
    ? durationInfo.perPerson
    : clamp(round5(raw) || durationInfo.perPerson, durationInfo.perPerson, MAX_TOTAL_ESTIMATE_MINUTES);

  const totalSamples = durationInfo.recentSamples + durationInfo.historicalSamples;
  const confidence = totalSamples >= 15 ? 'high' : totalSamples >= 5 ? 'medium' : 'low';

  const reasonParts = [
    `${peopleAhead} patient(s) currently waiting/being served`,
    `~${durationInfo.perPerson} min/patient (${durationInfo.basis.replace('-', ' ')})`,
  ];
  if (timeFactor !== 1) {
    reasonParts.push(`${timeFactor > 1 ? 'busier' : 'quieter'} than average for this time of day`);
  }

  return {
    suggestedMinutes,
    confidence,
    basis: durationInfo.basis,
    perPersonMinutes: durationInfo.perPerson,
    peopleAhead,
    timeOfDayFactor: timeFactor,
    recentSamples: durationInfo.recentSamples,
    historicalSamples: durationInfo.historicalSamples,
    reason: reasonParts.join('; '),
    isEstimate: true, // never phrase this as a guarantee — item 2 requirement
  };
};

/**
 * ─── Priority-ratio queue ordering (item 4) ─────────────────────────────────
 * Interleaves priority and regular patients using a configurable ratio
 * (default 1 priority : 3 regular) instead of either (a) pure FIFO, which
 * ignores approved priority status entirely, or (b) "all priority patients
 * go first", which can starve regular patients indefinitely while priority
 * patients keep arriving. Within each group, order is still FIFO by
 * joinedAt — the ratio only decides how the two FIFO lines are interleaved.
 *
 * `entries` should be the clinic's currently-`waiting` entries. Returns a
 * NEW array in serving order, with `queuePosition` (1-based) attached to
 * each entry object for display.
 */
const orderQueueByPriorityRatio = (entries, ratio = { priority: 1, regular: 3 }) => {
  const byJoinedAt = (a, b) => new Date(a.joinedAt) - new Date(b.joinedAt);

  const priorityQueue = entries.filter((e) => e.priority || e.queueType === 'Priority').sort(byJoinedAt);
  const regularQueue = entries.filter((e) => !(e.priority || e.queueType === 'Priority')).sort(byJoinedAt);

  const pStep = Math.max(1, ratio?.priority || 1);
  const rStep = Math.max(1, ratio?.regular || 3);

  const ordered = [];
  let pi = 0, ri = 0;
  while (pi < priorityQueue.length || ri < regularQueue.length) {
    for (let k = 0; k < pStep && pi < priorityQueue.length; k++) ordered.push(priorityQueue[pi++]);
    for (let k = 0; k < rStep && ri < regularQueue.length; k++) ordered.push(regularQueue[ri++]);
    if (pi >= priorityQueue.length && ri >= regularQueue.length) break;
  }

  return ordered.map((e, idx) => {
    const obj = e.toObject ? e.toObject() : e;
    obj.queuePosition = idx + 1;
    return obj;
  });
};

/**
 * Fetches the clinic's configured priority ratio, falling back to 1:3.
 */
const getPriorityRatio = async (clinicId) => {
  const clinic = await Clinic.findById(clinicId).select('priorityRatio').lean();
  return clinic?.priorityRatio || { priority: 1, regular: 3 };
};

/**
 * ─── Average metrics (item 3/7) — read the fields the model already
 * computed at write time, rather than re-deriving them from raw timestamps
 * in three different places (analyticsController, dashboardController,
 * analyticsService all used to do their own slightly-different aggregate —
 * this is the "duplicated calculation" item 1 warns against, just on the
 * server side instead of across apps). Always clinic-scoped (item 7).
 */
const getAvgWaitTime = async (clinicId) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const agg = await QueueEntry.aggregate([
    { $match: { clinic: clinicId, status: { $in: ['done', 'completed'] }, joinedAt: { $gte: start }, waitTimeInMinutes: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: '$waitTimeInMinutes' } } },
  ]);
  return Math.round(agg[0]?.avg || 0);
};

const getAvgServiceTime = async (clinicId) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const agg = await QueueEntry.aggregate([
    { $match: { clinic: clinicId, status: { $in: ['done', 'completed'] }, joinedAt: { $gte: start }, serviceTimeInMinutes: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: '$serviceTimeInMinutes' } } },
  ]);
  return Math.round(agg[0]?.avg || 0);
};

const getAvgTurnaroundTime = async (clinicId) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const agg = await QueueEntry.aggregate([
    { $match: { clinic: clinicId, status: { $in: ['done', 'completed'] }, joinedAt: { $gte: start }, turnaroundTimeInMinutes: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: '$turnaroundTimeInMinutes' } } },
  ]);
  return Math.round(agg[0]?.avg || 0);
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
  computeSuggestedWaitTime,
  orderQueueByPriorityRatio,
  getPriorityRatio,
  getAvgWaitTime,
  getAvgServiceTime,
  getAvgTurnaroundTime,
  getGracePeriodExpiry,
  isGracePeriodExpired,
};
