/**
 * InsightsLog Model — Stores AI Prescriptive Recommendations & User Choice
 * Collection: insightslogs (Mongoose default)
 * Used for evaluation of system effectiveness (ISO/IEC 25010)
 */
const mongoose = require('mongoose');

const InsightsLogSchema = new mongoose.Schema(
  {
    // Patient who received the insight
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Patient's geographic location when recommendation was requested
    patientLocation: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },

    // ─── OpenAI Generated Outputs ─────────────────────────────────────────────
    recommendedClinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    recommendationType: {
      type: String,
      enum: ['nearest', 'lowest_wait_time', 'balanced'],
      default: 'lowest_wait_time',
    },
    aiExplanation: {
      type: String, // OpenAI natural language response explaining why this clinic was chosen
      required: true,
    },

    // ─── Evaluated Metrics Provided to AI ─────────────────────────────────────
    evaluatedClinics: [
      {
        clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
        distanceKm: { type: Number },
        estimatedWaitMinutes: { type: Number },
        activeQueueCount: { type: Number },
      },
    ],

    // ─── Patient Choice & Compliance Tracking (Thesis Metric) ───────────────
    selectedClinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic', // Updated when patient actually joins a queue
      default: null,
    },
    followedRecommendation: {
      type: Boolean, // Automatically set to true if selectedClinic matches recommendedClinic
      default: false,
    },
    actionTakenAt: {
      type: Date, // Timestamp when patient enrolled in a queue after seeing the insight
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes for fast lookup during analytics generation
InsightsLogSchema.index({ patient: 1, createdAt: -1 });
InsightsLogSchema.index({ followedRecommendation: 1 });

module.exports = mongoose.model('InsightsLog', InsightsLogSchema);