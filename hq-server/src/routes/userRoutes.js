const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  getMyPatientProfile,
  updateMyPatientProfile,
  changePassword,
} = require('../controllers/userController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

// ─── Current Logged-in User Endpoints ─────────────────────────────────────────
router.put('/change-password', changePassword);

router
  .route('/me/patient')
  .get(getMyPatientProfile)
  .put(updateMyPatientProfile);

// ─── Admin User Management Endpoints ──────────────────────────────────────────
router
  .route('/')
  .get(authorizeRoles('facility_admin', 'super_admin'), getUsers)
  .post(authorizeRoles('facility_admin', 'super_admin'), createUser);

router
  .route('/:id')
  .get(authorizeRoles('facility_admin', 'super_admin'), getUser)
  .put(authorizeRoles('facility_admin', 'super_admin'), updateUser)
  .delete(authorizeRoles('facility_admin', 'super_admin'), deactivateUser);

module.exports = router;