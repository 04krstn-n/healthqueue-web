/**
 * Auth Controller — Registration (Semaphore OTP), verification, login,
 * forgot-password, and profile.
 */
const crypto = require('crypto');
const User = require('../models/User');
const Patient = require('../models/Patient');
const PendingRegistration = require('../models/PendingRegistration');
const PasswordReset = require('../models/PasswordReset');
const { signToken } = require('../utils/token');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');
const { sendOTP } = require('../services/smsService');

/**
 * Generates a 6-digit OTP code
 */
const generateOTPCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Normalizes a PH mobile number to a single canonical form (09XXXXXXXXX)
// before it's ever stored or queried. The mobile app's register/forgot-
// password screens both accept either 09XXXXXXXXX or +639XXXXXXXXX as
// valid input (same regex, either format passes), but nothing anywhere
// normalized them to one form — so a patient who registered as
// "09171234567" and later typed "+639171234567" at login would get a
// silent "account not found" from an exact-match query, even with the
// correct password. This is applied consistently everywhere a phone
// number is stored or looked up (register, login, forgot-password).
const normalizePhone = (phone) => {
  if (!phone) return phone;
  const digits = phone.toString().trim().replace(/[^\d]/g, '');
  if (digits.startsWith('63') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
};

// The exact wording the mobile app relies on to recognize a phone-duplicate
// rejection (see register_screen.dart) — do not reword without updating
// that check too.
const PHONE_IN_USE_MESSAGE = 'This number is already in use, please use the number to login';

// POST /api/auth/register — Step 1 of phone-verified registration. Does NOT
// create a User/Patient yet — only a PendingRegistration, so an abandoned
// or never-verified signup never leaves a real account behind. The actual
// account is created in verifyOTP once the code is confirmed.
const register = async (req, res) => {
  try {
    const { fullName, email, phone, password, dateOfBirth, gender } = req.body;

    // Email is intentionally NOT required — patients without an email
    // (older patients in particular) must still be able to register with
    // just a phone number.
    if (!fullName || !password || !phone) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Full name, phone number, and password are required.',
      });
    }

    if (gender !== undefined && gender !== '' && !['Male', 'Female'].includes(gender)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Gender must be Male or Female.',
      });
    }

    const cleanPhone = normalizePhone(phone);
    const cleanEmail = email && email.trim() ? email.toLowerCase().trim() : null;

    // Backend/database-level duplicate prevention — this check plus the
    // unique index on User.phone (see models/User.js) is what actually
    // enforces uniqueness; the exact wording below is depended on by the
    // mobile app's error handling.
    const existingUser = await User.findOne({ phone: cleanPhone });
    if (existingUser) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: PHONE_IN_USE_MESSAGE,
      });
    }

    if (cleanEmail) {
      const existingEmail = await User.findOne({ email: cleanEmail });
      if (existingEmail) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'An account with this email already exists.',
        });
      }
    }

    const otpCode = generateOTPCode();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    // Upsert on phone rather than always creating a new document — if the
    // same phone already has a pending (unverified) registration, e.g. the
    // first SMS never arrived and the patient is trying again, this
    // replaces it with a fresh OTP instead of permanently blocking that
    // phone number until the old pending record's TTL expires.
    const pending = await PendingRegistration.findOneAndUpdate(
      { phone: cleanPhone },
      {
        fullName: fullName.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        password, // plain — see PendingRegistration.js for why
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        gender: gender || '',
        otp: otpCode,
        otpExpires,
        createdAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Actually send the code via Semaphore SMS. sendSMS() itself falls back to a
    // console-only mock if SEMAPHORE_API_KEY isn't configured, so this is safe
    // to call in every environment.
    const smsResult = await sendOTP(cleanPhone, otpCode);

    if (!smsResult.mock && !smsResult.success) {
      console.error(`OTP SMS failed for ${cleanPhone}:`, smsResult.error);
      return res.status(HttpStatus.CREATED).json({
        success: true,
        message: `Registration started, but the SMS could not be sent (${smsResult.error || 'unknown error'}). Use the code below for now.`,
        userId: pending._id,
        phone: cleanPhone,
        devOtp: otpCode,
      });
    }

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: smsResult.mock
        ? 'Almost done! SMS is not configured, so check the server logs for your OTP.'
        : 'An OTP code has been sent to your phone. Enter it to finish creating your account.',
      userId: pending._id,
      phone: cleanPhone,
      ...(smsResult.mock ? { devOtp: otpCode } : {}),
    });
  } catch (err) {
    console.error('Register Error:', err.message);
    // A concurrent request racing past the pre-check above would hit
    // MongoDB's unique index instead — map that to the same friendly
    // message rather than a raw duplicate-key error.
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: field === 'email'
          ? 'An account with this email already exists.'
          : PHONE_IN_USE_MESSAGE,
      });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: err.message || 'Registration failed.',
    });
  }
};

// POST /api/auth/verify-otp — Step 2: verifies the code and, only now,
// actually creates the User + Patient records.
const verifyOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Registration ID and OTP code are required.',
      });
    }

    const pending = await PendingRegistration.findById(userId).select('+password');
    if (!pending) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'This registration request was not found or has expired. Please register again.',
      });
    }

    if (pending.otp !== otp.toString().trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Invalid OTP code. Please check your console log.',
      });
    }

    if (new Date() > new Date(pending.otpExpires)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'OTP code has expired. Please request a new one.',
      });
    }

    // Re-check uniqueness right before creating the account — closes the
    // (rare) race where another account claimed this phone/email in the
    // minutes between register() and this verification.
    const dupePhone = await User.findOne({ phone: pending.phone });
    if (dupePhone) {
      await PendingRegistration.findByIdAndDelete(pending._id);
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: PHONE_IN_USE_MESSAGE,
      });
    }
    if (pending.email) {
      const dupeEmail = await User.findOne({ email: pending.email });
      if (dupeEmail) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'An account with this email already exists.',
        });
      }
    }

    const user = await User.create({
      fullName: pending.fullName,
      email: pending.email || undefined, // undefined, not null — avoids
                                          // colliding with Mongo's sparse
                                          // unique index on a literal null
      phone: pending.phone,
      password: pending.password, // plain — User's pre-save hook hashes it once
      role: 'patient',
      isVerified: true, // just proved phone ownership via OTP
      isActive: true,
    });

    await Patient.create({
      user: user._id,
      fullName: user.fullName,
      email: user.email || '',
      phone: user.phone,
      dateOfBirth: pending.dateOfBirth,
      gender: pending.gender || '',
      patientType: 'Regular',
    });

    await PendingRegistration.findByIdAndDelete(pending._id);

    const token = signToken(user);

    // Same bug class as login()/getMe() before they were fixed:
    // user.toSafeObject() only returns User-schema fields, including its
    // own `gender` (which defaults to 'Male' for every account, since
    // patient registration only ever writes gender onto the Patient
    // document, never User). That meant the instant registration
    // completed, the response handed back a hardcoded 'Male' regardless
    // of what the patient actually selected — the mobile app's merge
    // logic then preferred that (wrong but non-empty) server value over
    // the correct one from the registration form. No extra query needed
    // here since we already have every Patient-level field from `pending`.
    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Account verified successfully!',
      token,
      user: {
        ...user.toSafeObject(),
        gender: pending.gender || '',
        dateOfBirth: pending.dateOfBirth,
        patientType: 'Regular',
      },
    });
  } catch (err) {
    console.error('Verify OTP Error:', err.message);
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: field === 'email'
          ? 'An account with this email already exists.'
          : PHONE_IN_USE_MESSAGE,
      });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Verification failed.',
    });
  }
};

// POST /api/auth/resend-otp — Resends a fresh OTP for a pending
// registration. A fresh code always overwrites (invalidates) the previous
// one, since both live in the same otp/otpExpires fields.
const resendOTP = async (req, res) => {
  try {
    const { userId } = req.body;
    const pending = await PendingRegistration.findById(userId);

    if (!pending) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'This registration request was not found or has expired. Please register again.',
      });
    }

    const otpCode = generateOTPCode();
    pending.otp = otpCode;
    pending.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await pending.save();

    const smsResult = await sendOTP(pending.phone, otpCode);

    if (!smsResult.mock && !smsResult.success) {
      console.error(`Resend OTP SMS failed for ${pending.phone}:`, smsResult.error);
      return res.status(HttpStatus.OK).json({
        success: true,
        message: `Code regenerated, but the SMS could not be sent (${smsResult.error || 'unknown error'}). Use the code below for now.`,
        devOtp: otpCode,
      });
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      message: smsResult.mock
        ? 'A fresh OTP code has been generated. SMS is not configured, so check the server logs.'
        : 'A fresh OTP code has been sent to your phone.',
      ...(smsResult.mock ? { devOtp: otpCode } : {}),
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to resend OTP.',
    });
  }
};

// POST /api/auth/login — Authenticates with EITHER phone or email, since
// email is optional at registration and a patient without one has no
// other way to log in. `identifier` is preferred; `email`/`phone` are
// still accepted individually for older clients.
const login = async (req, res) => {
  try {
    const { identifier, email, phone, password } = req.body;
    const raw = (identifier || phone || email || '').toString().trim();

    if (!raw || !password) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Phone number (or email) and password are required.',
      });
    }

    const looksLikeEmail = raw.includes('@');
    const query = looksLikeEmail
      ? { email: raw.toLowerCase() }
      : { phone: normalizePhone(raw) };

    const user = await User.findOne(query).select('+password');
    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: looksLikeEmail ? 'Invalid email or password.' : 'Invalid phone number or password.',
      });
    }

    if (!user.isActive) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.',
      });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: looksLikeEmail ? 'Invalid email or password.' : 'Invalid phone number or password.',
      });
    }

    // Unverified patient accounts must complete OTP verification before they
    // can log in — this used to auto-verify on login, which silently bypassed
    // phone verification entirely. userId is returned so the app can route
    // straight back to the OTP screen instead of asking the user to register again.
    if (!user.isVerified) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'Please verify your phone number before logging in.',
        userId: user._id,
        phone: user.phone,
        requiresVerification: true,
      });
    }

    const token = signToken(user);

    // Only admin/staff logins go to the audit trail — logging every patient
    // login would drown out the actions the audit log exists to surface.
    if (['super_admin', 'facility_admin', 'staff'].includes(user.role)) {
      await logAction({
        actor: user,
        action: 'login',
        targetType: 'User',
        targetId: user._id,
        targetLabel: user.fullName,
        clinicId: user.clinicId,
      });
    }

    // Patient-specific fields (dateOfBirth, gender, patientType, etc.) live
    // on the linked Patient document. This used to select only
    // dateOfBirth — see the matching fix in getMe() for why that mattered:
    // login() is the ONLY data source AppState.login() uses (it doesn't
    // call refreshProfile() afterward), so gender/patientType/age/PhilHealth/
    // HMO were structurally unable to reach the app on a fresh login.
    let patientProfile = null;
    if (user.role === 'patient') {
      patientProfile = await Patient.findOne({ user: user._id })
        .select('dateOfBirth gender age patientType philHealthNumber hmoProvider');
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      token,
      user: {
        _id: user._id,
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        clinicId: user.clinicId || null,
        isVerified: user.isVerified,
        dateOfBirth: patientProfile?.dateOfBirth || null,
        gender: patientProfile?.gender || '',
        age: patientProfile?.age ?? null,
        patientType: patientProfile?.patientType || 'Regular',
        philHealthNumber: patientProfile?.philHealthNumber || '',
        hmoNumber: patientProfile?.hmoProvider || '',
      },
    });
  } catch (err) {
    console.error('Login Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Login failed.',
    });
  }
};

// ── Forgot Password ─────────────────────────────────────────────────────────
// Step 1: POST /api/auth/forgot-password { phone } — sends an OTP to a
// registered phone number. Upserts on phone, so requesting a new code
// always invalidates any code issued by a previous request (same pattern
// as PendingRegistration's registration OTP).
const forgotPassword = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !phone.trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Phone number is required.',
      });
    }
    const cleanPhone = normalizePhone(phone);

    const user = await User.findOne({ phone: cleanPhone });
    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'No account found with that phone number.',
      });
    }

    const otpCode = generateOTPCode();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    const reset = await PasswordReset.findOneAndUpdate(
      { phone: cleanPhone },
      {
        user: user._id,
        phone: cleanPhone,
        otp: otpCode,
        otpExpires,
        resetToken: null,
        resetTokenExpires: null,
        createdAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const smsResult = await sendOTP(cleanPhone, otpCode);

    if (!smsResult.mock && !smsResult.success) {
      console.error(`Password reset OTP SMS failed for ${cleanPhone}:`, smsResult.error);
      return res.status(HttpStatus.OK).json({
        success: true,
        message: `Code generated, but the SMS could not be sent (${smsResult.error || 'unknown error'}). Use the code below for now.`,
        resetId: reset._id,
        devOtp: otpCode,
      });
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      message: smsResult.mock
        ? 'SMS is not configured, so check the server logs for your reset code.'
        : 'A verification code has been sent to your phone.',
      resetId: reset._id,
      ...(smsResult.mock ? { devOtp: otpCode } : {}),
    });
  } catch (err) {
    console.error('Forgot Password Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to send reset code.',
    });
  }
};

// Step 2: POST /api/auth/verify-reset-otp { resetId, otp } — consumes the
// OTP (can't be reused) and issues a short-lived resetToken that
// authorizes the actual password change in step 3.
const verifyResetOtp = async (req, res) => {
  try {
    const { resetId, otp } = req.body;
    if (!resetId || !otp) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Reset ID and OTP code are required.',
      });
    }

    const reset = await PasswordReset.findById(resetId);
    if (!reset) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'This reset request was not found or has expired. Please start over.',
      });
    }

    if (!reset.otp) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'This code has already been used. Please request a new one.',
      });
    }

    if (reset.otp !== otp.toString().trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Invalid OTP code.',
      });
    }

    if (new Date() > new Date(reset.otpExpires)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'OTP code has expired. Please request a new one.',
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    reset.otp = null; // consumed — cannot be reused
    reset.otpExpires = null;
    reset.resetToken = resetToken;
    reset.resetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    await reset.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Code verified. You can now set a new password.',
      resetId: reset._id,
      resetToken,
    });
  } catch (err) {
    console.error('Verify Reset OTP Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Verification failed.',
    });
  }
};

// Step 3: POST /api/auth/reset-password { resetId, resetToken, newPassword }
const resetPassword = async (req, res) => {
  try {
    const { resetId, resetToken, newPassword } = req.body;
    if (!resetId || !resetToken || !newPassword) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Reset session and new password are required.',
      });
    }

    const reset = await PasswordReset.findById(resetId).select('+resetToken');
    if (!reset || !reset.resetToken) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'This reset session is no longer valid. Please start over.',
      });
    }
    if (reset.resetToken !== resetToken) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Invalid reset session. Please start over.',
      });
    }
    if (new Date() > new Date(reset.resetTokenExpires)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'This reset session has expired. Please start over.',
      });
    }

    const user = await User.findById(reset.user);
    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'Account not found.',
      });
    }

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    // Fully consumed — remove rather than just flag, so nothing lingers
    // that could be replayed.
    await PasswordReset.findByIdAndDelete(reset._id);

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Password updated successfully. You can now log in.',
    });
  } catch (err) {
    console.error('Reset Password Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to reset password.',
    });
  }
};

// GET /api/auth/me — Retrieves authenticated user profile
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('clinicId', 'name');
    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'User not found.',
      });
    }

    // Patient-specific fields (dateOfBirth, gender, patientType, etc.) live
    // on the linked Patient document, not User. This used to select only
    // dateOfBirth, so gender/patientType/age/PhilHealth/HMO could never
    // actually reach the mobile app's Profile screen through this endpoint
    // — those fields only appeared when copied over from local/in-memory
    // state, not from a genuine fresh fetch (e.g. a new session/device).
    let patientProfile = null;
    if (user.role === 'patient') {
      patientProfile = await Patient.findOne({ user: user._id })
        .select('dateOfBirth gender age patientType philHealthNumber hmoProvider');
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      user: {
        _id: user._id,
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        clinicId: user.clinicId?._id || user.clinicId || null,
        clinicName: user.clinicId?.name || null,
        isVerified: user.isVerified,
        isActive: user.isActive,
        dateOfBirth: patientProfile?.dateOfBirth || null,
        gender: patientProfile?.gender || '',
        age: patientProfile?.age ?? null,
        patientType: patientProfile?.patientType || 'Regular',
        philHealthNumber: patientProfile?.philHealthNumber || '',
        hmoNumber: patientProfile?.hmoProvider || '',
      },
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to fetch user profile.',
    });
  }
};

// POST /api/auth/logout — Records a logout event for the audit trail.
// The JWT itself is stateless and expires on its own; this endpoint's only
// job is accountability, not invalidating the token.
const logout = async (req, res) => {
  try {
    if (['super_admin', 'facility_admin', 'staff'].includes(req.user.role)) {
      await logAction({
        actor: req.user,
        action: 'logout',
        targetType: 'User',
        targetId: req.user._id,
        targetLabel: req.user.fullName,
        clinicId: req.user.clinicId,
      });
    }
    return res.status(HttpStatus.OK).json({ success: true, message: 'Logged out.' });
  } catch (err) {
    return res.status(HttpStatus.OK).json({ success: true, message: 'Logged out.' });
  }
};

module.exports = {
  register,
  verifyOTP,
  resendOTP,
  login,
  logout,
  getMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};