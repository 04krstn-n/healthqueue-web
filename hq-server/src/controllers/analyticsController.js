/**
 * Analytics Controller — OpenAI-powered Prescriptive Insights & Forecasting
 * Facility Admin & Super Admin Access
 *
 * GET /api/analytics/ai-insights?clinicId=xxx
 * Flow:
 *  1. Aggregate metrics from MongoDB
 *  2. Light linear forecasting (7-day trend)
 *  3. Rule-based prescriptive checks
 *  4. GPT-4o-mini generates narrative
 *  5. Return { narrative, prescriptions[], forecast, metrics }
 */
const OpenAI = require('openai');
const QueueEntry = require('../models/QueueEntry');
const Appointment = require('../models/Appointment');
const Clinic = require('../models/Clinic');
const InsightsLog = require('../models/InsightsLog');
const mongoose = require('mongoose');
const { HttpStatus, OPENAI_API_KEY } = require('../config/config');

const toId = (id) => new mongoose.Types.ObjectId(String(id));

const todayRange = () => {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(); e.setHours(23, 59, 59, 999);
  return { $gte: s, $lte: e };
};

// ── Light linear forecast (least-squares) ────────────────────────────────────
function linearForecast(series) {
  const n = series.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  series.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const next = Math.max(0, Math.round(slope * n + intercept));
  const trend = slope > 0.5 ? 'increasing' : slope < -0.5 ? 'decreasing' : 'stable';
  return { slope: Math.round(slope * 10) / 10, next, trend };
}

// ── Rule-based prescriptive checks ───────────────────────────────────────────
function prescriptiveRules({ avgWaitTime, completionRate, activeQueue, todayPatients, peakHour, topService, forecast }) {
  const rules = [];

  if (avgWaitTime > 45) {
    rules.push({
      severity: 'high', code: 'WAIT_CRITICAL',
      finding: `Average wait time is ${avgWaitTime} min (threshold: 45 min)`,
      action: 'Open an additional service window or redirect patients to less busy services.'
    });
  } else if (avgWaitTime > 30) {
    rules.push({
      severity: 'medium', code: 'WAIT_ELEVATED',
      finding: `Average wait time is ${avgWaitTime} min (threshold: 30 min)`,
      action: 'Monitor closely. Consider staggering appointment slots.'
    });
  }

  if (completionRate < 60 && todayPatients > 0) {
    rules.push({
      severity: 'high', code: 'COMPLETION_LOW',
      finding: `Completion rate is ${completionRate}% — below 60% target`,
      action: 'Identify bottlenecks in service flow. Check for no-shows or staffing gaps.'
    });
  } else if (completionRate < 85 && todayPatients > 0) {
    rules.push({
      severity: 'medium', code: 'COMPLETION_MODERATE',
      finding: `Completion rate is ${completionRate}% — below ideal 85%`,
      action: 'Review queue-to-service conversion and patient no-show patterns.'
    });
  }

  if (activeQueue >= 15) {
    rules.push({
      severity: 'high', code: 'QUEUE_OVERLOAD',
      finding: `${activeQueue} patients currently waiting or being served`,
      action: 'Activate surge protocols. Alert available staff to expedite service.'
    });
  } else if (activeQueue >= 8) {
    rules.push({
      severity: 'medium', code: 'QUEUE_ELEVATED',
      finding: `${activeQueue} patients in active queue`,
      action: 'Monitor queue progress. Consider walk-in restrictions if volume increases.'
    });
  }

  if (forecast?.trend === 'increasing' && forecast.slope > 1) {
    rules.push({
      severity: 'medium', code: 'VOLUME_TRENDING_UP',
      finding: `Patient volume trending up (+${forecast.slope}/day). Forecast: ${forecast.next} patients tomorrow`,
      action: 'Schedule additional staff for upcoming days. Pre-stock high-demand supplies.'
    });
  } else if (forecast?.trend === 'decreasing' && forecast.slope < -1) {
    rules.push({
      severity: 'low', code: 'VOLUME_TRENDING_DOWN',
      finding: `Patient volume is declining (${forecast.slope}/day)`,
      action: 'Good time for staff training, equipment maintenance, or schedule reviews.'
    });
  }

  if (peakHour) {
    rules.push({
      severity: 'info', code: 'PEAK_HOUR',
      finding: `Peak patient traffic observed at ${peakHour}`,
      action: `Ensure full staffing coverage during ${peakHour} shift.`
    });
  }

  if (topService) {
    rules.push({
      severity: 'info', code: 'TOP_SERVICE',
      finding: `Most requested service: ${topService.name} (${topService.count} patients)`,
      action: `Prioritize ${topService.name} equipment readiness and staff assignment.`
    });
  }

  return rules;
}

// ── OpenAI narrative generation ───────────────────────────────────────────────
async function generateNarrative(metrics, rules, forecast, clinicName, openaiClient) {
  const rulesText = rules.map(r => `[${r.severity.toUpperCase()}] ${r.finding} → ${r.action}`).join('\n');

  const prompt = `You are a healthcare operations analyst for ${clinicName}, a private health clinic in the Philippines.

Based on today's operational data and rule-based analysis, write a concise prescriptive analytics report.

## Today's Metrics
- Patients registered today: ${metrics.todayPatients}
- Currently in queue: ${metrics.activeQueue}
- Completed visits: ${metrics.completedToday}
- Average wait time (AWT): ${metrics.avgWaitTime} min
- Completion rate: ${metrics.completionRate}%
- Peak hour: ${metrics.peakHour || 'Not yet determined'}
- Most requested service: ${metrics.topService?.name || 'N/A'} (${metrics.topService?.count || 0} patients)
- 7-day total patients: ${metrics.weeklyTotal}
- Tomorrow's forecast: ~${forecast?.next ?? 'N/A'} patients (trend: ${forecast?.trend ?? 'unknown'})

## Rule-Based Findings
${rulesText || 'No critical issues detected.'}

Write in 3 short paragraphs:
1. Current situation summary (2-3 sentences)
2. Key risks or opportunities identified (2-3 sentences)
3. Top 2-3 specific actions the facility admin should take today

Be specific, data-driven, and actionable. Do NOT use generic advice. Keep total response under 200 words.`;

  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    temperature: 0.4,
    messages: [{ role: 'user', content: prompt }],
  });

  return completion.choices[0]?.message?.content?.trim() || null;
}

// ── GET /api/analytics/ai-insights?clinicId=xxx ──────────────────────────────
const getAiInsights = async (req, res) => {
  try {
    const clinicId = req.query.clinicId || req.user?.clinicId;
    if (!clinicId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'clinicId is required.' });
    }

    if (!OPENAI_API_KEY) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'OpenAI API key is not configured.' });
    }

    const cid = toId(clinicId);
    const clinic = await Clinic.findById(cid).lean();
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }

    // ── 1. Gather Metrics (CAPSTONE RULE: EXCLUDE CANCELLED VISIT COUNTS) ────
    const [todayPatients, activeQueue, completedToday, todayAppointments] = await Promise.all([
      QueueEntry.countDocuments({ clinic: cid, joinedAt: todayRange(), status: { $ne: 'cancelled' } }),
      QueueEntry.countDocuments({ clinic: cid, status: { $in: ['waiting', 'serving', 'called'] } }),
      QueueEntry.countDocuments({ clinic: cid, joinedAt: todayRange(), status: { $in: ['done', 'completed'] } }),
      Appointment.countDocuments({ clinic: cid, appointmentDate: todayRange(), status: { $ne: 'cancelled' } }),
    ]);

    // Compute actual Average Wait Time (AWT) from completed entries
    const waitAgg = await QueueEntry.aggregate([
      { 
        $match: { 
          clinic: cid, 
          joinedAt: todayRange(), 
          status: { $in: ['done', 'completed'] },
          waitTimeInMinutes: { $gt: 0 } 
        } 
      },
      { $group: { _id: null, avg: { $avg: '$waitTimeInMinutes' } } },
    ]);

    const avgWaitTime = Math.round(waitAgg[0]?.avg ?? clinic.currentWaitingTime ?? 15);
    const completionRate = todayPatients > 0 ? Math.round((completedToday / todayPatients) * 100) : 0;

    // 7-day historical volume series (excluding cancelled)
    const weekSeries = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const e = new Date(d); e.setHours(23, 59, 59, 999);
      const c = await QueueEntry.countDocuments({ 
        clinic: cid, 
        joinedAt: { $gte: d, $lte: e },
        status: { $ne: 'cancelled' }
      });
      weekSeries.push(c);
    }
    const weeklyTotal = weekSeries.reduce((s, v) => s + v, 0);

    // Peak Hour calculation
    const hourlyAgg = await QueueEntry.aggregate([
      { $match: { clinic: cid, joinedAt: todayRange(), status: { $ne: 'cancelled' } } },
      { $group: { _id: { $hour: { date: '$joinedAt', timezone: 'Asia/Manila' } }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);
    const peakHour = hourlyAgg.length > 0
      ? `${hourlyAgg[0]._id % 12 || 12}:00 ${hourlyAgg[0]._id < 12 ? 'AM' : 'PM'}` : null;

    // Top Service requested
    const svcAgg = await QueueEntry.aggregate([
      { $match: { clinic: cid, joinedAt: todayRange(), serviceName: { $exists: true, $ne: '' } } },
      { $group: { _id: '$serviceName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);
    const topService = svcAgg.length > 0 ? { name: svcAgg[0]._id, count: svcAgg[0].count } : null;

    // ── 2. Forecasting & Rules ──────────────────────────────────────────
    const forecast = linearForecast(weekSeries);
    const metrics = {
      todayPatients, activeQueue, completedToday, todayAppointments,
      avgWaitTime, completionRate, peakHour, topService,
      weeklyTotal, weekSeries,
    };
    const rules = prescriptiveRules({ ...metrics, forecast });

    // ── 3. OpenAI Narrative Generation ─────────────────────────────────
    const openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
    let narrative = null;
    try {
      narrative = await generateNarrative(metrics, rules, forecast, clinic.name, openaiClient);
    } catch (err) {
      console.warn('[analytics] OpenAI narrative failed:', err.message);
    }

    // ── 4. Save to InsightsLog (Required for Thesis Quality Evaluation) ─
    if (req.user) {
      await InsightsLog.create({
        patient: req.user._id,
        patientLocation: { latitude: clinic.latitude || 0, longitude: clinic.longitude || 0 },
        recommendedClinic: cid,
        recommendationType: 'balanced',
        aiExplanation: narrative || 'Operational metrics aggregated successfully.',
        evaluatedClinics: [{
          clinic: cid,
          estimatedWaitMinutes: avgWaitTime,
          activeQueueCount: activeQueue,
        }],
      }).catch((e) => console.warn('[analytics] InsightsLog save skipped:', e.message));
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      clinicName: clinic.name,
      generatedAt: new Date().toISOString(),
      narrative,
      prescriptions: rules,
      forecast: forecast ? {
        trend: forecast.trend,
        slope: forecast.slope,
        tomorrow: forecast.next,
        series: weekSeries,
      } : null,
      metrics: {
        todayPatients, activeQueue, completedToday,
        todayAppointments, avgWaitTime, completionRate,
        peakHour, topService, weeklyTotal,
      },
    });
  } catch (err) {
    console.error('[analytics] ai-insights error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to generate prescriptive insights.',
    });
  }
};

module.exports = { getAiInsights };