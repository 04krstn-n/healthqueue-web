/**
 * Chatbot Controller — Patient-facing AI Chatbot & Staff Escalation
 * Multi-tier Engine: RASA AI -> OpenAI (GPT-4o-mini) -> Keyword FAQ
 */
const axios = require('axios');
const OpenAI = require('openai');
const FAQ = require('../models/FAQ');
const ChatLog = require('../models/ChatLog');
const QueueEntry = require('../models/QueueEntry');
const Appointment = require('../models/Appointment');
const { HttpStatus, OPENAI_API_KEY, RASA_SERVER_URL } = require('../config/config');
const { logAction } = require('../utils/auditLog');

let openaiClient = null;
if (OPENAI_API_KEY) {
  openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
}

/**
 * A patient's User record has no clinicId of its own — that field is only
 * used for facility_admin/staff. So when the chat widget doesn't explicitly
 * pass a clinicId, fall back to whichever clinic the patient has already
 * selected: their most recent active queue entry, then their most recent
 * upcoming/active appointment. This is what lets an escalation actually
 * reach that clinic's staff instead of landing as clinicId: null.
 */
async function resolvePatientClinicId(patientId) {
  if (!patientId) return null;

  const activeQueueEntry = await QueueEntry.findOne({
    patient: patientId,
    status: { $in: ['Waiting', 'Serving'] },
  })
    .sort({ createdAt: -1 })
    .select('clinic');
  if (activeQueueEntry?.clinic) return activeQueueEntry.clinic;

  const activeAppointment = await Appointment.findOne({
    patient: patientId,
    status: { $in: ['pending', 'confirmed', 'arrived', 'serving'] },
  })
    .sort({ appointmentDate: -1 })
    .select('clinic');
  if (activeAppointment?.clinic) return activeAppointment.clinic;

  return null;
}

/**
 * Notify staff/facility_admin of an escalation — scoped to the clinic's
 * Socket.io room (see server.js `join_clinic`) instead of a blanket
 * io.emit(), which was broadcasting every clinic's escalations to every
 * connected client regardless of which clinic they belonged to.
 */
function emitEscalation(req, clinicId, payload) {
  const io = req.app.get('io');
  if (!io) return;
  if (clinicId) {
    io.to(`clinic_${clinicId}`).emit('chat_escalated', payload);
  }
  // super_admin dashboards aren't scoped to a single clinic room, so they
  // still get a global heads-up alongside the clinic-scoped one.
  io.emit('global_chat_escalated', { ...payload, clinicId });
}

// ── FAQ Keyword Match Fallback ───────────────────────────────────────────────
async function faqMatch(message) {
  const msg = message.toLowerCase().trim();
  const faqs = await FAQ.find({ isActive: true });
  let bestMatch = null;
  let bestScore = 0;

  for (const faq of faqs) {
    let score = 0;
    for (const kw of faq.keywords || []) {
      if (msg.includes(kw.toLowerCase())) score += 3;
    }
    const qWords = faq.question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const w of qWords) {
      if (msg.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = faq;
    }
  }

  if (bestMatch && bestScore >= 2) {
    await FAQ.findByIdAndUpdate(bestMatch._id, { $inc: { usageCount: 1 } });
    return bestMatch.answer;
  }
  return null;
}

// ── OpenAI with FAQ Knowledge Context ────────────────────────────────────────
async function openAiResponse(message, faqs) {
  const faqContext = faqs
    .slice(0, 30)
    .map((f, i) => `Q${i + 1}: ${f.question}\nA${i + 1}: ${f.answer}`)
    .join('\n\n');

  const systemPrompt = `You are HQ Assistant, the AI concierge for HealthQueue+ in the Philippines.
Your role:
- Assist patients with clinic services, queueing rules, and consultation inquiries.
- Be concise and warm (1-3 sentences max).
- Direct medical diagnostic questions to human medical professionals[cite: 1].

FAQ Knowledge Base:
---
${faqContext}
---

If the user seems frustrated or requires staff intervention, append "[ESCALATE]" at the end of your response[cite: 1].`;

  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    temperature: 0.4,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message.trim() },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || null;
}

// POST /api/chatbot/message — Main chatbot entry point
const handleMessage = async (req, res) => {
  try {
    const { message, patientId, clinicId } = req.body;
    if (!message || !message.trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Message is required.' });
    }

    let reply = null;
    let source = 'faq';
    let autoEscalate = false;

    // 1. Tier 1: RASA AI Server
    if (RASA_SERVER_URL) {
      try {
        const rasaRes = await axios.post(`${RASA_SERVER_URL}/webhooks/rest/webhook`, {
          sender: patientId || req.user?._id || 'anonymous',
          message: message.trim(),
        }, { timeout: 4000 });

        if (Array.isArray(rasaRes.data) && rasaRes.data.length > 0) {
          reply = rasaRes.data.map((m) => m.text).filter(Boolean).join('\n');
          source = 'rasa';
        }
      } catch (err) {
        console.warn('[Chatbot] RASA unavailable, shifting to OpenAI/FAQ fallback.');
      }
    }

    // 2. Tier 2: OpenAI GPT-4o-mini
    if (!reply && openaiClient) {
      try {
        const faqs = await FAQ.find({ isActive: true }).lean();
        reply = await openAiResponse(message, faqs);
        source = 'openai';

        if (reply && reply.includes('[ESCALATE]')) {
          autoEscalate = true;
          reply = reply.replace('[ESCALATE]', '').trim();
        }
      } catch (err) {
        console.warn('[Chatbot] OpenAI failed, reverting to keyword FAQ.');
      }
    }

    // 3. Tier 3: Keyword Matching FAQ
    if (!reply) {
      reply = await faqMatch(message);
      source = 'faq';
    }

    // Default Fallback
    if (!reply) {
      reply = "I'm sorry, I couldn't find an answer to that. Please speak with reception or request staff assistance[cite: 1].";
      autoEscalate = true;
    }

    // If the widget didn't tell us which clinic this is for, fall back to
    // whichever clinic the patient has already selected (active queue entry
    // or appointment) so the log — and any escalation — actually reaches
    // that clinic's staff instead of sitting unassigned.
    const resolvedClinicId =
      clinicId || req.user?.clinicId || (await resolvePatientClinicId(req.user?._id || patientId));

    // Record Chat Log & Escalation
    const log = await ChatLog.create({
      patient: req.user?._id || patientId || null,
      senderId: patientId || req.user?._id?.toString() || 'anonymous',
      message: message.trim(),
      reply,
      response: reply,
      isFallback: source === 'faq',
      source,
      isEscalated: autoEscalate,
      escalatedAt: autoEscalate ? new Date() : null,
      clinicId: resolvedClinicId || null,
    });

    if (autoEscalate) {
      emitEscalation(req, resolvedClinicId, { logId: log._id, message: log.message });
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      response: reply,
      source,
      isEscalated: autoEscalate,
      logId: log._id,
    });
  } catch (err) {
    console.error('handleMessage Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Chatbot error.' });
  }
};

// POST /api/chatbot/escalate — Manual patient escalation request
const escalateToStaff = async (req, res) => {
  try {
    const { logId, note, clinicId } = req.body;
    if (!logId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'logId is required.' });
    }

    const existingLog = await ChatLog.findById(logId);
    if (!existingLog) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Chat log record not found.' });
    }

    // Same fallback as handleMessage: prefer an explicit clinicId, then
    // whatever the log already has, then the patient's active queue
    // entry/appointment — so a manual "talk to staff" tap still reaches the
    // right clinic even if the original message was logged before the
    // patient had a clinic selected.
    const resolvedClinicId =
      clinicId ||
      existingLog.clinicId ||
      req.user?.clinicId ||
      (await resolvePatientClinicId(req.user?._id || existingLog.patient));

    const log = await ChatLog.findByIdAndUpdate(
      logId,
      {
        isEscalated: true,
        escalatedAt: new Date(),
        escalationNote: note || '',
        clinicId: resolvedClinicId || null,
      },
      { new: true }
    );

    emitEscalation(req, resolvedClinicId, { logId: log._id, message: log.message, note });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Escalated to staff successfully.', log });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to escalate chat.' });
  }
};

// PUT /api/chatbot/resolve/:id — Staff marks escalation resolved
const resolveEscalation = async (req, res) => {
  try {
    const { note } = req.body;
    const log = await ChatLog.findByIdAndUpdate(
      req.params.id,
      { 
        resolvedByStaff: true, 
        resolvedAt: new Date(), 
        resolvedNote: note || '',
        escalatedToStaff: req.user?._id || null 
      },
      { new: true }
    );

    if (!log) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Chat log not found.' });
    }

    // Let other staff devices viewing this list know it was resolved, so
    // it drops out of "Needs Attention" everywhere, not just this device.
    emitEscalation(req, log.clinicId, { logId: log._id, resolved: true });

    await logAction({
      actor: req.user,
      action: 'resolve',
      targetType: 'ChatLog',
      targetId: log._id,
      targetLabel: (log.message || '').slice(0, 80),
      clinicId: log.clinicId,
      details: { note: note || '' },
    });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Escalation resolved.', log });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to resolve escalation.' });
  }
};

module.exports = { handleMessage, escalateToStaff, resolveEscalation };