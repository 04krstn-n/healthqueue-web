/**
 * Patient Controller — admin view of patient records
 */
const Patient = require('../models/Patient');
const User = require('../models/User');
const { HttpStatus } = require('../config/config');

// GET /api/patients
const getPatients = async (req, res) => {
  try {
    const { search, patientType } = req.query;
    const filter = {};
    if (patientType && patientType !== 'all') filter.patientType = patientType;
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
          phone: phone || '',
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
      phone: phone || '',
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
    const patient = await Patient.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!patient) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Patient not found.' });
    if (patient.user) await User.findByIdAndUpdate(patient.user, { isActive: false });
    return res.status(HttpStatus.OK).json({ success: true, message: 'Patient deactivated.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to deactivate patient.' });
  }
};

module.exports = { getPatients, getPatient, createPatient, updatePatient, deactivatePatient };