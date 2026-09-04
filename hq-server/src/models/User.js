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
      required: false,
      unique: true,
      sparse: true, // allows many documents to have no email at all —
                     // without `sparse`, a plain unique index treats every
                     // missing/null email as a duplicate of every other,
                     // which would let only ONE emailless patient ever
                     // register.
      lowercase: true,
      trim: true,
      index: true,
    },
    // Not required at the schema level — staff/admin accounts and
    // walk-in patient records created by staff don't always collect a
    // phone number (see userController/staffController/patientController).
    // Patient self-registration enforces "phone is required" itself, at
    // the controller level (authController.register), since that
    // requirement is specific to that flow, not every User document.
    phone: {
      type: String,
      unique: true,
      sparse: true, // lets multiple staff/admin/walk-in-patient records
                     // omit phone without colliding with each other on
                     // this index — as long as the field is truly
                     // missing (undefined), not an empty string; see the
                     // matching `|| undefined` fix in those controllers.
      trim: true,
      index: true,
    },
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