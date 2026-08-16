const express = require('express');
const router = express.Router();
const {
  getClinics, getClinicDirectory, getClinic,
  createClinic, updateClinic, deleteClinic, getRecommendations,
} = require('../controllers/clinicController');
const { protect, authorizeRoles } = require('../middleware/auth');

// Public directory endpoints
router.get('/directory', getClinicDirectory);
router.get('/recommend', getRecommendations);

// Authenticated endpoints
router.use(protect);

router
  .route('/')
  .get(authorizeRoles('super_admin', 'facility_admin', 'staff'), getClinics)
  .post(authorizeRoles('super_admin'), createClinic); // Restricted to platform Super Admin

router
  .route('/:id')
  .get(getClinic)
  .put(authorizeRoles('facility_admin', 'super_admin'), updateClinic)
  .delete(authorizeRoles('super_admin'), deleteClinic);

module.exports = router;