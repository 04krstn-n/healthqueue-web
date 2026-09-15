/**
 * Chatbot Admin Controller — manage FAQs, chat logs, escalations, Rasa health status, and test pipeline
 */
const FAQ = require('../models/FAQ');
const ChatLog = require('../models/ChatLog');
const { HttpStatus, RASA_SERVER_URL, OPENAI_API_KEY } = require('../config/config');
const { logAction } = require('../utils/auditLog');
const { notifyUser } = require('../utils/notify');

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
    // STRICT clinic match — no null-clinic fallback. This used to include
    // { clinicId: null } "so unassigned logs aren't hidden", but that
    // meant every clinic's staff could see every OTHER patient's
    // clinic-less chat (pre-clinic-selection FAQ/bot messages) too —
    // exactly the cross-clinic leak this requirement calls out. The
    // actual fix for "legitimate logs missing a clinicId" belongs at
    // write time (see chatbotController.js's resolvePatientClinicId,
    // which already does its best to attach one) — a facility's staff
    // should simply never see a log with no resolvable clinic; that's
    // not their clinic's concern to begin with. Only super_admin (no
    // req.user.clinicId, no explicit query filter) sees unassigned rows,
    // via the unfiltered `else` fall-through below.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinicId = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinicId = req.query.clinicId;
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
      // Same cold-start reasoning as handleMessage — a short timeout here
      // means this status check itself would report "offline" for a Rasa
      // instance that's merely waking up, which is misleading for staff
      // trying to diagnose whether Rasa is actually configured correctly.
      const r = await axios.get(`${RASA_SERVER_URL}/`, { timeout: 10000 });
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
      }, { timeout: 10000 });
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
    // STRICT clinic match — see getChatLogs' comment for why the old
    // null-clinic fallback was a cross-clinic leak, not a fix. Also worth
    // noting: an ESCALATED log can only exist with a real clinicId in the
    // first place (chatbotController.handleMessage blocks escalation
    // entirely when no clinic can be resolved), so this filter should
    // essentially never even need to exclude anything here in practice.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinicId = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinicId = req.query.clinicId;
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

// DELETE /api/chatbot-admin/logs — Clears chat logs for the staff's clinic.
// STRICT clinicId match only — this used to also delete every clinicId:
// null log system-wide (via an $or fallback), which meant Clinic A
// clearing its own chat history could silently delete Clinic B patients'
// not-yet-clinic-assigned messages too. For a permanent, irreversible
// bulk delete, "might also delete someone else's data" is a much worse
// failure mode than "might leave a few unassigned rows behind" — so this
// errs strict. Restricted to facility_admin/super_admin (not plain
// staff); the tablet UI must still confirm with the user before calling
// this — this endpoint is the actual enforcement, not a substitute for
// that confirmation.
const clearChatLogs = async (req, res) => {
  try {
    const clinicId = req.user.clinicId || req.query.clinicId;
    if (!clinicId) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'No clinic scope — cannot determine which logs to clear.',
      });
    }

    const result = await ChatLog.deleteMany({ clinicId });

    await logAction({
      actor: req.user,
      action: 'clear_chat_logs',
      targetType: 'ChatLog',
      targetId: clinicId,
      targetLabel: `Cleared ${result.deletedCount} chat log(s)`,
      clinicId,
      details: { deletedCount: result.deletedCount },
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      message: `Cleared ${result.deletedCount} chat log(s).`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error('clearChatLogs Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to clear chat logs.' });
  }
};

// ── GET /api/chatbot-admin/threads/:patientId/messages ─────────────────────
// Full conversation history for one patient — every ChatLog row (bot
// replies AND staff replies alike), oldest first. Backs the tablet's
// "Conversation with [patient]" thread dialog (see
// InquiryProvider.loadThread / patient_inquiry_screen.dart's
// _replyDialog). This endpoint — and replyToThread below — simply never
// existed before, even though the ChatLog schema was already designed
// for it (source: 'staff' has been a valid enum value this whole time):
// the tablet's "Reply" button was calling a route that 404'd.
// ── GET /api/chatbot-admin/conversations ────────────────────────────────────
// Groups this clinic's ChatLog rows by patient into ONE row per
// conversation — the data the Messenger-style list needs (last message
// preview, when, unread count, and a conversation-level status) that no
// endpoint previously computed; getChatLogs/getEscalatedLogs both return
// flat per-message rows instead.
//
// Done in application code rather than a Mongo aggregation pipeline: the
// 7-day TTL on ChatLog already bounds how much there ever is to scan (see
// ChatLog.js), so a straightforward fetch + group-in-JS stays fast and is
// far easier to verify/defend than a multi-stage pipeline for what is,
// after all, a "defense-ready MVP" per the project's own scope.
//
// Status per conversation:
//   'escalated' — most recent escalation on this patient is unresolved
//   'resolved'  — most recent escalation on this patient was resolved
//   'open'      — patient has messaged but never escalated (pure bot/FAQ chat)
const getConversations = async (req, res) => {
  try {
    const filter = {};
    // STRICT clinic match — see getChatLogs' comment.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinicId = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinicId = req.query.clinicId;
    }
    // Only conversations that actually have a patient attached — a handful
    // of very old/anonymous rows predate the patient field being required
    // in practice and can't be grouped into anyone's conversation.
    filter.patient = { $ne: null };

    const logs = await ChatLog.find(filter)
      .populate('patient', 'fullName')
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    const byPatient = new Map();
    for (const log of logs) {
      const pid = log.patient?._id?.toString();
      if (!pid) continue;
      if (!byPatient.has(pid)) byPatient.set(pid, []);
      byPatient.get(pid).push(log);
    }

    const conversations = [];
    for (const [patientId, rows] of byPatient) {
      // `logs` is already sorted newest-first, so rows[0] is the latest.
      const latest = rows[0];
      const isStaffRow = latest.source === 'staff';
      const lastMessageText = isStaffRow
        ? (latest.reply || '')
        : (latest.message || latest.reply || '');

      const latestEscalation = rows.find((r) => r.isEscalated);
      const status = !latestEscalation
        ? 'open'
        : latestEscalation.resolvedByStaff
          ? 'resolved'
          : 'escalated';

      const unreadCount = rows.filter(
        (r) => r.source !== 'staff' && (r.message || '').trim() !== '' && !r.readByStaff
      ).length;

      conversations.push({
        patientId,
        patientName: latest.patient?.fullName || 'Patient',
        lastMessage: lastMessageText,
        lastMessageFromStaff: isStaffRow,
        lastMessageAt: latest.createdAt,
        status,
        unreadCount,
        escalationNote: latestEscalation?.escalationNote || '',
        latestLogId: latestEscalation && !latestEscalation.resolvedByStaff ? latestEscalation._id : null,
      });
    }

    conversations.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    return res.status(HttpStatus.OK).json({ success: true, data: conversations });
  } catch (err) {
    console.error('getConversations Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to load conversations.' });
  }
};

// ── PUT /api/chatbot-admin/threads/:patientId/read ──────────────────────────
// Marks every unread patient-authored message in this thread as seen —
// called when staff opens a conversation, so its unread badge clears the
// same way opening a thread in Messenger/WhatsApp does.
const markThreadRead = async (req, res) => {
  try {
    const filter = {
      patient: req.params.patientId,
      source: { $ne: 'staff' },
      readByStaff: false,
    };
    // STRICT clinic match — see getChatLogs' comment.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinicId = req.user.clinicId;
    }
    const result = await ChatLog.updateMany(filter, { readByStaff: true });
    return res.status(HttpStatus.OK).json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error('markThreadRead Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to mark thread as read.' });
  }
};

const getThreadMessages = async (req, res) => {
  try {
    // Was completely unscoped by clinic before this fix — ANY staff
    // account, from ANY clinic, could read ANY patient's full thread just
    // by knowing (or guessing/incrementing) their patientId in the URL.
    // This is the actual endpoint the tablet's conversation panel calls,
    // so this was a real, exploitable cross-clinic read — not just a
    // frontend filtering gap.
    const filter = { patient: req.params.patientId };
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinicId = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinicId = req.query.clinicId;
    }
    // super_admin with neither req.user.clinicId nor an explicit
    // ?clinicId= falls through with no clinic filter at all — intentional
    // global visibility, per "Super Admin may have access to global
    // escalation information where appropriate."

    const logs = await ChatLog.find(filter)
      .sort({ createdAt: 1 })
      .limit(200);
    return res.status(HttpStatus.OK).json({ success: true, data: logs });
  } catch (err) {
    console.error('getThreadMessages Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to load conversation.' });
  }
};

// ── POST /api/chatbot-admin/threads/:patientId/reply ────────────────────────
// Staff sends a live reply directly into the patient's conversation.
// Creates its own ChatLog row (source: 'staff', message: '' since staff
// isn't "asking" anything — matches ThreadMessageModel.fromJson's
// patientText-empty-for-staff-rows expectation on the tablet). Does NOT
// resolve any escalation on its own — that stays a separate, explicit
// "Resolve & Close" action in the tablet UI, so staff can go back and
// forth before actually closing it out.
const replyToThread = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Reply text is required.' });
    }
    const patientId = req.params.patientId;
    const replyText = text.trim();

    // Authorization check — this used to be missing entirely, meaning any
    // staff account could reply to ANY patient (by patientId) regardless
    // of whether that patient had ever interacted with the staff member's
    // clinic. A reply is only allowed if this patient already has at
    // least one conversation on record with THIS staff member's clinic —
    // which also naturally blocks replying to a brand-new/unknown
    // patientId a staff member might try to guess. super_admin (no
    // req.user.clinicId) is exempt, matching the global-visibility
    // pattern used elsewhere in this file.
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      const hasConversation = await ChatLog.exists({
        patient: patientId,
        clinicId: req.user.clinicId,
      });
      if (!hasConversation) {
        return res.status(HttpStatus.FORBIDDEN).json({
          success: false,
          message: 'This patient has no conversation with your clinic.',
        });
      }
    }

    const log = await ChatLog.create({
      patient: patientId,
      senderId: 'staff',
      message: '',
      reply: replyText,
      response: replyText,
      source: 'staff',
      escalatedToStaff: req.user._id,
      clinicId: req.user.clinicId || null,
    });

    const io = req.app.get('io');
    if (io) {
      // Tells any OTHER staff viewing this patient's inbox/thread to
      // refresh (see InquiryProvider.loadInquiries's chat_thread_message
      // listener) — same clinic-room + global-fallback pattern
      // emitEscalation already uses in chatbotController.js.
      const staffPayload = { patientId, logId: log._id };
      if (req.user.clinicId) io.to(`clinic_${req.user.clinicId}`).emit('chat_thread_message', staffPayload);
      io.emit('global_chat_thread_message', staffPayload);

      // Live-updates the patient's OWN chat screen immediately if they
      // currently have it open — separate from the push notification
      // below, which is what reaches them if they don't.
      //
      // Fields must match what AppState's socket listener actually reads
      // (see app_state.dart's `_connectUserSocket` — it branches on
      // `data.containsKey('text') && data.containsKey('staffName')` to
      // recognize this event). This was previously sending `reply`
      // instead of `text`, and never sent `staffName` at all — so that
      // condition was never true and a live-open chat screen silently
      // never showed the staff's reply; the patient would only see it
      // after closing and reopening the chat (which reloads via GET
      // /chatbot/history). `reply` is kept alongside `text` in case any
      // other consumer already relies on that field name.
      io.to(`user_${patientId}`).emit('staff_chat_reply', {
        logId: log._id,
        text: replyText,
        reply: replyText,
        staffName: req.user?.fullName || 'Clinic Staff',
        createdAt: log.createdAt,
      });
    }

    // Actually reaches the patient even if the app is backgrounded/
    // closed — this is the piece that makes "replying" mean something
    // beyond just staff's own view of the conversation.
    await notifyUser(patientId, {
      title: 'New reply from clinic staff',
      message: replyText.length > 80 ? `${replyText.slice(0, 77)}...` : replyText,
      type: 'staff_reply',
      refType: 'ChatLog',
      refId: log._id,
    });

    await logAction({
      actor: req.user,
      action: 'reply',
      targetType: 'ChatLog',
      targetId: log._id,
      targetLabel: 'Replied to patient conversation',
      clinicId: req.user.clinicId,
    });

    return res.status(HttpStatus.OK).json({ success: true, data: log });
  } catch (err) {
    console.error('replyToThread Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to send reply.' });
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
  clearChatLogs,
  getThreadMessages,
  replyToThread,
  getConversations,
  markThreadRead,
};