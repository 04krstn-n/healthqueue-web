const express = require('express');
const router = express.Router();
const {
  getFAQs, createFAQ, updateFAQ, deleteFAQ,
  getChatLogs, getAnalytics,
  getRasaStatus, testChatbot,
  getEscalatedLogs,
  clearChatLogs,
} = require('../controllers/chatbotAdminController');
const {
  getThreadMessages,
  replyToThread,
} = require('../controllers/chatbotController');
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
router.get('/escalated', staffPlus, getEscalatedLogs);
router.get('/analytics', staffPlus, getAnalytics);

// Live conversation threads — the two-way follow-up to an escalation.
// getEscalatedLogs/getChatLogs above are for the inbox list; these are for
// the open thread view once staff picks one to actually work.
router.get('/threads/:patientId/messages', staffPlus, getThreadMessages);
router.post('/threads/:patientId/reply', staffPlus, replyToThread);

// Machine Learning Engine Management
router.get('/rasa-status', staffPlus, getRasaStatus);
router.post('/test', adminOnly, testChatbot);

module.exports = router;