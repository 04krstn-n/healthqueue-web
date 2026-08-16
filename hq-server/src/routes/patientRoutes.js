const express = require('express');
const router = express.Router();
const { 
  getPatients, 
  getPatient, 
  createPatient, 
  updatePatient, 
  deactivatePatient 
} = require('../controllers/patientController');
const { protect, authorizeRoles } = require('../middleware/auth');

router.use(protect);
// Allow staff members to manage/read patient records as well as admins
router.use(authorizeRoles('super_admin', 'facility_admin', 'staff'));

router
  .route('/')
  .get(getPatients)
  .post(createPatient);

router
  .route('/:id')
  .get(getPatient)
  .put(updatePatient)
  .delete(authorizeRoles('super_admin', 'facility_admin'), deactivatePatient);

module.exports = router;