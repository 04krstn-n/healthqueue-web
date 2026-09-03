/**
 * PendingRegistration — holds a patient's registration data (including
 * their password) while they verify their phone via OTP. No User/Patient
 * document is created until verifyOTP succeeds — this was previously not
 * the case (the account was created immediately, unverified, at the start
 * of registration), which meant an abandoned or never-verified signup still
 * left a real account sitting in the database.
 *
 * The password is stored in plain text here, not pre-hashed — this is
 * intentional, not an oversight: User's pre-save hook hashes `password`
 * whenever it's a modified field, which is unconditionally true for a
 * brand-new document. Pre-hashing here and passing the hash through to
 * User.create() would hash it a second time, silently breaking login. This
 * document is short-lived (deleted immediately on successful verification,
 * and TTL-expired otherwise — see the index below), the same tradeoff any
 * "pending signup" flow with a deferred password hash makes.
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
  createdAt:   { type: Date, default: Date.now },
});

// TTL safety net: if a registration is never verified (SMS never arrived,
// user gave up, etc.), the pending record — and the phone number it was
// holding — is automatically freed up after 15 minutes rather than
// blocking that number from ever being used to register again.
PendingRegistrationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });

module.exports = mongoose.model('PendingRegistration', PendingRegistrationSchema);
