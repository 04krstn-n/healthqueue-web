/**
 * logAction — writes an AuditLog entry.
 * Never throws: a logging failure should never break the calling request.
 */
const AuditLog = require('../models/AuditLog');

async function logAction({ actor, action, targetType, targetId, targetLabel = '', clinicId = null, details = {} }) {
  try {
    if (!actor || !action || !targetType) return;
    await AuditLog.create({
      actor: actor._id || actor,
      actorName: actor.fullName || '',
      actorRole: actor.role || '',
      action,
      targetType,
      targetId,
      targetLabel,
      clinicId: clinicId || actor.clinicId || null,
      details,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAction };