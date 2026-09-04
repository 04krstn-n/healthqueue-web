/**
 * Appointment model — for private clinic appointment booking
 *
 * Status flow:
 *   pending → confirmed → arrived → serving → completed
 *                       → late
 *                       → no_show
 *                       → cancelled / rescheduled
 */
const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    // Fixed: Reference User model instead of Patient model
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Fixed: Reference User model for staff/doctor
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    
    // Service details
    serviceName: { type: String, required: true },
    serviceId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    
    // Appointment date and time
    appointmentDate: { type: Date, required: true, index: true },
    timeSlot:        { type: String, required: true }, // e.g. "09:00 AM"
    endTime:         { type: String, default: '' },      // e.g. "09:30 AM"
    
    // Patient info (denormalized for rapid display)
    patientName:  { type: String, required: true },
    patientPhone: { type: String, default: '' },
    patientType: {
      type: String,
      enum: ['Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority'],
      default: 'Regular',
    },
    status: {
      type: String,
      enum: [
        'pending',
        'confirmed',
        'arrived',
        'serving',
        'completed',
        'late',
        'no_show',
        'cancelled',
        'rescheduled',
      ],
      default: 'pending',
      index: true,
      set: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
    },
    reason: { type: String, default: '' },
    notes:  { type: String, default: '' },
    
    // Tracking reschedule history
    previousDate:     { type: Date, default: null },
    previousTimeSlot: { type: String, default: null },
    
    reminderSent: { type: Boolean, default: false },
    
    // Linked queue entry when patient checks in on-site
    queueEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QueueEntry',
      default: null,
    },
    
    // Timestamps
    confirmedAt:        { type: Date, default: null },
    arrivedAt:          { type: Date, default: null },
    completedAt:        { type: Date, default: null },
    cancelledAt:        { type: Date, default: null },
    cancelledBy:        { type: String, default: null }, // 'patient' | 'staff' | 'admin'
    cancellationReason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Appointment', AppointmentSchema);