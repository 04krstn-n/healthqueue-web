/**
 * User Controller — user management (admin use)
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Staff = require('../models/Staff');
const { logAction } = require('../utils/auditLog');

// GET /api/users
const getUsers = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'facility_admin') {
      filter.clinicId = req.user.clinicId;
    } else {
      if (req.query.role) filter.role = req.query.role;
      if (req.query.clinicId) filter.clinicId = req.query.clinicId;
    }

    const users = await User.find(filter)
      .select('-password')
      .populate('clinicId', 'name')
      .sort({ createdAt: -1 });

    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to get users.' });
  }
};

// GET /api/users/:id
const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (req.user.role === 'facility_admin' && user.clinicId?.toString() !== req.user.clinicId?.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to get user.' });
  }
};

// POST /api/users
const createUser = async (req, res) => {
  const { fullName, email, phone, password, role, clinicId, gender, specialization } = req.body;

  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ message: 'fullName, email, password, and role are required.' });
  }

  const targetClinic = req.user.role === 'facility_admin' ? req.user.clinicId : (clinicId || null);

  if (req.user.role === 'facility_admin' && role !== 'staff') {
    return res.status(403).json({ message: 'Facility admins can only create staff accounts.' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Detect if the MongoDB connection supports transactions (Atlas / Replica Sets)
  const isReplicaSet = mongoose.connection.client?.topology?.description?.type === 'ReplicaSetWithPrimary' 
                    || mongoose.connection.client?.topology?.description?.type === 'Sharded';

  let session = null;
  if (isReplicaSet) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    const existing = await User.findOne({ email: normalizedEmail }).session(session);
    if (existing) {
      if (session) await session.abortTransaction();
      return res.status(409).json({ message: 'Email already registered.' });
    }

    // 1. Create User
    const [user] = await User.create(
      [
        {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: phone || '',
          password,
          role,
          clinicId: targetClinic,
          isVerified: true,
          gender: gender || undefined,
          specialization: specialization || '',
        },
      ],
      session ? { session } : {}
    );

    // 2. Create Staff profile if applicable
    if (role === 'staff' && targetClinic) {
      await Staff.create(
        [
          {
            user: user._id,
            clinic: targetClinic,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            specialization: user.specialization,
          },
        ],
        session ? { session } : {}
      );
    }

    if (session) await session.commitTransaction();

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.fullName,
      clinicId: targetClinic,
      details: { role: user.role, email: user.email },
    });

    return res.status(201).json({
      success: true,
      data: user.toSafeObject(),
    });
  } catch (err) {
    if (session) await session.abortTransaction();
    console.error('❌ createUser error:', err);
    return res.status(500).json({ message: err.message || 'Failed to create user.' });
  } finally {
    if (session) session.endSession();
  }
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  try {
    const { fullName, email, phone, clinicId, isActive, gender, specialization } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (req.user.role === 'facility_admin' && user.clinicId?.toString() !== req.user.clinicId?.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Only a super_admin may reassign which clinic an account (e.g. a
    // facility_admin) belongs to, or edit their login email — a
    // facility_admin editing their own clinic's staff should never be able
    // to touch these fields.
    const wasActive = user.isActive;

    if (fullName) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (clinicId !== undefined && req.user.role === 'super_admin') user.clinicId = clinicId;
    if (isActive !== undefined) user.isActive = isActive;
    if (gender !== undefined) user.gender = gender;
    if (specialization !== undefined) user.specialization = specialization;

    if (email !== undefined && req.user.role === 'super_admin') {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== user.email) {
        const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
        if (existing) {
          return res.status(409).json({ message: 'Email already registered to another account.' });
        }
        user.email = normalizedEmail;
      }
    }

    await user.save();

    // Keep active status, gender, and specialization synced with Staff record if applicable
    if (user.role === 'staff') {
      const staffUpdate = {};
      if (isActive !== undefined) staffUpdate.isActive = isActive;
      if (gender !== undefined) staffUpdate.gender = gender;
      if (specialization !== undefined) staffUpdate.specialization = specialization;
      if (email !== undefined && req.user.role === 'super_admin') staffUpdate.email = user.email;
      if (Object.keys(staffUpdate).length > 0) {
        await Staff.findOneAndUpdate({ user: user._id }, staffUpdate);
      }
    }

    // Distinguish reactivation from a generic update so the audit log isn't
    // just an undifferentiated "update" for every isActive flip.
    let auditAction = 'update';
    if (isActive !== undefined && isActive !== wasActive) {
      auditAction = isActive ? 'reactivate' : 'deactivate';
    }

    await logAction({
      actor: req.user,
      action: auditAction,
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.fullName,
      clinicId: user.clinicId,
      details: req.body,
    });

    return res.json(user.toSafeObject());
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update user.' });
  }
};

// DELETE /api/users/:id
const deactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (req.user.role === 'facility_admin' && user.clinicId?.toString() !== req.user.clinicId?.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    user.isActive = false;
    await user.save();

    if (user.role === 'staff') {
      await Staff.findOneAndUpdate({ user: user._id }, { isActive: false });
    }

    await logAction({
      actor: req.user,
      action: 'deactivate',
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.fullName,
      clinicId: user.clinicId,
    });

    return res.json({ message: 'User deactivated.', user: user.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to deactivate user.' });
  }
};

// GET /api/users/me/patient
const getMyPatientProfile = async (req, res) => {
  try {
    const profile = await Patient.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Patient profile not found.' });
    return res.json(profile);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to get profile.' });
  }
};

// PUT /api/users/me/patient
const updateMyPatientProfile = async (req, res) => {
  try {
    const allowed = ['fullName', 'dateOfBirth', 'age', 'gender', 'phone', 'email', 'address', 'philHealthNumber', 'hmoProvider', 'patientType', 'medicalNotes'];
    const update = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    const profile = await Patient.findOneAndUpdate(
      { user: req.user._id },
      update,
      { new: true, runValidators: true }
    );
    if (!profile) return res.status(404).json({ message: 'Patient profile not found.' });
    return res.json(profile);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update profile.' });
  }
};

// PUT /api/users/change-password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect.' });

    // Directly assign password to trigger Mongoose pre-save hashing
    user.password = newPassword;
    await user.save();

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('changePassword:', err.message);
    return res.status(500).json({ message: 'Failed to change password.' });
  }
};

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  getMyPatientProfile,
  updateMyPatientProfile,
  changePassword,
};