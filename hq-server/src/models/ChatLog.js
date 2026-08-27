/**
 * ChatLog model — stores chatbot conversation history
 * Also used for patient escalation requests to staff.
 */
const mongoose = require('mongoose');

const ChatLogSchema = new mongoose.Schema(
  {
    patient:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    senderId:    { type: String, default: 'anonymous' },
    message:     { type: String, required: true, trim: true },
    
    // The chatbot's reply
    reply:       { type: String, default: '' },
    response:    { type: String, default: '' }, // Duplicate alias for frontend compatibility
    intent:      { type: String, default: null }, // RASA intent
    confidence:  { type: Number, default: 0 },
    
    isFallback:  { type: Boolean, default: false },
    source:      { type: String, enum: ['rasa', 'openai', 'faq', 'staff'], default: 'faq' },
    
    // Escalation to staff
    isEscalated:     { type: Boolean, default: false, index: true },
    escalatedAt:     { type: Date,    default: null },
    escalationNote:  { type: String,  default: '' },
    escalatedToStaff:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    
    resolvedByStaff: { type: Boolean, default: false },
    resolvedAt:      { type: Date,    default: null },
    resolvedNote:    { type: String,  default: '' },
    clinicId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
  },
  { timestamps: true }
);

// 7-day retention: conversations older than this are no longer useful for
// the patient to review and would otherwise accumulate forever (there was
// previously no expiry/cleanup at all). MongoDB's TTL monitor deletes
// expired documents in the background (usually within ~60s of expiry, not
// necessarily instantly) — see getMyChatHistory in chatbotController for
// the matching application-level cutoff, so a slightly-stale document
// never appears in a patient's own history even if TTL cleanup lags.
ChatLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('ChatLog', ChatLogSchema);