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
    // NOTE: values match exactly what queueController.js writes (lowercase /
    // snake_case). Previously this enum was capitalized ('Waiting', 'Done',
    // 'Completed', etc.) and didn't even include 'called' as a valid value,
    // which caused ValidationErrors (500s) on any status transition that
    // goes through entry.save() (complete, cancel).
    status: {
      type: String,
      enum: ['waiting', 'serving', 'called', 'completed', 'skipped', 'no_show', 'cancelled', 'done'],
      default: 'waiting',
      index: true,
      set: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
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
    // ─── Metric definitions (Capstone Requirement #3 — Waiting vs Service vs TAT) ───
    // Waiting Time   = joinedAt  -> servedAt   (queue entry until staff actually starts serving)
    // Service Time   = servedAt  -> completedAt (staff starts serving until consultation ends)
    // Turnaround Time (TAT) = joinedAt -> completedAt (full end-to-end duration)
    // These are three DISTINCT durations. Waiting Time is deliberately NOT
    // derived from calledAt: "called" only means the patient's number was
    // announced / the 5-min grace period started, not that service began —
    // conflating the two used to make "wait time" jump around depending on
    // how long the grace period took instead of reflecting when the patient
    // actually started being served.
    waitTimeInMinutes: { 
      type: Number, 
      default: 0 
    },
    // NEW FIELD — did not exist before. Needed because TAT alone can't tell
    // staff/analytics whether a long visit was caused by a long queue wait
    // or a long consultation; without this, "improve TAT" had no way to
    // distinguish the two root causes (see item 3 of the request).
    serviceTimeInMinutes: {
      type: Number,
      default: 0,
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
// Historical analytics (item 6/7) query by clinic+service+date range a lot —
// this index makes those aggregations fast even as history accumulates.
QueueEntrySchema.index({ clinic: 1, serviceId: 1, joinedAt: -1 });

// ─── Pre-Save Calculation Hook ────────────────────────────────────────────────
QueueEntrySchema.pre('save', function (next) {
  // 1. Waiting Time: locked in the instant service actually starts (servedAt
  // set). Before that, we don't overwrite it here at all — the *live*
  // estimate shown to patients/staff while still waiting comes from
  // estimateWaitTime()/getMyQueueStatus, not from this stored field, so
  // there's exactly one place a "final" wait time gets written.
  if (this.servedAt && this.joinedAt) {
    const diffMs = this.servedAt.getTime() - this.joinedAt.getTime();
    this.waitTimeInMinutes = Math.max(0, Math.round(diffMs / (1000 * 60)));
  }

  // 2. Service Time: servedAt -> completedAt. Only meaningful once the
  // session is actually finished.
  const isFinished = this.status === 'completed' || this.status === 'done';
  if (isFinished && this.servedAt && this.completedAt) {
    const svcMs = this.completedAt.getTime() - this.servedAt.getTime();
    this.serviceTimeInMinutes = Math.max(0, Math.round(svcMs / (1000 * 60)));
  }

  // 3. Turnaround Time (TAT): full end-to-end joinedAt -> completedAt.
  if (isFinished && this.joinedAt) {
    const finishTime = this.completedAt || new Date();
    const totalMs = finishTime.getTime() - this.joinedAt.getTime();
    this.turnaroundTimeInMinutes = Math.max(0, Math.round(totalMs / (1000 * 60)));
  }

  next();
});

module.exports = mongoose.model('QueueEntry', QueueEntrySchema);