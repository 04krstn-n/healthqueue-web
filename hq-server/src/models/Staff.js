/**
 * Staff model (linked to a User account with role='staff')
 */
const mongoose = require('mongoose');

const ScheduleSlotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
      required: true,
    },
    startTime:  { type: String, required: true }, // e.g. "08:00"
    endTime:    { type: String, required: true },   // e.g. "17:00"
    isAvailable:{ type: Boolean, default: true },
  },
  { _id: false }
);

const StaffSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    fullName:      { type: String, required: true, trim: true },
    email:         { type: String, required: true, lowercase: true, trim: true },
    gender:        { type: String, default: '' },
    phone:         { type: String, default: '' },
    role: {
      type: String,
      enum: ['doctor','nurse','midwife','med_tech','pharmacist','admin','staff'],
      default: 'staff',
    },
    position:      { type: String, default: 'Healthcare Staff' },
    specialization:{ type: String, default: '' },
    licenseNumber: { type: String, default: '' },
    schedule:      [ScheduleSlotSchema],
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Staff', StaffSchema);