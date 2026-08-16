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

module.exports = mongoose.model('ChatLog', ChatLogSchema);