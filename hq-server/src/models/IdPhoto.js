/**
 * IdPhoto — the ID/certificate photo a patient submits with a
 * PatientTypeRequest (Senior Citizen / PWD / Pregnant).
 *
 * Stored in MongoDB instead of the server's disk: Heroku's filesystem is
 * temporary (wiped on every restart/deploy), so photos saved to disk
 * disappeared. The bytes are AES-256-GCM encrypted when DATA_ENCRYPTION_KEY
 * is set (utils/fieldCrypto.js). Max upload is 8 MB, well under MongoDB's
 * 16 MB document limit.
 */
const mongoose = require('mongoose');

const IdPhotoSchema = new mongoose.Schema(
  {
    owner:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mimeType:  { type: String, required: true },
    size:      { type: Number, required: true },
    data:      { type: Buffer, required: true, select: false },
    iv:        { type: Buffer, default: null, select: false },
    tag:       { type: Buffer, default: null, select: false },
    encrypted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('IdPhoto', IdPhotoSchema);
