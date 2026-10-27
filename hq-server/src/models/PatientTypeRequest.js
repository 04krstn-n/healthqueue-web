/**
 * PatientTypeRequest — a patient's self-submitted request to be verified as
 * Senior Citizen / PWD / Pregnant (which affects priority queue placement —
 * see queueController.joinQueue). Patients cannot set patientType directly
 * (see userController.updateMyPatientProfile); this is the proper channel:
 * staff review the submitted ID/certificate photo and approve or reject.
 */
const mongoose = require('mongoose');

const PatientTypeRequestSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requestedType: {
      type: String,
      enum: ['Senior Citizen', 'PWD', 'Pregnant'],
      required: true,
    },
    // Path on disk relative to the uploads root (see middleware/upload.js)
    // — never the absolute path, so the storage location can move without
    // a data migration.
    // New uploads: the photo lives in the IdPhoto collection (encrypted).
    idPhoto:     { type: mongoose.Schema.Types.ObjectId, ref: 'IdPhoto', default: null },
    // Older uploads saved to the server disk before IdPhoto existed.
    idPhotoPath: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote:  { type: String, default: '' },
    reviewedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PatientTypeRequest', PatientTypeRequestSchema);
