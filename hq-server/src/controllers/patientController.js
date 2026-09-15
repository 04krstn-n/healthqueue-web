/**
 * Patient Controller — admin view of patient records
 */
const Patient = require('../models/Patient');
const User = require('../models/User');
const QueueEntry = require('../models/QueueEntry');
const Appointment = require('../models/Appointment');
const { HttpStatus } = require('../config/config');

// A Patient record isn't owned by one clinic (the same patient can visit
// several), so "belongs to my clinic" has to mean "has actually been seen
// at my clinic" rather than a simple field match. Used to scope
// getPatients/getPatient/updatePatient/deactivatePatient for facility_admin
// and staff — this was previously not scoped AT ALL, so any staff account
// could view, edit, or deactivate any patient system-wide regardless of
// clinic.
const getClinicPatientIds = async (clinicId) => {
  const [queuePatients, apptPatients] = await Promise.all([
    QueueEntry.distinct('patient', { clinic: clinicId, patient: { $ne: null } }),
    Appointment.distinct('patient', { clinic: clinicId, patient: { $ne: null } }),
  ]);
  return [...new Set([...queuePatients, ...apptPatients].map(String))];
};

// True if this patient has ever actually been seen at the given clinic
// (via queue or appointment) — the authorization check used below.
const patientBelongsToClinic = async (patientUserId, clinicId) => {
  if (!patientUserId) return false;
  const [inQueue, hasAppt] = await Promise.all([
    QueueEntry.exists({ clinic: clinicId, patient: patientUserId }),
    Appointment.exists({ clinic: clinicId, patient: patientUserId }),
  ]);
  return Boolean(inQueue || hasAppt);
};

// GET /api/patients
const getPatients = async (req, res) => {
  try {
    const { search, patientType } = req.query;
    const filter = {};
    if (patientType && patientType !== 'all') filter.patientType = patientType;

    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      const patientIds = await getClinicPatientIds(req.user.clinicId);
      filter.user = { $in: patientIds };
    }

    let patients = await Patient.find(filter)
      .populate('user', 'email isActive createdAt')
      .sort({ createdAt: -1 });
    if (search) {
      const s = search.toLowerCase();
      patients = patients.filter(p =>
        p.fullName?.toLowerCase().includes(s) ||
        p.email?.toLowerCase().includes(s) ||
        p.phone?.includes(s) ||
        p.philHealthNumber?.toLowerCase().includes(s)
      );
    }
    return res.status(HttpStatus.OK).json({ success: true, data: patients });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch patients.' });
  }
};

// GET /api/patients/:id
const getPatient = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id).populate('user', 'email isActive createdAt');
    if (!patient) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Patient not found.' });

    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      const authorized = await patientBelongsToClinic(patient.user, req.user.clinicId);
      if (!authorized) {
        return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'This patient has no record at your clinic.' });
      }
    }

    return res.status(HttpStatus.OK).json({ success: true, data: patient });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch patient.' });
  }
};

// POST /api/patients — admin creates a patient record directly
const createPatient = async (req, res) => {
  try {
    const { fullName, email, phone, dateOfBirth, gender, address, patientType, philHealthNumber } = req.body;
    if (!fullName) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Full name is required.' });

    let userId = null;
    if (email) {
      const existing = await User.findOne({ email: email.toLowerCase().trim() });
      if (existing) {
        userId = existing._id;
      } else {
        const userDoc = await User.create({
          fullName: fullName.trim(),
          email: email.toLowerCase().trim(),
          phone: phone || undefined, // undefined (not '') so it does not collide on User.phone's sparse unique index
          password: 'Patient@123',
          role: 'patient',
          isVerified: true,
        });
        userId = userDoc._id;
      }
    }

    const patient = await Patient.create({
      user: userId,
      fullName: fullName.trim(),
      email: email || '',
      phone: phone || '', // Patient.phone has no unique constraint — '' is fine here
      dateOfBirth: dateOfBirth || null,
      gender: gender || 'Other',
      address: address || '',
      patientType: patientType || 'Regular',
      philHealthNumber: philHealthNumber || '',
      isActive: true,
    });

    return res.status(HttpStatus.CREATED).json({ success: true, data: patient });
  } catch (err) {
    console.error('createPatient error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message || 'Failed to create patient.' });
  }
};

// PUT /api/patients/:id
const updatePatient = async (req, res) => {
  try {
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      const existing = await Patient.findById(req.params.id).select('user');
      if (!existing) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Patient not found.' });
      const authorized = await patientBelongsToClinic(existing.user, req.user.clinicId);
      if (!authorized) {
        return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'This patient has no record at your clinic.' });
      }
    }
    const allowed = ['fullName', 'email', 'phone', 'dateOfBirth', 'gender', 'address', 'patientType', 'philHealthNumber', 'bloodType', 'allergies', 'medicalHistory', 'isActive'];
    const update = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });
    const patient = await Patient.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!patient) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Patient not found.' });
    return res.status(HttpStatus.OK).json({ success: true, data: patient });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to update patient.' });
  }
};

// DELETE /api/patients/:id — deactivate
const deactivatePatient = async (req, res) => {
  try {
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      const existing = await Patient.findById(req.params.id).select('user');
      if (!existing) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Patient not found.' });
      const authorized = await patientBelongsToClinic(existing.user, req.user.clinicId);
      if (!authorized) {
        return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'This patient has no record at your clinic.' });
      }
    }
    const patient = await Patient.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!patient) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Patient not found.' });
    if (patient.user) await User.findByIdAndUpdate(patient.user, { isActive: false });
    return res.status(HttpStatus.OK).json({ success: true, message: 'Patient deactivated.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to deactivate patient.' });
  }
};

module.exports = { getPatients, getPatient, createPatient, updatePatient, deactivatePatient };