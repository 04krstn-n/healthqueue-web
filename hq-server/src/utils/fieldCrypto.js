/**
 * AES-256-GCM encryption for sensitive files/fields stored in MongoDB
 * (currently: patient ID / certificate photos — see models/IdPhoto.js).
 *
 * Key: DATA_ENCRYPTION_KEY environment variable, 32 bytes given as 64 hex
 * characters (generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * ). Keep it in Heroku config vars / .env, never in the source code.
 *
 * If the key is not set the data is stored unencrypted and a warning is
 * logged once, so a missing variable never breaks uploads. In production you
 * should always set it.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
let warned = false;

const getKey = () => {
  const raw = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  }
  return Buffer.from(raw, 'hex');
};

const isEncryptionConfigured = () => {
  try { return Boolean(getKey()); } catch (_) { return false; }
};

/** -> { data, iv, tag, encrypted } */
const encryptBuffer = (plain) => {
  const key = getKey();
  if (!key) {
    if (!warned) {
      console.warn('[fieldCrypto] DATA_ENCRYPTION_KEY not set — sensitive files are stored UNENCRYPTED.');
      warned = true;
    }
    return { data: plain, iv: null, tag: null, encrypted: false };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data, iv, tag: cipher.getAuthTag(), encrypted: true };
};

/** Reverses encryptBuffer. Throws if the data was tampered with or the key is wrong. */
const decryptBuffer = ({ data, iv, tag, encrypted }) => {
  if (!encrypted) return Buffer.from(data);
  const key = getKey();
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is required to read encrypted data.');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(data)), decipher.final()]);
};

module.exports = { encryptBuffer, decryptBuffer, isEncryptionConfigured };
