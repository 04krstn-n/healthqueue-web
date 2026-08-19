const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditLogController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

router.route('/').get(authorizeRoles('facility_admin', 'super_admin'), getAuditLogs);

module.exports = router;