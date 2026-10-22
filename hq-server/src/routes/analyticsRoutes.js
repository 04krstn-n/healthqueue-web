const express = require('express');
const router = express.Router();
const { getAiInsights } = require('../controllers/analyticsController');
const { addBaseline, getEffectiveness } = require('../controllers/effectivenessController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

// Restricted to facility and system admins
router.get(
  '/ai-insights',
  authorizeRoles('facility_admin', 'super_admin'),
  getAiInsights
);

// Before/after waiting-time comparison (manual baseline vs HealthQueue+ data)
router.post('/baseline', authorizeRoles('facility_admin', 'super_admin'), addBaseline);
router.get('/effectiveness', authorizeRoles('facility_admin', 'super_admin'), getEffectiveness);

module.exports = router;