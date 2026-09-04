/**
 * Chatbot Admin Controller — manage FAQs, chat logs, escalations, Rasa health status, and test pipeline
 */
const FAQ = require('../models/FAQ');
const ChatLog = require('../models/ChatLog');
const { HttpStatus, RASA_SERVER_URL, OPENAI_API_KEY } = require('../config/config');
const { logAction } = require('../utils/auditLog');

// ── FAQs ──────────────────────────────────────────────────────────────────────
const getFAQs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.active === 'true') filter.isActive = true;
    const faqs = await FAQ.find(filter).sort({ category: 1, createdAt: -1 });
    return res.status(HttpStatus.OK).json({ success: true, data: faqs });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch FAQs.' });
  }
};

const createFAQ = async (req, res) => {
  try {
    const { question, answer, category, keywords, isActive } = req.body;
    if (!question || !answer) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Question and answer are required.' });
    }

    // Normalize keywords
    const kws = Array.isArray(keywords)
      ? keywords.map(k => k.trim().toLowerCase()).filter(Boolean)
      : typeof keywords === 'string'
        ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
        : [];

    const faq = await FAQ.create({
      question: question.trim(),
      answer: answer.trim(),
      category: category || 'General Info',
      keywords: kws,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.user._id,
    });

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'FAQ',
      targetId: faq._id,
      targetLabel: faq.question,
      details: { category: faq.category },
    });

    return res.status(HttpStatus.CREATED).json({ success: true, data: faq });
  } catch (err) {
    console.error('createFAQ error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to create FAQ.' });
  }
};

const updateFAQ = async (req, res) => {
  try {
    const { question, answer, category, keywords, isActive } = req.body;
    const update = {};
    if (question !== undefined) update.question = question.trim();
    if (answer !== undefined) update.answer = answer.trim();
    if (category !== undefined) update.category = category;
    if (isActive !== undefined) update.isActive = isActive;
    if (keywords !== undefined) {
      update.keywords = Array.isArray(keywords)
        ? keywords.map(k => k.trim().toLowerCase()).filter(Boolean)
        : typeof keywords === 'string'
          ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
          : [];
    }
    const faq = await FAQ.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!faq) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'FAQ not found.' });

    await logAction({
      actor: req.user,
      action: 'update',
      targetType: 'FAQ',
      targetId: faq._id,
      targetLabel: faq.question,
      details: update,
    });

    return res.status(HttpStatus.OK).json({ success: true, data: faq });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to update FAQ.' });
  }
};

const deleteFAQ = async (req, res) => {
  try {
    const faq = await FAQ.findByIdAndDelete(req.params.id);
    if (!faq) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'FAQ not found.' });

    await logAction({
      actor: req.user,
      action: 'delete',
      targetType: 'FAQ',
      targetId: req.params.id,
      targetLabel: faq.question,
    });

    return res.status(HttpStatus.OK).json({ success: true, message: 'FAQ deleted.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to delete FAQ.' });
  }
};

// ── Chat Logs ─────────────────────────────────────────────────────────────────
const getChatLogs = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    // This used to fetch ALL clinics' chat logs unfiltered — staff would
    // either see other clinics' patient conversations mixed in, or (with a
    // client-side clinic filter applied afterward) end up with nothing
    // matching their own clinic depending on ordering/limit. Scope it the
    // same way getEscalatedLogs() already does.
    const filter = {};
    // Patients' User accounts don't carry a clinicId, so a chat log only
    // gets one if the patient app explicitly sent it — many legitimate
    // logs have clinicId: null. A strict equality filter would silently
    // hide those, which is very likely the actual cause of "staff not
    // receiving logs" — so unassigned logs are included alongside the
    // staff's own clinic instead of being excluded.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.$or = [{ clinicId: req.user.clinicId }, { clinicId: null }];
    } else if (req.query.clinicId) {
      filter.$or = [{ clinicId: req.query.clinicId }, { clinicId: null }];
    }
    const logs = await ChatLog.find(filter)
      .populate('patient', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.status(HttpStatus.OK).json({ success: true, data: logs });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch chat logs.' });
  }
};

// ── Analytics ─────────────────────────────────────────────────────────────────
const getAnalytics = async (req, res) => {
  try {
    const totalFAQs = await FAQ.countDocuments();
    const activeFAQs = await FAQ.countDocuments({ isActive: true });
    const totalLogs = await ChatLog.countDocuments();
    const topFAQs = await FAQ.find({ isActive: true })
      .sort({ usageCount: -1 })
      .limit(5)
      .select('question usageCount category');
    return res.status(HttpStatus.OK).json({
      success: true,
      data: { totalFAQs, activeFAQs, totalLogs, topFAQs },
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch analytics.' });
  }
};

// ── GET /api/chatbot-admin/rasa-status ────────────────────────────────────────
const getRasaStatus = async (req, res) => {
  let rasaOnline = false;
  let rasaVersion = null;

  if (RASA_SERVER_URL) {
    try {
      const axios = require('axios');
      const r = await axios.get(`${RASA_SERVER_URL}/`, { timeout: 3000 });
      rasaOnline = true;
      rasaVersion = r.data?.version || r.data?.rasa_version || null;
    } catch (_) {
      rasaOnline = false;
    }
  }

  let activeMode = 'faq';
  if (RASA_SERVER_URL && rasaOnline) activeMode = 'rasa';
  else if (OPENAI_API_KEY) activeMode = 'openai';

  return res.status(HttpStatus.OK).json({
    success: true,
    activeMode,
    layers: {
      rasa: {
        configured: !!RASA_SERVER_URL,
        online: rasaOnline,
        url: RASA_SERVER_URL || null,
        version: rasaVersion,
      },
      openai: {
        configured: !!OPENAI_API_KEY,
        model: 'gpt-4o-mini',
      },
      faq: {
        configured: true,
        active: true,
      },
    },
  });
};

// ── POST /api/chatbot-admin/test ──────────────────────────────────────────────
const testChatbot = async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'message is required.' });

  const axios = require('axios');
  const OpenAI = require('openai');

  let response = null;
  let source = 'faq';

  // Mode 1: Rasa
  if (RASA_SERVER_URL) {
    try {
      const r = await axios.post(`${RASA_SERVER_URL}/webhooks/rest/webhook`, {
        sender: 'admin-test', message: message.trim(),
      }, { timeout: 5000 });
      const msgs = r.data;
      if (Array.isArray(msgs) && msgs.length > 0) {
        response = msgs.map(m => m.text).filter(Boolean).join('\n');
        source = 'rasa';
      }
    } catch (_) {}
  }

  // Mode 2: OpenAI
  if (!response && OPENAI_API_KEY) {
    try {
      const faqs = await FAQ.find({ isActive: true }).lean();
      const faqCtx = faqs.slice(0, 20).map((f, i) =>
        `Q${i + 1}: ${f.question}\nA${i + 1}: ${f.answer}`).join('\n\n');
      const client = new OpenAI({ apiKey: OPENAI_API_KEY });
      const comp = await client.chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: 200, temperature: 0.5,
        messages: [
          { role: 'system', content: `You are HQ Assistant for HealthQueue+. Use this FAQ:\n${faqCtx}` },
          { role: 'user', content: message.trim() },
        ],
      });
      response = comp.choices[0]?.message?.content?.trim() || null;
      source = 'openai';
    } catch (_) {}
  }

  // Mode 3: FAQ keyword
  if (!response) {
    const msg = message.toLowerCase().trim();
    const faqs = await FAQ.find({ isActive: true });
    let best = null, bestScore = 0;
    for (const faq of faqs) {
      let score = 0;
      for (const kw of faq.keywords || []) { if (msg.includes(kw.toLowerCase())) score += 3; }
      const qWords = faq.question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const w of qWords) { if (msg.includes(w)) score += 1; }
      if (score > bestScore) { bestScore = score; best = faq; }
    }
    if (best && bestScore >= 2) { response = best.answer; source = 'faq'; }
  }

  if (!response) {
    response = "I couldn't find an answer to that question.";
    source = 'fallback';
  }

  return res.status(HttpStatus.OK).json({ success: true, response, source });
};

// ── GET /api/chatbot-admin/escalated ──────────────────────────────────────────
const getEscalatedLogs = async (req, res) => {
  try {
    const { resolved } = req.query;
    const filter = { isEscalated: true };
    // Same reasoning as getChatLogs: don't strictly exclude logs with no
    // clinicId — a patient's account isn't clinic-scoped, so this equality
    // filter was very likely hiding real escalations from staff.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.$or = [{ clinicId: req.user.clinicId }, { clinicId: null }];
    } else if (req.query.clinicId) {
      filter.$or = [{ clinicId: req.query.clinicId }, { clinicId: null }];
    }
    if (resolved === 'true') filter.resolvedByStaff = true;
    if (resolved === 'false') filter.resolvedByStaff = false;
    const logs = await ChatLog.find(filter)
      .populate('patient', 'fullName email phone')
      .populate('clinicId', 'name')
      .populate('escalatedToStaff', 'fullName role')
      .sort({ escalatedAt: -1 })
      .limit(100);
    return res.status(HttpStatus.OK).json({ success: true, data: logs });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch escalated logs.' });
  }
};

module.exports = {
  getEscalatedLogs,
  getRasaStatus,
  testChatbot,
  getFAQs,
  createFAQ,
  updateFAQ,
  deleteFAQ,
  getChatLogs,
  getAnalytics,
};