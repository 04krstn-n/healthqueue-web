const express = require('express');
const router = express.Router();
const { getAiInsights } = require('../controllers/analyticsController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

// Restricted to facility and system admins
router.get(
  '/ai-insights',
  authorizeRoles('facility_admin', 'super_admin'),
  getAiInsights
);

module.exports = router;