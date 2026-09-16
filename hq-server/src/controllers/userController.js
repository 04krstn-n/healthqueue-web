/**
 * User Controller — user management (admin use)
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Staff = require('../models/Staff');
const { logAction } = require('../utils/auditLog');
const { validatePasswordStrength, normalizePhone } = require('./authController');

// Generates a random one-time password for accounts an admin creates on
// someone else's behalf (super_admin -> facility_admin, facility_admin ->
// staff). Guaranteed to satisfy the same strength rule
// authController.validatePasswordStrength enforces (8+ chars, upper,
// lower, digit, special) — built from one guaranteed character of each
// class plus random fill, then shuffled so the required characters aren't
// always in the same position. The admin sees this once, in the create
// response, to hand over to the account's owner; mustChangePassword forces
// them to replace it before doing anything else.
const generateTempPassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;

  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  const fill = Array.from({ length: 8 }, () => pick(all));
  const chars = [...required, ...fill];

  // Fisher-Yates shuffle using crypto.randomInt (avoids Math.random for
  // anything password-related)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

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
  const { fullName, email, phone, role, clinicId, gender, specialization } = req.body;

  if (!fullName || !email || !role) {
    return res.status(400).json({ message: 'fullName, email, and role are required.' });
  }

  // Phone used to be optional here, which silently broke Forgot Password
  // for any admin/staff account created without one — forgotPassword()
  // looks accounts up by phone, so an account with none simply can't use
  // it. Required now so every admin/staff account this endpoint creates
  // actually has a working recovery path.
  if (!phone || !phone.trim()) {
    return res.status(400).json({ message: 'A phone number is required (used for Forgot Password OTP verification).' });
  }
  const normalizedPhone = normalizePhone(phone);

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

    const existingPhone = await User.findOne({ phone: normalizedPhone }).session(session);
    if (existingPhone) {
      if (session) await session.abortTransaction();
      return res.status(409).json({ message: 'This phone number is already in use by another account.' });
    }

    // 1. Create User — password is always generated here (never trusted
    // from the client) so it can't be left as something predictable like
    // "Staff@123"; mustChangePassword forces it to be replaced before the
    // account can be used for anything else.
    const tempPassword = generateTempPassword();
    const [user] = await User.create(
      [
        {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          password: tempPassword,
          mustChangePassword: true,
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
      // Shown once, here only — never logged, never stored anywhere but
      // the (already-hashed) User document. The creating admin is
      // responsible for handing this to the account's owner out of band;
      // it can't be retrieved again after this response (they'd need to
      // use forgot-password instead if it's lost before first login).
      tempPassword,
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
    // patientType intentionally excluded: it drives priority queue
    // placement (see queueController.joinQueue), so it must only be
    // changeable by staff/admin — via PUT /api/patients/:id — after they've
    // actually verified the patient (senior citizen ID, PWD ID, etc.), not
    // self-declared by the patient through their own profile edit.
    const allowed = ['fullName', 'dateOfBirth', 'age', 'gender', 'phone', 'email', 'address', 'philHealthNumber', 'hmoProvider', 'medicalNotes'];
    const update = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    // Gender represents sex at birth and is limited to Male/Female at
    // registration and in profile edits going forward. The schema enum
    // still allows 'Other'/'' so existing records aren't broken by this.
    if (update.gender !== undefined && !['Male', 'Female'].includes(update.gender)) {
      return res.status(400).json({ message: 'Gender must be Male or Female.' });
    }

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

    const passwordProblems = validatePasswordStrength(newPassword);
    if (passwordProblems.length > 0) {
      return res.status(400).json({ message: `Password must have ${passwordProblems.join(', ')}.` });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect.' });

    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from your current password.' });
    }

    // Directly assign password to trigger Mongoose pre-save hashing
    user.password = newPassword;
    // Satisfies the forced first-login change (see userController.createUser
    // and the mustChangePassword gate in the web/tablet clients) — also a
    // normal no-op for anyone changing their password voluntarily
    // afterward, since it's already false by then.
    user.mustChangePassword = false;
    await user.save();

    await logAction({
      actor: req.user,
      action: 'change_password',
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.fullName,
      clinicId: user.clinicId,
    }).catch(() => {});

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('changePassword:', err.message);
    return res.status(500).json({ message: 'Failed to change password.' });
  }
};

// PUT /api/users/me/fcm-token — Registers/updates this device's push token.
// Called by the app right after login and whenever Firebase issues a
// refreshed token. Silently accepts an empty/null token too, so logging
// out (or disabling notifications) can clear it — a stale token left
// behind would just make sendPushToUser() silently fail forever on a
// dead device, which is harmless but worth avoiding.
const registerFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { fcmToken: fcmToken || null });
    return res.json({ success: true });
  } catch (err) {
    console.error('registerFcmToken:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to register push token.' });
  }
};

// PUT /api/users/me/deactivate — lets a patient deactivate their OWN
// account. Previously there was no self-service path at all — the only
// deactivateUser endpoint is staff/admin-only (DELETE /users/:id,
// restricted to facility_admin/super_admin), so a patient could never
// actually deactivate their own account through the API. The mobile
// app's "Deactivate Account" confirmation dialog existed, but the button
// behind it only called local logout() — it never reached the server at
// all, so the account stayed fully active while the app just looked like
// it had signed the patient out.
const deactivateMyAccount = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { isActive: false });
    return res.json({ success: true, message: 'Account deactivated.' });
  } catch (err) {
    console.error('deactivateMyAccount:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to deactivate account.' });
  }
};

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  deactivateMyAccount,
  getMyPatientProfile,
  updateMyPatientProfile,
  changePassword,
  registerFcmToken,
};