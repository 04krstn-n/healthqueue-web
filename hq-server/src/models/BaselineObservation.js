const mongoose = require('mongoose');

/**
 * A manually timed patient visit recorded BEFORE (or without) HealthQueue+,
 * e.g. a stopwatch/logbook observation at the clinic. These are the "before"
 * side of the before-and-after effectiveness comparison; the "after" side is
 * computed from real completed QueueEntry records.
 */
const BaselineObservationSchema = new mongoose.Schema(
  {
    clinic:         { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    observedAt:     { type: Date, required: true },
    waitMinutes:    { type: Number, required: true, min: 0, max: 600 },
    serviceMinutes: { type: Number, min: 0, max: 600, default: null },
    method:         { type: String, trim: true, default: 'manual logbook' },
    recordedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BaselineObservation', BaselineObservationSchema);
