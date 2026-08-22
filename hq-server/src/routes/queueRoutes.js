const express = require('express');
const router = express.Router();
const {
  getQueueEntries,
  joinQueue,
  getMyQueueStatus,
  callPatient,
  startService,
  completePatient,
  skipPatient,
  markNoShow,
  cancelEntry,
  requeueEntry,
  getQueueMetrics,
  addWalkIn,
} = require('../controllers/queueController');
const { protect, authorizeRoles, patientOnly } = require('../middleware/auth');

router.use(protect);

const staffOrAdmin = authorizeRoles('staff', 'facility_admin', 'super_admin');

// ── 1. Static Routes First ───────────────────────────────────────────────────
router.get('/metrics', staffOrAdmin, getQueueMetrics);
router.get('/my-status', patientOnly, getMyQueueStatus);

// ── 2. Queue Joins / Additions ───────────────────────────────────────────────
router.post('/join', patientOnly, joinQueue);
router.post('/add-walkin', authorizeRoles('staff', 'facility_admin'), addWalkIn);

// ── 3. Base List ─────────────────────────────────────────────────────────────
router.get('/', staffOrAdmin, getQueueEntries);

// ── 4. Parametric Entry State Mutations ──────────────────────────────────────
router.put('/:id/call', authorizeRoles('staff', 'facility_admin'), callPatient);
// Was defined in the controller but never mounted — this is why "called" and
// "skipped" entries used to get stuck with no way to move them to serving/done.
router.put('/:id/start-service', authorizeRoles('staff', 'facility_admin'), startService);
router.put('/:id/complete', authorizeRoles('staff', 'facility_admin'), completePatient);
router.put('/:id/skip', authorizeRoles('staff', 'facility_admin'), skipPatient);
router.put('/:id/no-show', authorizeRoles('staff', 'facility_admin'), markNoShow);
router.put('/:id/cancel', authorizeRoles('staff', 'facility_admin'), cancelEntry); // Controller validates ownership or staff role
// Brings a called/skipped/no-show entry back to "waiting" so staff aren't stuck.
router.put('/:id/requeue', authorizeRoles('staff', 'facility_admin'), requeueEntry);

module.exports = router;