/**
 * Prescriptive Controller — Peak-hours analytics + visit-timing advice for
 * the patient-facing "AI Health Forecast" screen.
 *
 * This endpoint did not exist before — the mobile app (ai_insights_screen.dart)
 * has been calling GET /prescriptive/evaluate and GET /prescriptive/best-time/:id
 * since it was written, but nothing was mounted at /api/prescriptive, so every
 * call 404'd and the screen fell back to its hardcoded placeholder data.
 *
 * IMPORTANT — scope of `evaluate`:
 * The mobile UI has three critical status strings wired up already
 * (ISOLATION_DIRECT_ROUTE, LOCK_REGISTRATION, DISPLAY_SURGE_ALERT) that imply
 * symptom-based clinical triage — e.g. routing a patient with certain
 * symptoms directly to isolation. That is a clinical-safety decision, not an
 * engineering one, so this controller deliberately does NOT invent rules for
 * it. `evaluate` below only implements DISPLAY_SURGE_ALERT, driven purely by
 * how full the clinic's queue is — nothing based on the `symptoms` field.
 * ISOLATION_DIRECT_ROUTE and LOCK_REGISTRATION are left unimplemented
 * (status simply never returns those values) until you specify the actual
 * trigger conditions you want.
 */
const mongoose = require('mongoose');
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const { HttpStatus } = require('../config/constants');

const HOUR_LABELS = ['12 AM','1 AM','2 AM','3 AM','4 AM','5 AM','6 AM','7 AM','8 AM','9 AM','10 AM','11 AM',
  '12 PM','1 PM','2 PM','3 PM','4 PM','5 PM','6 PM','7 PM','8 PM','9 PM','10 PM','11 PM'];
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Clinics open roughly 8 AM–5 PM in this dataset — narrows the hourly chart
// to relevant hours instead of 24 mostly-empty bars.
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;

// GET /api/prescriptive/best-time/:clinicId
const getBestTimeToQueue = async (req, res) => {
  try {
    const { clinicId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(clinicId)) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Invalid clinic id.' });
    }

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const clinicObjectId = new mongoose.Types.ObjectId(clinicId);

    // ── Hourly pattern (last 30 days, grouped by hour-of-day) ────────────────
    const hourlyAgg = await QueueEntry.aggregate([
      { $match: { clinic: clinicObjectId, joinedAt: { $gte: since } } },
      {
        $group: {
          _id: { $hour: '$joinedAt' },
          count: { $sum: 1 },
          avgWait: { $avg: '$waitTimeInMinutes' },
        },
      },
    ]);
    const hourlyByHour = new Map(hourlyAgg.map((h) => [h._id, h]));
    const openHours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
    const maxHourlyCount = Math.max(1, ...openHours.map((h) => hourlyByHour.get(h)?.count || 0));
    const hourlyData = openHours.map((h) => {
      const bucket = hourlyByHour.get(h);
      const count = bucket?.count || 0;
      return {
        hour: h,
        label: HOUR_LABELS[h],
        count,
        avgWait: Math.round(bucket?.avgWait || 0),
        // Peak = within 80% of this clinic's busiest open hour, not an
        // arbitrary fixed count, so it's meaningful for both quiet and busy
        // clinics.
        isPeak: count >= maxHourlyCount * 0.8 && count > 0,
      };
    });

    // ── Weekly pattern (last 30 days, grouped by day-of-week) ────────────────
    const weeklyAgg = await QueueEntry.aggregate([
      { $match: { clinic: clinicObjectId, joinedAt: { $gte: since } } },
      { $group: { _id: { $dayOfWeek: '$joinedAt' }, count: { $sum: 1 } } },
    ]);
    // Mongo $dayOfWeek is 1=Sunday..7=Saturday; align to JS's 0=Sunday.
    const weeklyByDay = new Map(weeklyAgg.map((d) => [d._id - 1, d.count]));
    const weeklyData = DAY_LABELS.map((label, idx) => ({
      label,
      count: weeklyByDay.get(idx) || 0,
    }));

    // ── Service load (last 30 days, grouped by service name) ─────────────────
    const servicesAgg = await QueueEntry.aggregate([
      { $match: { clinic: clinicObjectId, joinedAt: { $gte: since } } },
      {
        $group: {
          _id: '$serviceName',
          count: { $sum: 1 },
          avgWait: { $avg: '$waitTimeInMinutes' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);
    const maxServiceCount = Math.max(1, ...servicesAgg.map((s) => s.count));
    const servicesData = servicesAgg.map((s) => {
      const ratio = s.count / maxServiceCount;
      const load = ratio >= 0.66 ? 'High' : ratio >= 0.33 ? 'Medium' : 'Low';
      return {
        name: s._id || 'Service',
        avgWait: Math.round(s.avgWait || 0),
        count: s.count,
        load,
      };
    });

    // ── Overall stats + plain-language recommendation ────────────────────────
    const totalEntries = hourlyAgg.reduce((sum, h) => sum + h.count, 0);
    const avgWaitAll = totalEntries > 0
      ? Math.round(hourlyAgg.reduce((sum, h) => sum + h.avgWait * h.count, 0) / totalEntries)
      : 0;
    const peakBucket = hourlyData.reduce((best, h) => (h.count > (best?.count || 0) ? h : best), null);
    const quietBucket = openHours
      .map((h) => hourlyByHour.get(h))
      .filter(Boolean)
      .reduce((best, h) => (h.count < (best?.count ?? Infinity) ? h : best), null);
    const quietHour = quietBucket
      ? hourlyData.find((h) => hourlyByHour.get(h.hour) === quietBucket)
      : null;

    const recommendation = totalEntries === 0
      ? "We don't have enough recent visits at this clinic yet to recommend a best time — any time should be fine."
      : quietHour
        ? `${quietHour.label} tends to be quietest here, with about ${quietHour.count} patients and a ${quietHour.avgWait}-minute average wait. Avoid ${peakBucket?.label || 'midday'} if you can — it's this clinic's busiest hour.`
        : 'Morning hours (8–10 AM) tend to have shorter wait times.';

    return res.status(HttpStatus.OK).json({
      success: true,
      avgWaitAll,
      peakLoad: peakBucket?.count || 0,
      peakLabel: peakBucket?.label || '10 AM',
      recommendation,
      hourlyData,
      weeklyData,
      servicesData,
    });
  } catch (err) {
    console.error('getBestTimeToQueue Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to compute peak-hours data.' });
  }
};

// GET /api/prescriptive/evaluate?lat&lng&purpose&symptoms&patientType
//
// Only implements DISPLAY_SURGE_ALERT (queue-load based). See file header —
// ISOLATION_DIRECT_ROUTE and LOCK_REGISTRATION need clinical rules you define.
const evaluate = async (req, res) => {
  try {
    const { patientType } = req.query;

    // Surge = any active clinic currently reporting a materially long queue.
    // Threshold is a starting point, not a clinical judgment — adjust freely.
    const SURGE_WAIT_THRESHOLD_MINUTES = 45;
    const surgingClinic = await Clinic.findOne({
      isActive: true,
      currentWaitingTime: { $gte: SURGE_WAIT_THRESHOLD_MINUTES },
    }).sort({ currentWaitingTime: -1 }).lean();

    if (surgingClinic) {
      return res.status(HttpStatus.OK).json({
        success: true,
        status: 'DISPLAY_SURGE_ALERT',
        message: `${surgingClinic.name} is currently experiencing high patient volume (est. ${surgingClinic.currentWaitingTime}-min wait). Consider a different clinic or time if your visit isn't urgent.`,
      });
    }

    const priorityNote = ['Senior Citizen', 'PWD', 'Pregnant', 'Priority'].includes(patientType)
      ? ' As a priority patient, you\'ll be seen ahead of the regular queue.'
      : '';

    return res.status(HttpStatus.OK).json({
      success: true,
      status: 'NORMAL',
      message: `No unusual delays right now.${priorityNote}`,
    });
  } catch (err) {
    console.error('evaluate Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to evaluate prescription.' });
  }
};

module.exports = { getBestTimeToQueue, evaluate };
