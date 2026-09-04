/**
 * ChatSession model — one document per patient, tracking whether their
 * chatbot conversation is currently bot-driven or has been handed off to
 * a staff member for a live back-and-forth.
 *
 * This is what makes escalation an actual handoff instead of a one-time
 * flag: while mode is 'staff', handleMessage() skips the RASA/OpenAI/FAQ
 * tiers entirely for this patient's messages (see chatbotController.js) —
 * they get relayed to staff instead of the bot trying to auto-answer over
 * an active human conversation.
 */
const mongoose = require('mongoose');

const ChatSessionSchema = new mongoose.Schema(
  {
    patient:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    clinicId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
    mode:           { type: String, enum: ['bot', 'staff'], default: 'bot' },
    assignedStaff:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The ChatLog that originally triggered the handoff — lets staff jump
    // straight to the message that started this (resolveEscalation still
    // takes a ChatLog id, so this ties the two together).
    activeChatLogId:{ type: mongoose.Schema.Types.ObjectId, ref: 'ChatLog', default: null },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChatSession', ChatSessionSchema);
