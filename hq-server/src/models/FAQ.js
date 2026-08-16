/**
 * FAQ model — Chatbot Knowledge Base
 */
const mongoose = require('mongoose');

const FAQSchema = new mongoose.Schema(
  {
    question:   { type: String, required: true, trim: true },
    answer:     { type: String, required: true, trim: true },
    category:   { type: String, default: 'General Info', trim: true },
    keywords:   { type: [String], default: [], index: true }, // Fast keyword matching
    usageCount: { type: Number,  default: 0 },
    isActive:   { type: Boolean, default: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FAQ', FAQSchema);