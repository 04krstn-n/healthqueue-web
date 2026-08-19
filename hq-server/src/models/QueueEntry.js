/**
 * QueueEntry model — one entry per patient per clinic visit
 * Collection: queueentries (Mongoose default)
 * Status flow: waiting → serving → completed (done) | no_show | skipped | cancelled
 */
const mongoose = require('mongoose');

const QueueEntrySchema = new mongoose.Schema(
  {
    // Primary clinic reference (ObjectId)
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    // Patient user reference
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Denormalized patient info (for quick display without populate)
    patientName:  { type: String, required: true, trim: true },
    patientPhone: { type: String, default: '' },
    patientType: {
      type: String,
      enum: ['Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority'],
      default: 'Regular',
    },
    
    // Queue info
    queueNumber: { type: String, required: true },
    serviceName: { type: String, required: true },
    serviceId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    queueType:   { type: String, enum: ['Regular', 'Priority'], default: 'Regular' },
    priority:    { type: Boolean, default: false },
    notes:       { type: String, default: '' },

    // Status
    status: {
      type: String,
      enum: ['Waiting', 'Serving', 'Done', 'Completed', 'No_show', 'Skipped', 'Cancelled'],
      default: 'Waiting',
      index: true,
    },

    // ─── En-Route Queueing & Grace Period (Capstone Requirement) ─────────────
    joinedRemotely: {
      type: Boolean,
      default: false,
    },
    gracePeriodExpiresAt: {
      type: Date, // Set to Date.now() + 5 minutes when patient is called
      default: null,
    },

    // ─── Operational Timestamps ──────────────────────────────────────────────
    joinedAt:    { type: Date, default: Date.now, index: true },
    calledAt:    { type: Date, default: null },
    servedAt:    { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    // ─── Wait & Performance Metrics (in minutes) ─────────────────────────────
    estimatedWaitMinutes: { type: Number, default: 0 },
    positionAtJoin:       { type: Number, default: 0 },
    
    // Actual computed metrics for OpenAI & Analytics
    waitTimeInMinutes: { 
      type: Number, 
      default: 0 
    },
    turnaroundTimeInMinutes: { 
      type: Number, 
      default: 0 
    },
  },
  { timestamps: true }
);

// Indexes for fast lookup
QueueEntrySchema.index({ clinic: 1, joinedAt: 1, status: 1 });
QueueEntrySchema.index({ patient: 1, status: 1 });

// ─── Pre-Save Calculation Hook ────────────────────────────────────────────────
QueueEntrySchema.pre('save', function (next) {
  // 1. Calculate actual wait time once serving/called
  const startTime = this.servedAt || this.calledAt;
  if (startTime && this.joinedAt) {
    const diffMs = startTime.getTime() - this.joinedAt.getTime();
    this.waitTimeInMinutes = Math.max(0, Math.round(diffMs / (1000 * 60)));
  }

  // 2. Calculate total Turnaround Time (TAT) when status is 'completed' or 'done'
  const isFinished = this.status === 'Completed' || this.status === 'Done';
  const finishTime = this.completedAt || new Date();

  if (isFinished && this.joinedAt) {
    const totalMs = finishTime.getTime() - this.joinedAt.getTime();
    this.turnaroundTimeInMinutes = Math.max(0, Math.round(totalMs / (1000 * 60)));
  }

  next();
});

module.exports = mongoose.model('QueueEntry', QueueEntrySchema);