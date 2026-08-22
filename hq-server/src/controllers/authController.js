/**
 * Auth Controller — Registration (Dev/Mock OTP), verification, login, and profile
 */
const User = require('../models/User');
const Patient = require('../models/Patient');
const { signToken } = require('../utils/token');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');

/**
 * Generates a 6-digit OTP code
 */
const generateOTPCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// POST /api/auth/register — Patient self-registration with Mock SMS OTP
const register = async (req, res) => {
  try {
    const { fullName, email, phone, password, dateOfBirth } = req.body;
    if (!fullName || !email || !password || !phone) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Name, email, phone number, and password are required.',
      });
    }

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    // Generate 6-Digit OTP (Expires in 5 minutes)
    const otpCode = generateOTPCode();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    const user = await User.create({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password, // Pre-save hook hashes it
      role: 'patient',
      otp: otpCode,
      otpExpires,
      isVerified: false, // Must verify OTP first
      isActive: true,
    });

    // Create linked Patient profile
    await Patient.create({
      user: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      patientType: 'Regular',
    });

    // Console log the OTP for local development testing
    console.log(`\n==================================================`);
    console.log(`📱 [DEV OTP MOCK] Verification Code for ${user.phone}: [ ${otpCode} ]`);
    console.log(`==================================================\n`);

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: 'Registration successful! An OTP code has been generated.',
      userId: user._id,
      phone: user.phone,
      // Included for mobile app testing without Semaphore SMS credits
      devOtp: otpCode, 
    });
  } catch (err) {
    console.error('Register Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: err.message || 'Registration failed.',
    });
  }
};

// POST /api/auth/verify-otp — Verifies mobile identity
const verifyOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'User ID and OTP code are required.',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'User account not found.',
      });
    }

    if (user.isVerified) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Account is already verified.',
      });
    }

    // Verify OTP Match & Expiry
    if (user.otp !== otp.toString().trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Invalid OTP code. Please check your console log.',
      });
    }

    if (new Date() > new Date(user.otpExpires)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'OTP code has expired. Please request a new one.',
      });
    }

    // Mark user as verified
    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    const token = signToken(user);

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Account verified successfully!',
      token,
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('Verify OTP Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Verification failed.',
    });
  }
};

// POST /api/auth/resend-otp — Resends fresh Mock OTP
const resendOTP = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: 'User not found.',
      });
    }

    const otpCode = generateOTPCode();
    user.otp = otpCode;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    console.log(`\n==================================================`);
    console.log(`📱 [DEV RESEND OTP] New Code for ${user.phone}: [ ${otpCode} ]`);
    console.log(`==================================================\n`);

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'A fresh OTP code has been generated. Check server logs.',
      devOtp: otpCode,
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to resend OTP.',
    });
  }
};

// POST /api/auth/login — Authenticates credentials
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid email or password.',
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
        message: 'Invalid email or password.',
      });
    }

    // Auto-verify seeded/demo accounts if needed
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
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
};