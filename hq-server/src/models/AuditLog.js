/**
 * AuditLog model — tracks admin actions across the system for accountability.
 */
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },

    action: {
      type: String,
      required: true,
      enum: ['create', 'update', 'deactivate', 'reactivate', 'delete', 'login'],
      index: true,
    },

    targetType: { type: String, required: true, index: true }, // e.g. 'User', 'Staff', 'Clinic'
    targetId: { type: mongoose.Schema.Types.ObjectId, index: true },
    targetLabel: { type: String, default: '' }, // denormalized display name, e.g. staff full name

    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },

    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuditLog', AuditLogSchema);