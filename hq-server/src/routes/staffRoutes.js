const express = require('express');
const router = express.Router();
const {
  getStaff,
  getStaffMember,
  createStaff,
  updateStaff,
  deactivateStaff,
} = require('../controllers/staffController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

// GET /api/staff — List staff
// POST /api/staff — Create staff + user
router
  .route('/')
  .get(authorizeRoles('facility_admin', 'super_admin'), getStaff)
  .post(authorizeRoles('facility_admin', 'super_admin'), createStaff);

// GET /api/staff/:id — Get single staff member
// PUT /api/staff/:id — Update staff
// DELETE /api/staff/:id — Deactivate staff
router
  .route('/:id')
  .get(authorizeRoles('facility_admin', 'super_admin'), getStaffMember)
  .put(authorizeRoles('facility_admin', 'super_admin'), updateStaff)
  .delete(authorizeRoles('facility_admin', 'super_admin'), deactivateStaff);

module.exports = router;