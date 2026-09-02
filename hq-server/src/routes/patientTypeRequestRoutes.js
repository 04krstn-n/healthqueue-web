const express = require('express');
const router = express.Router();
const {
  createRequest,
  getMyRequest,
  getRequests,
  getRequestPhoto,
  approveRequest,
  rejectRequest,
} = require('../controllers/patientTypeRequestController');
const { protect, authorizeRoles, patientOnly } = require('../middleware/auth');
const { uploadIdPhoto } = require('../middleware/upload');

router.use(protect);

const staffOrAdmin = authorizeRoles('staff', 'facility_admin', 'super_admin');

// ── Patient ──────────────────────────────────────────────────────────────
router.post('/', patientOnly, uploadIdPhoto.single('photo'), createRequest);
router.get('/mine', patientOnly, getMyRequest);

// ── Staff review ─────────────────────────────────────────────────────────
router.get('/', staffOrAdmin, getRequests);
router.put('/:id/approve', staffOrAdmin, approveRequest);
router.put('/:id/reject', staffOrAdmin, rejectRequest);

// Photo access is ownership/role-checked inside the controller (patient can
// view their own; staff/admin can view any), not gated by middleware here.
router.get('/:id/photo', getRequestPhoto);

module.exports = router;
