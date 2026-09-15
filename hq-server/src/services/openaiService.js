/**
 * OpenAI Service — Generates prescriptive insights and traffic summaries
 */
const OpenAI = require('openai');
const { OPENAI_API_KEY } = require('../config/config');

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

/**
 * Generates natural language recommendation for clinic redirection
 */
const generatePrescriptiveInsight = async (patientCoords, candidateClinics) => {
  if (!OPENAI_API_KEY) {
    // Fallback if API key is missing
    const best = candidateClinics[0];
    return `We recommend ${best.name} as it currently has the shortest estimated wait time (${best.avgWaitMinutes} mins).`;
  }

  try {
    const prompt = `
      You are the AI decision-support engine for HealthQueue+.
      A patient is looking for the best private clinic option.
      Patient location coordinates: (${patientCoords.latitude}, ${patientCoords.longitude}).
      
      Evaluated Clinics:
      ${JSON.stringify(candidateClinics, null, 2)}
      
      Provide a concise, patient-friendly recommendation (2-3 sentences max) explaining which clinic they should choose based on lowest expected wait time and proximity.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a healthcare queue optimization assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Prescriptive Insight Error:', error.message);
    const best = candidateClinics[0];
    return `Based on current queue traffic, ${best.name} is your best option with an estimated wait time of ${best.avgWaitMinutes} minutes.`;
  }
};

/**
 * Generates a patient-facing "best time to visit" recommendation from
 * ALREADY-COMPUTED historical data (see prescriptiveController.getBestTimeToQueue) —
 * this only writes the sentence; it never invents the underlying numbers.
 * Returns null (not a hardcoded fallback string) on missing key or API
 * failure — the caller already has a real, data-driven template
 * recommendation to fall back to, which is more honest than a generic
 * "9-11 AM" line that might not even be true for this clinic.
 */
const generatePeakHoursSummary = async ({ clinicName, hourlyData, weeklyData, servicesData, peakBucket, quietHour }) => {
  if (!OPENAI_API_KEY) return null;

  try {
    const busiestDay = weeklyData?.length
      ? weeklyData.reduce((best, d) => (d.count > (best?.count || 0) ? d : best), null)
      : null;
    const quietestDay = weeklyData?.length
      ? weeklyData.filter((d) => d.count > 0).reduce((best, d) => (d.count < (best?.count ?? Infinity) ? d : best), null)
      : null;
    const topLoadedService = servicesData?.find((s) => s.load === 'High');

    const prompt = `You are a friendly assistant for ${clinicName}, a private health clinic in the Philippines.

Using ONLY the data below, write a short, patient-friendly recommendation for the best time to visit this clinic.

- Busiest hour: ${peakBucket?.label || 'not enough data'} (${peakBucket?.count ?? 0} patients, ~${peakBucket?.avgWait ?? 0} min avg wait)
- Quietest hour: ${quietHour?.label || 'not enough data'} (${quietHour?.count ?? 0} patients, ~${quietHour?.avgWait ?? 0} min avg wait)
- Busiest day: ${busiestDay?.label || 'not enough data'} (${busiestDay?.count ?? 0} patients)
- Quietest day: ${quietestDay?.label || 'not enough data'} (${quietestDay?.count ?? 0} patients)
- Busiest service: ${topLoadedService ? `${topLoadedService.name} (${topLoadedService.count} patients, ~${topLoadedService.avgWait} min avg wait)` : 'none flagged as high-load'}

Write 2-3 sentences, plain conversational language, no bullet points, no headers. State ONLY what the data above supports — do not invent a day, hour, or service that isn't listed. If a field says "not enough data", don't mention it at all rather than guessing.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150,
    });

    return response.choices[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('OpenAI Peak Hours Error:', error.message);
    return null;
  }
};

/**
 * ─── Light forecasting: reliability read on the 7-day trend ────────────────
 * Consumes the ALREADY-COMPUTED linear-regression forecast (see
 * analyticsController.linearForecast — slope/intercept least-squares over
 * the last 7 days) and judges whether that trend is a real, actionable
 * pattern or just normal day-to-day noise given how little/inconsistent the
 * underlying data is. This is deliberately NOT a second forecasting engine —
 * it never sees raw QueueEntry records and is explicitly instructed not to
 * restate or adjust the trend/slope/next-day numbers it's given, only to
 * judge them. That judgment (a confidence label a plain slope can't express
 * on its own) is the "light forecasting" contribution of the pre-trained
 * model, layered on top of the deterministic math rather than replacing it.
 *
 * Always returns a usable result, even with no OpenAI key or on API
 * failure — a heuristic fallback keeps the "confidence" field meaningful
 * (and the calculation transparent/auditable) with zero AI involvement, so
 * this degrades gracefully exactly like the rest of this file's functions.
 */
const assessForecastReliability = async ({ weekSeries = [], trend, slope, next, clinicName }) => {
  const sampleTotal = weekSeries.reduce((s, v) => s + v, 0);
  const nonZeroDays = weekSeries.filter((v) => v > 0).length;

  const heuristicConfidence =
    nonZeroDays >= 5 && sampleTotal >= 20 ? 'high' :
    nonZeroDays >= 3 && sampleTotal >= 8 ? 'moderate' : 'low';
  const heuristicNote = heuristicConfidence === 'low'
    ? 'Not enough recent history yet to trust this trend — treat it as a rough signal only.'
    : `Based on ${nonZeroDays} active day(s) this week (${sampleTotal} patients total).`;

  if (!OPENAI_API_KEY) {
    return { confidence: heuristicConfidence, note: heuristicNote, source: 'heuristic' };
  }

  try {
    const prompt = `You are reviewing a 7-day patient volume trend for ${clinicName}, a private clinic in the Philippines.

Daily patient counts (oldest to newest): ${weekSeries.join(', ')}
Linear regression result (already computed — do not change these): trend = "${trend}", slope = ${slope} patients/day, tomorrow's projected count = ${next}

Judge ONLY whether this trend looks like a real, consistent pattern worth acting on, or whether it's likely just normal day-to-day noise given how little or inconsistent the data is. Do NOT restate or alter the numbers above. Respond in exactly this format, nothing else:
CONFIDENCE: <high|moderate|low>
NOTE: <one sentence, plain language, no jargon>`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 80,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';
    const confMatch = text.match(/CONFIDENCE:\s*(high|moderate|low)/i);
    const noteMatch = text.match(/NOTE:\s*(.+)/i);

    return {
      confidence: confMatch ? confMatch[1].toLowerCase() : heuristicConfidence,
      note: noteMatch ? noteMatch[1].trim() : heuristicNote,
      source: 'openai',
    };
  } catch (error) {
    console.error('OpenAI Forecast Reliability Error:', error.message);
    return { confidence: heuristicConfidence, note: heuristicNote, source: 'heuristic-fallback' };
  }
};

module.exports = {
  generatePrescriptiveInsight,
  generatePeakHoursSummary,
  assessForecastReliability,
};