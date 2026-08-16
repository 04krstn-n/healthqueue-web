const express = require('express');
const router = express.Router();
const {
  getServices,
  addService,
  updateService,
  deleteService,
} = require('../controllers/servicesController');
const { protect, authorizeRoles } = require('../middleware/auth');

// Apply authentication to all service endpoints
router.use(protect);

// GET /api/services — List services for a clinic
// POST /api/services — Add a service
router
  .route('/')
  .get(authorizeRoles('facility_admin', 'super_admin', 'staff'), getServices)
  .post(authorizeRoles('facility_admin', 'super_admin'), addService);

// PUT /api/services/:clinicId/:serviceId — Update a service
// DELETE /api/services/:clinicId/:serviceId — Remove a service
router
  .route('/:clinicId/:serviceId')
  .put(authorizeRoles('facility_admin', 'super_admin'), updateService)
  .delete(authorizeRoles('facility_admin', 'super_admin'), deleteService);

module.exports = router;