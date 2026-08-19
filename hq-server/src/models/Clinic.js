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

    contactNumber: { type: String, default: '' },
    email:         { type: String, default: '' },
    facilityType:  { type: String, default: 'Private Clinic' },
    operatingHours:{ type: String, default: '8:00 AM - 5:00 PM' },
    
    // Embedded services
    services: [ServiceSchema],
    
    status: {
      type: String,
      enum: ['Open', 'Closed', 'Busy', 'Maintenance', 'Active', 'Inactive'],
      default: 'Open',
    },
    maxQueueCapacity:     { type: Number, default: 100 },
    acceptsWalkIn:        { type: Boolean, default: true },
    acceptsAppointment:   { type: Boolean, default: true },
    
    // Live queue stats
    queueLength:          { type: Number, default: 0 },
    currentWaitingTime:   { type: Number, default: 0 },
    baseWaitTimePerPerson:{ type: Number, default: 10 },
    
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