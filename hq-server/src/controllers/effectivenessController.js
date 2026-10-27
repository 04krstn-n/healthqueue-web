/**
 * Effectiveness (before vs after HealthQueue+) — answers the panel's
 * "did the queuing process actually become faster?" with data.
 *
 *  BEFORE = manually timed visits entered via POST /api/analytics/baseline
 *  AFTER  = completed QueueEntry records (servedAt - joinedAt), computed live
 *
 * Both sides report the number of observations (n); with a small n the
 * response says so, so the manuscript doesn't overclaim.
 */
const mongoose = require('mongoose');
const BaselineObservation = require('../models/BaselineObservation');
const QueueEntry = require('../models/QueueEntry');
const { HttpStatus } = require('../config/config');
const { isObjectId } = require('../utils/validators');

const round1 = (n) => Math.round(n * 10) / 10;
const summarize = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, mean: null, median: null, min: null, max: null };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return { n, mean: round1(mean), median: round1(median), min: v[0], max: v[n - 1] };
};

/**
 * Forecast accuracy (S4) — predicted vs actual waiting time per ticket.
 *   predicted = QueueEntry.estimatedWaitMinutes (stored when the ticket was made)
 *   actual    = QueueEntry.waitTimeInMinutes (joinedAt -> servedAt)
 * MAE  = average of |predicted - actual|  (how far off, in minutes)
 * Bias = average of (predicted - actual)   (negative = system under-estimates)
 */
const MIN_BASELINE_HISTORY = 5;

/**
 * Simple baseline the panel asked to compare against: "historical average
 * waiting time". For each completed ticket (in time order), the baseline
 * prediction is the average actual wait of all EARLIER completed tickets —
 * it never sees the ticket it is predicting. Tickets with fewer than
 * MIN_BASELINE_HISTORY earlier tickets are skipped.
 */
const baselineAccuracy = (entries) => {
  const sorted = entries
    .filter((e) => Number.isFinite(e.waitTimeInMinutes) && e.joinedAt)
    .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
  let sum = 0;
  let count = 0;
  const abs = [];
  for (const e of sorted) {
    if (count >= MIN_BASELINE_HISTORY) abs.push(Math.abs(sum / count - e.waitTimeInMinutes));
    sum += e.waitTimeInMinutes;
    count += 1;
  }
  const n = abs.length;
  if (n === 0) return { n: 0, mae: null, within5Pct: null, within10Pct: null };
  const pct = (k) => round1((abs.filter((x) => x <= k).length / n) * 100);
  return { n, mae: round1(abs.reduce((a, b) => a + b, 0) / n), within5Pct: pct(5), within10Pct: pct(10) };
};

const forecastAccuracy = (entries) => {
  const pairs = entries
    .filter((e) => Number.isFinite(e.estimatedWaitMinutes) && Number.isFinite(e.waitTimeInMinutes))
    .map((e) => ({ predicted: e.estimatedWaitMinutes, actual: e.waitTimeInMinutes }));
  const n = pairs.length;
  if (n === 0) return { n: 0, mae: null, bias: null, within5Pct: null, within10Pct: null, sample: [] };
  const errs = pairs.map((p) => p.predicted - p.actual);
  const abs = errs.map(Math.abs);
  const pct = (k) => round1((abs.filter((x) => x <= k).length / n) * 100);
  return {
    n,
    mae: round1(abs.reduce((a, b) => a + b, 0) / n),
    bias: round1(errs.reduce((a, b) => a + b, 0) / n),
    within5Pct: pct(5),
    within10Pct: pct(10),
    avgPredicted: round1(pairs.reduce((a, p) => a + p.predicted, 0) / n),
    avgActual: round1(pairs.reduce((a, p) => a + p.actual, 0) / n),
  };
};

const scopeClinic = (req) => {
  if (req.user.role === 'facility_admin') return req.user.clinicId;
  const c = req.query.clinicId || req.body?.clinicId;
  return isObjectId(c) ? c : null;
};

const parseRange = (from, to) => {
  const range = {};
  if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) range.$gte = d; }
  if (to) { const d = new Date(to); if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); range.$lte = d; } }
  return range;
};

// POST /api/analytics/baseline  — body: one observation or { observations: [...] }
const addBaseline = async (req, res) => {
  try {
    const clinic = scopeClinic(req);
    if (!clinic) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'clinicId is required.' });
    const list = Array.isArray(req.body.observations) ? req.body.observations : [req.body];
    if (list.length === 0 || list.length > 500) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Send between 1 and 500 observations.' });
    }
    const docs = [];
    for (const o of list) {
      const wait = Number(o.waitMinutes);
      const at = new Date(o.observedAt);
      if (!Number.isFinite(wait) || wait < 0 || wait > 600 || Number.isNaN(at.getTime())) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Each observation needs observedAt (a date) and waitMinutes (0-600).',
        });
      }
      const svc = o.serviceMinutes === undefined || o.serviceMinutes === '' || o.serviceMinutes === null ? null : Number(o.serviceMinutes);
      if (svc !== null && (!Number.isFinite(svc) || svc < 0 || svc > 600)) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'serviceMinutes must be 0-600 when given.' });
      }
      docs.push({ clinic, observedAt: at, waitMinutes: wait, serviceMinutes: svc, method: o.method || undefined, recordedBy: req.user._id });
    }
    const saved = await BaselineObservation.insertMany(docs);
    return res.status(HttpStatus.CREATED).json({ success: true, count: saved.length });
  } catch (err) {
    console.error('addBaseline error:', err);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to save observations.' });
  }
};

// GET /api/analytics/effectiveness?clinicId&beforeFrom&beforeTo&afterFrom&afterTo
const getEffectiveness = async (req, res) => {
  try {
    const clinic = scopeClinic(req);
    if (!clinic) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'clinicId is required.' });
    const clinicId = new mongoose.Types.ObjectId(String(clinic));

    const beforeRange = parseRange(req.query.beforeFrom, req.query.beforeTo);
    const afterRange = parseRange(req.query.afterFrom, req.query.afterTo);

    const beforeFilter = { clinic: clinicId };
    if (Object.keys(beforeRange).length) beforeFilter.observedAt = beforeRange;
    const before = await BaselineObservation.find(beforeFilter).select('waitMinutes serviceMinutes').lean();

    const afterFilter = { clinic: clinicId, status: { $in: ['completed', 'done'] }, servedAt: { $ne: null } };
    if (Object.keys(afterRange).length) afterFilter.joinedAt = afterRange;
    const after = await QueueEntry.find(afterFilter)
      .select('queueNumber joinedAt estimatedWaitMinutes waitTimeInMinutes serviceTimeInMinutes joinedRemotely').lean();

    const beforeWait = summarize(before.map((b) => b.waitMinutes));
    const afterWait = summarize(after.map((a) => a.waitTimeInMinutes));
    const remoteWait = summarize(after.filter((a) => a.joinedRemotely).map((a) => a.waitTimeInMinutes));
    const walkInWait = summarize(after.filter((a) => !a.joinedRemotely).map((a) => a.waitTimeInMinutes));

    let change = null;
    if (beforeWait.n > 0 && afterWait.n > 0 && beforeWait.mean > 0) {
      const diff = round1(afterWait.mean - beforeWait.mean);
      change = {
        meanWaitDifferenceMinutes: diff, // negative = faster after HealthQueue+
        percent: round1((diff / beforeWait.mean) * 100),
        direction: diff < 0 ? 'shorter after HealthQueue+' : diff > 0 ? 'longer after HealthQueue+' : 'no change',
      };
    }

    const warnings = [];
    if (beforeWait.n < 30) warnings.push(`Only ${beforeWait.n} "before" observations; 30 or more is recommended before drawing conclusions.`);
    if (afterWait.n < 30) warnings.push(`Only ${afterWait.n} "after" observations; 30 or more is recommended before drawing conclusions.`);
    warnings.push('Compare similar days and hours, and the same clinic. A difference does not by itself prove HealthQueue+ caused it.');

    const accuracy = forecastAccuracy(after);
    // Same tickets, predicted with the historical-average baseline instead.
    accuracy.baseline = baselineAccuracy(after);
    if (accuracy.mae !== null && accuracy.baseline.mae !== null) {
      accuracy.comparison = {
        maeDifferenceMinutes: round1(accuracy.mae - accuracy.baseline.mae), // negative = HealthQueue+ estimate is better
        verdict: accuracy.mae < accuracy.baseline.mae
          ? 'HealthQueue+ estimate is closer to the actual wait than the historical average'
          : accuracy.mae > accuracy.baseline.mae
            ? 'The historical average is closer to the actual wait than the HealthQueue+ estimate'
            : 'Both methods have the same average error',
      };
    }
    // Latest 20 tickets, so the predicted-vs-actual comparison can be shown
    // row by row on the page (not just as a summary number).
    accuracy.sample = after
      .filter((e) => Number.isFinite(e.estimatedWaitMinutes) && Number.isFinite(e.waitTimeInMinutes))
      .sort((x, y) => new Date(y.joinedAt) - new Date(x.joinedAt))
      .slice(0, 20)
      .map((e) => ({
        queueNumber: e.queueNumber,
        joinedAt: e.joinedAt,
        predicted: e.estimatedWaitMinutes,
        actual: e.waitTimeInMinutes,
        error: e.estimatedWaitMinutes - e.waitTimeInMinutes,
      }));
    if (accuracy.n > 0 && accuracy.n < 30) {
      warnings.push(`Forecast accuracy is based on only ${accuracy.n} completed ticket(s); validate with real clinic data before drawing conclusions.`);
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      data: {
        clinicId: String(clinicId),
        before: { source: 'manual timed observations', waitMinutes: beforeWait, serviceMinutes: summarize(before.map((b) => b.serviceMinutes)) },
        after: {
          source: 'completed HealthQueue+ queue entries',
          waitMinutes: afterWait,
          serviceMinutes: summarize(after.map((a) => a.serviceTimeInMinutes)),
          remoteJoiners: remoteWait,
          walkIns: walkInWait,
        },
        change,
        forecastAccuracy: accuracy,
        warnings,
      },
    });
  } catch (err) {
    console.error('getEffectiveness error:', err);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to compute effectiveness.' });
  }
};

module.exports = {
  addBaseline, getEffectiveness,
  _summarize: summarize, _forecastAccuracy: forecastAccuracy, _baselineAccuracy: baselineAccuracy,
};
