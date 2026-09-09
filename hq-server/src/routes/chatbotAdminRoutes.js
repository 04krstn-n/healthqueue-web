const express = require('express');
const router = express.Router();
const {
  getFAQs, createFAQ, updateFAQ, deleteFAQ,
  getChatLogs, getAnalytics,
  getRasaStatus, testChatbot,
  getEscalatedLogs,
  clearChatLogs,
  getThreadMessages,
  replyToThread,
} = require('../controllers/chatbotAdminController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

const adminOnly = authorizeRoles('super_admin', 'facility_admin');
const staffPlus = authorizeRoles('super_admin', 'facility_admin', 'staff');

// FAQs
router
  .route('/faqs')
  .get(staffPlus, getFAQs)
  .post(adminOnly, createFAQ);

router
  .route('/faqs/:id')
  .put(adminOnly, updateFAQ)
  .delete(adminOnly, deleteFAQ);

// Analytics & Logs
router.get('/logs', staffPlus, getChatLogs);
// Was imported but never actually wired to a route — the tablet's
// "Clear Chat Logs" button (patient_inquiry_screen.dart's
// _confirmClearLogs) was calling this and getting a 404 the whole time.
router.delete('/logs', adminOnly, clearChatLogs);
router.get('/escalated', staffPlus, getEscalatedLogs);
router.get('/analytics', staffPlus, getAnalytics);

// Per-patient conversation thread — full history + live staff reply.
// Backs the tablet's "Conversation with [patient]" dialog; see
// chatbotAdminController.js's header comments on both for why these
// didn't exist before despite the client already calling them.
router.get('/threads/:patientId/messages', staffPlus, getThreadMessages);
router.post('/threads/:patientId/reply', staffPlus, replyToThread);

// Machine Learning Engine Management
router.get('/rasa-status', staffPlus, getRasaStatus);
router.post('/test', adminOnly, testChatbot);

module.exports = router;