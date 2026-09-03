/**
 * PasswordReset — backs the forgot-password flow: phone -> OTP -> new
 * password. One active reset request per phone number at a time (upserted
 * on each forgot-password call, so requesting a new code always
 * invalidates whatever code was issued before it).
 *
 * Two-stage token model:
 *   1. `otp` / `otpExpires` — the 6-digit code texted to the user. Cleared
 *      the moment it's successfully verified, so it can never be reused.
 *   2. `resetToken` / `resetTokenExpires` — issued only after step 1
 *      succeeds; the actual "set new password" call is authorized by this
 *      token, not by re-submitting the OTP (which is already consumed by
 *      then). This is the standard reason to split "verify" and "set new
 *      password" into two calls instead of one: the OTP proves phone
 *      ownership once; the reset token is what actually authorizes the
 *      password change afterward.
 */
const mongoose = require('mongoose');

const PasswordResetSchema = new mongoose.Schema({
  user:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone:             { type: String, required: true, unique: true, trim: true, index: true },
  otp:               { type: String, default: null },
  otpExpires:        { type: Date, default: null },
  resetToken:        { type: String, default: null, select: false },
  resetTokenExpires: { type: Date, default: null },
  createdAt:         { type: Date, default: Date.now },
});

// TTL safety net — an abandoned reset request (OTP never entered, or the
// new-password step never completed) is cleaned up automatically rather
// than leaving a stale reset session around indefinitely.
PasswordResetSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });

module.exports = mongoose.model('PasswordReset', PasswordResetSchema);
