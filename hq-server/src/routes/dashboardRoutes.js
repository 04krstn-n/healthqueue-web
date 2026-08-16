const express = require('express');
const router = express.Router();
const { getSuperAdminStats, getFacilityStats } = require('../controllers/dashboardController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

router.get('/super-admin', authorizeRoles('super_admin'), getSuperAdminStats);
router.get('/facility', authorizeRoles('facility_admin', 'super_admin', 'staff'), getFacilityStats);

module.exports = router;