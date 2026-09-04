const express = require('express');
const router = express.Router();

const {
  handleMessage,
  escalateToStaff,
  resolveEscalation,
  getMyChatHistory,
} = require('../controllers/chatbotController');

const {
  protect,
  authorizeRoles,
  patientOnly,
} = require('../middleware/auth');

// Require authentication across all chatbot endpoints
router.use(protect);

// ─── Patient Endpoints ────────────────────────────────────────────────────────
router.post('/message', patientOnly, handleMessage);
router.post('/escalate', patientOnly, escalateToStaff);
router.get('/history', patientOnly, getMyChatHistory);

// ─── Staff / Admin Endpoints ─────────────────────────────────────────────────
router.put(
  '/resolve/:id',
  authorizeRoles('staff', 'facility_admin', 'super_admin'),
  resolveEscalation
);

module.exports = router;