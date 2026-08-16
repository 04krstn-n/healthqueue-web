/**
 * Chatbot Controller — Patient-facing AI Chatbot & Staff Escalation
 * Multi-tier Engine: RASA AI -> OpenAI (GPT-4o-mini) -> Keyword FAQ
 */
const axios = require('axios');
const OpenAI = require('openai');
const FAQ = require('../models/FAQ');
const ChatLog = require('../models/ChatLog');
const { HttpStatus, OPENAI_API_KEY, RASA_SERVER_URL } = require('../config/config');

let openaiClient = null;
if (OPENAI_API_KEY) {
  openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
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
      clinicId: clinicId || req.user?.clinicId || null,
    });

    if (autoEscalate) {
      const io = req.app.get('io');
      if (io) io.emit('chat_escalated', { logId: log._id, message: log.message });
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

    const log = await ChatLog.findByIdAndUpdate(
      logId,
      {
        isEscalated: true,
        escalatedAt: new Date(),
        escalationNote: note || '',
        clinicId: clinicId || req.user?.clinicId || null,
      },
      { new: true }
    );

    if (!log) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Chat log record not found.' });
    }

    const io = req.app.get('io');
    if (io) io.emit('chat_escalated', { logId: log._id, note });

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

    return res.status(HttpStatus.OK).json({ success: true, message: 'Escalation resolved.', log });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to resolve escalation.' });
  }
};

module.exports = { handleMessage, escalateToStaff, resolveEscalation };