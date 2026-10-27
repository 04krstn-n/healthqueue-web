/**
 * User Controller — user management (admin use)
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { validateEmailAddress, sendAccountCreatedEmail } = require('../services/emailService');
const { generatePassword } = require('../utils/generatePassword');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Staff = require('../models/Staff');
const { logAction } = require('../utils/auditLog');
const { validatePasswordStrength, normalizePhone } = require('./authController');
const { checkOptionalPhone } = require('../utils/validators');

// Accounts an admin creates (super_admin -> facility_admin, facility_admin ->
// staff) are created WITHOUT a usable password. The admin then clicks "Send
// password": the SYSTEM generates a random password and emails it to the new
// user (sendPassword below). Nobody types or sees it, and the user must change
// it on first login (mustChangePassword). No default password exists anywhere.

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

  // Phone is optional: admin/staff reset their password by EMAIL, so a phone
  // number is no longer needed for recovery.
  const phoneCheck = checkOptionalPhone(phone);
  if (!phoneCheck.ok) return res.status(400).json({ message: phoneCheck.message });
  const normalizedPhone = phoneCheck.value || undefined;

  const targetClinic = req.user.role === 'facility_admin' ? req.user.clinicId : (clinicId || null);

  if (req.user.role === 'facility_admin' && role !== 'staff') {
    return res.status(403).json({ message: 'Facility admins can only create staff accounts.' });
  }
  // There is exactly one System Administrator. It can only create Facility
  // Administrators — never staff, patients/users, or another super admin.
  if (req.user.role === 'super_admin' && role !== 'facility_admin') {
    return res.status(403).json({ message: 'The System Administrator can only create Facility Administrator accounts.' });
  }

  const emailCheck = await validateEmailAddress(email);
  if (!emailCheck.ok) {
    return res.status(400).json({ message: emailCheck.reason });
  }
  const normalizedEmail = emailCheck.email;

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

    // Same-name guard: within one clinic, two admin/staff accounts of the same
    // role may not share a full name (case-insensitive) — it makes audit logs
    // and the queue's "served by" ambiguous. Different clinics are fine.
    const nameClash = await User.findOne({
      fullName: new RegExp(`^${fullName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      role,
      clinicId: targetClinic || null,
    }).session(session);
    if (nameClash) {
      if (session) await session.abortTransaction();
      return res.status(409).json({ message: `A ${role === 'staff' ? 'staff member' : 'facility admin'} named "${fullName.trim()}" already exists${targetClinic ? ' in this clinic' : ''}. Add a middle initial or other detail to tell them apart.` });
    }

    const existingPhone = normalizedPhone ? await User.findOne({ phone: normalizedPhone }).session(session) : null;
    if (existingPhone) {
      if (session) await session.abortTransaction();
      return res.status(409).json({ message: 'This phone number is already in use by another account.' });
    }

    // 1. Create User — password was chosen by the creating admin and has
    // already passed the strength policy above; the pre-save hook hashes it.
    // mustChangePassword makes the account's owner replace it on first login.
    const [user] = await User.create(
      [
        {
          fullName: fullName.trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          // Random, never emailed or shown: the real password is generated
          // and emailed when the admin clicks "Send password".
          password: generatePassword(16),
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
      passwordSent: false,
    });
  } catch (err) {
    if (session) await session.abortTransaction();
    console.error('❌ createUser error:', err);
    return res.status(500).json({ message: err.message || 'Failed to create user.' });
  } finally {
    if (session) session.endSession();
  }
};

// POST /api/users/:id/send-password
// Generates a fresh random password and emails it to the account's owner.
// super_admin -> facility_admin / staff; facility_admin -> staff of own clinic.
// Only while the account has not yet set its own password (mustChangePassword),
// so an admin can never reset the password of someone already using the system.
const SEND_COOLDOWN_MS = 30 * 1000;
const sendPassword = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const allowedTarget = req.user.role === 'super_admin'
      ? user.role === 'facility_admin'
      : user.role === 'staff' && user.clinicId?.toString() === req.user.clinicId?.toString();
    if (!allowedTarget) return res.status(403).json({ message: 'Access denied.' });

    if (!user.isActive) return res.status(400).json({ message: 'This account is deactivated.' });
    if (!user.mustChangePassword) {
      return res.status(409).json({ message: 'This user already set their own password. They can use Forgot Password if they need a new one.' });
    }
    if (user.passwordSentAt && Date.now() - user.passwordSentAt.getTime() < SEND_COOLDOWN_MS) {
      return res.status(429).json({ message: 'A password was just sent. Please wait a few seconds before resending.' });
    }

    const previousHash = user.password;
    const previousSentAt = user.passwordSentAt || null;
    const password = generatePassword();
    user.password = password; // hashed by the pre-save hook
    user.mustChangePassword = true;
    user.passwordSentAt = new Date();
    await user.save();

    const mail = await sendAccountCreatedEmail(user.email, {
      fullName: user.fullName,
      role: user.role,
      password,
      createdBy: req.user?.fullName,
    });

    if (!mail.success) {
      // Nobody received the new password — put the old state back.
      await User.updateOne({ _id: user._id }, { password: previousHash, passwordSentAt: previousSentAt });
      console.error(`Password email not delivered to ${user.email}:`, mail.error);
      return res.status(502).json({
        success: false,
        message: `The password email could not be sent to ${user.email}. Check that the address is correct (edit it if needed) and try again.`,
      });
    }

    await logAction({
      actor: req.user,
      action: 'update',
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.fullName,
      clinicId: user.clinicId,
      details: { event: 'password_sent', email: user.email },
    });

    return res.json({ success: true, message: `A generated password was emailed to ${user.email}.`, data: user.toSafeObject() });
  } catch (err) {
    console.error('❌ sendPassword error:', err);
    return res.status(500).json({ message: 'Failed to send password.' });
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
    if (phone !== undefined) {
      const phoneCheck = checkOptionalPhone(phone);
      if (!phoneCheck.ok) return res.status(400).json({ message: phoneCheck.message });
      // undefined (not '') so a cleared phone doesn't collide on the sparse unique index
      user.phone = phoneCheck.value || undefined;
    }
    if (clinicId !== undefined && req.user.role === 'super_admin') user.clinicId = clinicId;
    if (isActive !== undefined) user.isActive = isActive;
    if (gender !== undefined) user.gender = gender;
    if (specialization !== undefined) user.specialization = specialization;

    // super_admin may always edit an email; a facility_admin may fix a typo on a
    // staff account in their clinic until that person has set their own password.
    const canEditEmail = req.user.role === 'super_admin'
      || (req.user.role === 'facility_admin' && user.role === 'staff' && user.mustChangePassword);
    if (email !== undefined && canEditEmail) {
      const emailCheck = await validateEmailAddress(email);
      if (!emailCheck.ok) {
        return res.status(400).json({ message: emailCheck.reason });
      }
      const normalizedEmail = emailCheck.email;
      if (normalizedEmail !== user.email) {
        const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
        if (existing) {
          return res.status(409).json({ message: 'Email already registered to another account.' });
        }
        user.email = normalizedEmail;
        user.passwordSentAt = null; // the old address got nothing usable; resend to the new one
      }
    }

    await user.save();

    // Keep active status, gender, and specialization synced with Staff record if applicable
    if (user.role === 'staff') {
      const staffUpdate = {};
      if (isActive !== undefined) staffUpdate.isActive = isActive;
      if (gender !== undefined) staffUpdate.gender = gender;
      if (specialization !== undefined) staffUpdate.specialization = specialization;
      if (email !== undefined && canEditEmail) staffUpdate.email = user.email;
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
    if (update.phone !== undefined) {
      const phoneCheck = checkOptionalPhone(update.phone);
      if (!phoneCheck.ok) return res.status(400).json({ message: phoneCheck.message });
      update.phone = phoneCheck.value;
    }
    if (update.fullName !== undefined && (typeof update.fullName !== 'string' || update.fullName.trim().length < 2)) {
      return res.status(400).json({ message: 'Full name must be at least 2 characters.' });
    }
    if (update.dateOfBirth) {
      const dob = new Date(update.dateOfBirth);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) {
        return res.status(400).json({ message: 'Enter a valid date of birth.' });
      }
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
  sendPassword,
  updateUser,
  deactivateUser,
  deactivateMyAccount,
  getMyPatientProfile,
  updateMyPatientProfile,
  changePassword,
  registerFcmToken,
};