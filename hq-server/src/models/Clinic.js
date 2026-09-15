/**
 * Clinic model — health facility
 */
const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema(
  {
    name:            { type: String, required: true, trim: true },
    description:     { type: String, default: '' },
    durationMinutes: { type: Number, default: 30 },
    isAvailable:     { type: Boolean, default: true },
  },
  { _id: true }
);

const PeakHourSchema = new mongoose.Schema(
  { hour: { type: String }, load: { type: Number, default: 0 } },
  { _id: false }
);

const ClinicSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    address:       { type: String, default: '' },
    city:          { type: String, default: '' },
    province:      { type: String, default: '' },
    region:        { type: String, default: 'NCR' },
    
    // Geolocation Coordinates
    latitude:      { type: Number, default: 0 },
    longitude:     { type: Number, default: 0 },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },
    // Google place_id for the geocoded address — safe to store indefinitely
    // (unlike raw lat/lng) and lets us re-geocode later without asking the
    // admin to re-enter the address.
    googlePlaceId: { type: String, default: null },

    contactNumber: { type: String, default: '' },
    email:         { type: String, default: '' },
    facilityType:  { type: String, default: 'Private Clinic' },
    operatingHours:{ type: String, default: '8:00 AM - 5:00 PM' },
    
    // Embedded services
    services: [ServiceSchema],
    
    status: {
      type: String,
      enum: ['open', 'closed', 'busy', 'maintenance', 'active', 'inactive'],
      default: 'open',
      set: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
    },
    maxQueueCapacity:     { type: Number, default: 100 },
    acceptsWalkIn:        { type: Boolean, default: true },
    acceptsAppointment:   { type: Boolean, default: true },
    
    // Live queue stats
    queueLength:          { type: Number, default: 0 },
    currentWaitingTime:   { type: Number, default: 0 },
    baseWaitTimePerPerson:{ type: Number, default: 10 },

    // ─── Staff-Applied Wait-Time Override (Capstone Requirement #1) ──────────
    // null = system uses the live server-computed suggestion automatically
    // (queueHelpers.estimateWaitTime). Once staff "applies" a suggested
    // waiting time (tablet), this is set and becomes the single operational
    // number every client (mobile/tablet/web) is shown — until staff clears
    // it or applies a new one. Rejecting a suggestion never touches this.
    waitTimeOverrideMinutes: { type: Number, default: null },
    waitTimeOverrideSetAt:   { type: Date, default: null },
    waitTimeOverrideSetBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ─── Priority Scheduling Ratio (Capstone Requirement #4) ─────────────────
    // Configurable priority:regular serving ratio so a clinic isn't hard-coded
    // to one policy. Default 1:3 — see queueHelpers.orderQueueByPriorityRatio
    // for the scheduling algorithm and docs/analysis for the reasoning.
    priorityRatio: {
      priority: { type: Number, default: 1, min: 1 },
      regular:  { type: Number, default: 3, min: 1 },
    },

    // AI forecasting
    peakHours: [PeakHourSchema],
    
    // Admin link
    facilityAdmin:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

ClinicSchema.index({ name: 1 });
ClinicSchema.index({ city: 1, isActive: 1 });
ClinicSchema.index({ location: '2dsphere' }); // Geo-spatial index for nearest clinic detection

module.exports = mongoose.model('Clinic', ClinicSchema);