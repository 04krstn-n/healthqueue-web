/**
 * Audit Log Controller — read-only access to recorded admin actions.
 */
const AuditLog = require('../models/AuditLog');

// GET /api/audit-logs
const getAuditLogs = async (req, res) => {
  try {
    const { action, targetType, actor, startDate, endDate, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (req.user.role === 'facility_admin') {
      filter.clinicId = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinicId = req.query.clinicId;
    }

    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;
    if (actor) filter.actor = actor;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('clinicId', 'name'),
      AuditLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: logs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to get audit logs.' });
  }
};

module.exports = { getAuditLogs };