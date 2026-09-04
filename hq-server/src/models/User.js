/**
 * User model
 * Roles:
 *   - super_admin    → web app only
 *   - facility_admin → web app only (scoped to one clinic)
 *   - staff          → tablet/mobile staff app only (scoped to one clinic)
 *   - patient        → mobile patient app only
 */
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone:    { type: String, trim: true, default: '' },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['super_admin', 'facility_admin', 'staff', 'patient'],
      default: 'patient',
      index: true,
    },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
    },
    otp:        { type: String,  default: null },
    otpExpires: { type: Date,    default: null },
    isVerified: { type: Boolean, default: false },
    isActive:   { type: Boolean, default: true },
    gender: { 
    type: String, 
    enum: ['Male', 'Female', 'Other', 'Prefer not to say'], 
    default: 'Male' 
  },
    specialization: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

// Hash password before saving — only when password field is modified
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare plain-text candidate password with stored hash
UserSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Return safe user object (no password)
UserSchema.methods.toSafeObject = function () {
  return {
    id:         this._id,
    _id:        this._id,
    fullName:   this.fullName,
    email:      this.email,
    phone:      this.phone,
    role:       this.role,
    clinicId:   this.clinicId,
    isVerified: this.isVerified,
    isActive:   this.isActive,
    gender:     this.gender,
    specialization: this.specialization,
    createdAt:  this.createdAt,
  };
};

module.exports = mongoose.model('User', UserSchema);