/**
 * Staff Controller — manage staff profiles
 * Access: facility_admin (own clinic), super_admin (all)
 */
const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const User = require('../models/User');
const { logAction } = require('../utils/auditLog');

// GET /api/staff
const getStaff = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'facility_admin') {
      filter.clinic = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinic = req.query.clinicId;
    }

    const staff = await Staff.find(filter)
      .populate('user', 'email isActive phone')
      .populate('clinic', 'name')
      .sort({ createdAt: -1 });

    return res.json(staff);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch staff.' });
  }
};

// GET /api/staff/:id
const getStaffMember = async (req, res) => {
  try {
    const member = await Staff.findById(req.params.id)
      .populate('user', 'email isActive phone')
      .populate('clinic', 'name');

    if (!member) {
      return res.status(404).json({
        message: 'Staff member not found.'
      });
    }

    // Facility admins can only access staff belonging to their clinic
    if (
      req.user.role === 'facility_admin' &&
      member.clinic?._id?.toString() !== req.user.clinicId?.toString()
    ) {
      return res.status(403).json({
        message: 'Access denied.'
      });
    }

    return res.status(200).json(member);

  } catch (err) {
    console.error('getStaffMember Error:', err);

    return res.status(500).json({
      message: 'Failed to fetch staff member.'
    });
  }
};

// POST /api/staff — Transactional account + profile creation (Replica set / Standalone safe)
const createStaff = async (req, res) => {
  // Check if current MongoDB connection supports transactions (Atlas / Replica Sets)
  const isReplicaSet =
    mongoose.connection.client?.topology?.description?.type === 'ReplicaSetWithPrimary' ||
    mongoose.connection.client?.topology?.description?.type === 'Sharded';

  let session = null;
  if (isReplicaSet) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    const { fullName, email, phone, gender, role, specialization, licenseNumber, clinicId, password } = req.body;

    console.log('CREATE STAFF BODY:', req.body);
    console.log('RECEIVED GENDER:', gender);

    if (!fullName || !email) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ message: 'Name and email are required.' });
    }

    const targetClinic = clinicId || req.user.clinicId;
    if (!targetClinic) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ message: 'Clinic ID is required.' });
    }

    if (req.user.role === 'facility_admin' && targetClinic.toString() !== req.user.clinicId.toString()) {
      if (session) await session.abortTransaction();
      return res.status(403).json({ message: 'Cannot create staff for another clinic.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail }).session(session);
    if (existing) {
      if (session) await session.abortTransaction();
      return res.status(409).json({ message: 'A user with this email already exists.' });
    }

    // 1. Create User
    const [userDoc] = await User.create(
      [
        {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: phone || '',
          password: password || 'Staff@123',
          role: 'staff',
          clinicId: targetClinic,
          isVerified: true,
        },
      ],
      session ? { session } : {}
    );

    // 2. Create Staff Profile
    const [staffDoc] = await Staff.create(
      [
        {
          gender: gender || '',
          user: userDoc._id,
          clinic: targetClinic,
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: phone || '',
          role: role || 'admin',
          specialization: specialization || '',
          licenseNumber: licenseNumber || '',
          isActive: true,
        },
      ],
      session ? { session } : {}
    );

    if (session) await session.commitTransaction();

    const populated = await Staff.findById(staffDoc._id)
      .populate('user', 'email isActive phone')
      .populate('clinic', 'name');

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'Staff',
      targetId: staffDoc._id,
      targetLabel: staffDoc.fullName,
      clinicId: targetClinic,
      details: { role: staffDoc.role, email: staffDoc.email },
    });

    return res.status(201).json(populated);
  } catch (err) {
    if (session) await session.abortTransaction();
    console.error('❌ createStaff error:', err);
    return res.status(500).json({ message: err.message || 'Failed to create staff member.' });
  } finally {
    if (session) session.endSession();
  }
};

// PUT /api/staff/:id
const updateStaff = async (req, res) => {
  try {
    const member = await Staff.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Staff member not found.' });

    if (req.user.role === 'facility_admin' && member.clinic.toString() !== req.user.clinicId.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const allowed = ['position', 'specialization', 'licenseNumber', 'schedule', 'isActive', 'phone', 'role', 'fullName', 'email', 'gender'];
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) member[f] = req.body[f];
    });

    await member.save();

    // Sync status back to linked User
    if (req.body.isActive !== undefined && member.user) {
      await User.findByIdAndUpdate(member.user, { isActive: req.body.isActive });
    }

    const updated = await Staff.findById(member._id)
      .populate('user', 'email isActive phone')
      .populate('clinic', 'name');

    await logAction({
      actor: req.user,
      action: 'update',
      targetType: 'Staff',
      targetId: member._id,
      targetLabel: member.fullName,
      clinicId: member.clinic,
      details: req.body,
    });

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update staff member.' });
  }
};

// DELETE /api/staff/:id — Deactivate
const deactivateStaff = async (req, res) => {
  try {
    const member = await Staff.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Staff member not found.' });

    if (req.user.role === 'facility_admin' && member.clinic.toString() !== req.user.clinicId.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    member.isActive = false;
    await member.save();

    if (member.user) {
      await User.findByIdAndUpdate(member.user, { isActive: false });
    }

    await logAction({
      actor: req.user,
      action: 'deactivate',
      targetType: 'Staff',
      targetId: member._id,
      targetLabel: member.fullName,
      clinicId: member.clinic,
    });

    return res.json({ message: 'Staff member deactivated.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to deactivate staff member.' });
  }
};

module.exports = { getStaff, getStaffMember, createStaff, updateStaff, deactivateStaff };