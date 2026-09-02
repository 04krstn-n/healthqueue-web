/**
 * Multer disk-storage config for patient-submitted ID/certificate photos
 * (Senior Citizen / PWD / Pregnant patient-type requests). Requires the
 * `multer` package — not previously a dependency of this project, so run:
 *   npm install multer
 *
 * Files are stored outside any publicly-served static directory —
 * uploads/patient-type-requests/ is only ever read back through the
 * authenticated GET /api/patient-type-requests/:id/photo route (see
 * patientTypeRequestController.getRequestPhoto), never served directly,
 * since these are sensitive identity documents.
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'patient-type-requests');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const unique = `${req.user?._id || 'anon'}-${Date.now()}${ext}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const allowedExts  = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

  if (allowedMimes.includes(file.mimetype)) return cb(null, true);

  // Fall back to checking the extension when the mimetype is missing or
  // generic (e.g. 'application/octet-stream') — mobile clients don't
  // always set a reliable Content-Type per file part (camera-captured
  // photos in particular), so trusting the mimetype alone rejected
  // perfectly valid photos. The extension is still attacker-controllable,
  // same as the mimetype, so this isn't a security boundary either way —
  // it's just a better-effort filter than mimetype alone.
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (allowedExts.includes(ext)) return cb(null, true);

  cb(new Error('Only image files (JPEG, PNG, WEBP, HEIC) are allowed.'));
};

const uploadIdPhoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

module.exports = { uploadIdPhoto, uploadDir };
