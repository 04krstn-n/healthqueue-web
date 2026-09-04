const express = require('express');
const router = express.Router();
const {
  register, verifyOTP, resendOTP, login, logout, getMe,
  forgotPassword, verifyResetOtp, resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public Authentication
router.post('/register', register);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);
router.post('/login', login);

// Forgot Password (public — phone-verified, not session-authenticated)
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

// Authenticated Account Context
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

module.exports = router;