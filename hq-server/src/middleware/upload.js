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

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'patient-type-requests');

// Memory storage: the controller validates the bytes, encrypts them and
// saves them to MongoDB (models/IdPhoto.js). Nothing is written to disk,
// because Heroku's disk is wiped on every restart. uploadDir is kept only so
// photos uploaded before this change can still be read.
const storage = multer.memoryStorage();

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
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8MB, one photo
});

/**
 * Checks the file's first bytes ("magic number") — unlike the mimetype or
 * extension, these can't be faked by renaming a file. Returns the real
 * image type, or null if the bytes are not a supported image.
 */
const detectImageType = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  return null;
};

module.exports = { uploadIdPhoto, uploadDir, detectImageType };
