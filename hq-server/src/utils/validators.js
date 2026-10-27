/**
 * Shared server-side input validators (panel recommendation: "apply data
 * validation across all modules"). The apps validate too, but the server is
 * the authority: a request sent straight to the API must be checked the same
 * way.
 */
const mongoose = require('mongoose');

// Canonical PH mobile number after normalizePhone(): 09 + 9 digits.
const PH_MOBILE_RE = /^09\d{9}$/;
const PHONE_FORMAT_MESSAGE = 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).';

/** Normalizes any accepted PH mobile format to 09XXXXXXXXX. */
const normalizePhone = (phone) => {
  if (phone === undefined || phone === null) return phone;
  const digits = String(phone).trim().replace(/[^\d]/g, '');
  if (digits.startsWith('63') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
};

const isValidPHMobile = (normalized) => typeof normalized === 'string' && PH_MOBILE_RE.test(normalized);

const isObjectId = (v) =>
  (typeof v === 'string' || v instanceof mongoose.Types.ObjectId) && mongoose.Types.ObjectId.isValid(String(v))
  && /^[a-f\d]{24}$/i.test(String(v));

/** Escapes user text so it can be used inside a RegExp literally. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plain string check with length bounds (trimmed). */
const isNonEmptyString = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

/**
 * For optional phone fields on admin/staff/patient forms.
 *   undefined           -> { ok: true, provided: false }   (field not sent)
 *   '' / null           -> { ok: true, provided: true, value: '' } (clear it)
 *   anything else       -> normalized and format-checked
 */
const checkOptionalPhone = (value) => {
  if (value === undefined) return { ok: true, provided: false };
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return { ok: true, provided: true, value: '' };
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { ok: false, message: PHONE_FORMAT_MESSAGE };
  }
  const normalized = normalizePhone(value);
  return isValidPHMobile(normalized)
    ? { ok: true, provided: true, value: normalized }
    : { ok: false, message: PHONE_FORMAT_MESSAGE };
};

module.exports = {
  checkOptionalPhone,
  PH_MOBILE_RE,
  PHONE_FORMAT_MESSAGE,
  normalizePhone,
  isValidPHMobile,
  isObjectId,
  escapeRegex,
  isNonEmptyString,
};
