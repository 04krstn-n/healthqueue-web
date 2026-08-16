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
 * Generates Peak Hours and Traffic Insights
 */
const generatePeakHoursSummary = async (hourlyData) => {
  if (!OPENAI_API_KEY) {
    return 'Peak hours are typically between 9:00 AM and 11:00 AM. Plan your visit after 1:00 PM for shorter wait times.';
  }

  try {
    const prompt = `
      Analyze this daily hourly patient traffic data:
      ${JSON.stringify(hourlyData)}
      
      Identify:
      1. Peak busy window
      2. Best/least crowded window to visit
      3. A 1-sentence tip for patients.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Peak Hours Error:', error.message);
    return 'Traffic is highest in the morning. Visiting between 1:00 PM and 3:00 PM usually results in faster service.';
  }
};

module.exports = {
  generatePrescriptiveInsight,
  generatePeakHoursSummary,
};