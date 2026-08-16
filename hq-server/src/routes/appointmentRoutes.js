const express = require('express');
const router = express.Router();

const {
  getMyAppointments,
  cancelMyAppointment,
  bookAppointment,
  updateAppointment,
  getAppointments,
  getAppointment,
  updateStatus,
  getAvailableSlots,
  getTodayAppointments,
  getTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
} = require('../controllers/appointmentController');

const { protect, authorizeRoles, patientOnly } = require('../middleware/auth');

router.use(protect);

// ── 1. Static Sub-Routes (Must precede parametric /:id routes) ───────────────

// Time Slots Configuration (admin/facility_admin)
router
  .route('/timeslots')
  .get(authorizeRoles('super_admin', 'facility_admin'), getTimeSlots)
  .post(authorizeRoles('super_admin', 'facility_admin'), createTimeSlot);

router
  .route('/timeslots/:id')
  .put(authorizeRoles('super_admin', 'facility_admin'), updateTimeSlot)
  .delete(authorizeRoles('super_admin', 'facility_admin'), deleteTimeSlot);

// Slot Availability (patients and staff)
router.get('/available-slots', getAvailableSlots);

// Patient Specific Dashboard
router.get('/my', patientOnly, getMyAppointments);

// Staff/Admin Today's View
router.get('/today', authorizeRoles('staff', 'facility_admin', 'super_admin'), getTodayAppointments);

// ── 2. Base Collection Routes ───────────────────────────────────────────────

router
  .route('/')
  .get(authorizeRoles('staff', 'facility_admin', 'super_admin'), getAppointments)
  .post(patientOnly, bookAppointment);

// ── 3. Parametric Individual Item Routes ─────────────────────────────────────

router.get('/:id', getAppointment); 
router.put('/:id', updateAppointment); // Handles rescheduling & general updates
router.put('/:id/status', authorizeRoles('staff', 'facility_admin', 'super_admin'), updateStatus);
router.put('/:id/cancel', cancelMyAppointment); 
router.put('/:id/cancel-my', cancelMyAppointment); 

module.exports = router;