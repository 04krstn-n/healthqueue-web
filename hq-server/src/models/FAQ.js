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
    // null = a global/shared FAQ, visible to every clinic's patients
    // (e.g. "what is HealthQueue+"). A specific clinic ID = only shown to
    // that clinic's patients and only editable by that clinic's own
    // facility_admin/staff — different clinics legitimately have
    // different FAQs (different services, hours, walk-in policies), so
    // this was never meant to be one shared pool. See chatbotController's
    // faqMatch/openAiResponse callers and chatbotAdminController's
    // getFAQs/createFAQ/updateFAQ/deleteFAQ for how this is enforced.
    clinic:     { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FAQ', FAQSchema);