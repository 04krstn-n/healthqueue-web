/**
 * TimeSlot model — defines available appointment slots per clinic per service
 */
const mongoose = require('mongoose');

const TimeSlotSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    serviceId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    serviceName: { type: String, required: true },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Refers to User model
      default: null,
    },
    dayOfWeek:    { type: Number, min: 0, max: 6, default: null }, // 0=Sunday
    specificDate: { type: Date, default: null },
    startTime:    { type: String, required: true }, // "09:00"
    endTime:      { type: String, required: true },   // "09:30"
    label:        { type: String, required: true },     // "9:00 AM"
    maxPatients:  { type: Number, default: 1 },
    bookedCount:  { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

TimeSlotSchema.index({ clinic: 1, specificDate: 1, isActive: 1 });

module.exports = mongoose.model('TimeSlot', TimeSlotSchema);