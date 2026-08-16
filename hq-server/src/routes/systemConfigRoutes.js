const express = require('express');
const router = express.Router();
const {
  getConfigs,
  getConfig,
  updateConfig,
  createConfig,
} = require('../controllers/systemConfigController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);

// System config management is typically restricted to super_admin
router
  .route('/')
  .get(authorizeRoles('super_admin'), getConfigs)
  .post(authorizeRoles('super_admin'), createConfig);

router
  .route('/key/:key')
  .get(authorizeRoles('super_admin'), getConfig);

router
  .route('/:id')
  .put(authorizeRoles('super_admin'), updateConfig);

module.exports = router;