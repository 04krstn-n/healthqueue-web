/**
 * PendingRegistration — holds a patient's registration data (including
 * their password) while they verify their phone via OTP. No User/Patient
 * document is created until verifyOTP succeeds — this was previously not
 * the case (the account was created immediately, unverified, at the start
 * of registration), which meant an abandoned or never-verified signup still
 * left a real account sitting in the database.
 *
 * The password is stored as a bcrypt hash (authController.register hashes it
 * before saving). When the account is created, verifyOTP sets
 * user.$locals.passwordAlreadyHashed so User's pre-save hook does not hash it
 * a second time. The record is deleted on successful verification and
 * TTL-expired otherwise (see the index below).
 */
const mongoose = require('mongoose');

const PendingRegistrationSchema = new mongoose.Schema({
  fullName:    { type: String, required: true, trim: true },
  email:       { type: String, default: null, lowercase: true, trim: true },
  phone:       { type: String, required: true, unique: true, trim: true, index: true },
  password:    { type: String, required: true, select: false },
  dateOfBirth: { type: Date, default: null },
  gender:      { type: String, default: '' },
  otp:         { type: String, default: null },
  otpExpires:  { type: Date, default: null },
  // Server-side brute-force guard for verifyOTP — see MAX_OTP_ATTEMPTS in
  // authController.js. Reset to 0 whenever a fresh OTP is issued (register
  // upsert or resendOTP), since a new code deserves a fresh set of tries.
  otpAttempts: { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now },
});

// TTL safety net: if a registration is never verified (SMS never arrived,
// user gave up, etc.), the pending record — and the phone number it was
// holding — is automatically freed up after 15 minutes rather than
// blocking that number from ever being used to register again.
PendingRegistrationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });

module.exports = mongoose.model('PendingRegistration', PendingRegistrationSchema);
