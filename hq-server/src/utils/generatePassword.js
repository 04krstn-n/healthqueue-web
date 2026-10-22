/**
 * Cryptographically-random password that always satisfies the server's
 * password policy (8+, upper, lower, number, special). Used only when the
 * system administrator creates an account: nobody types it, it goes straight
 * to the new user's verified email, and the account must change it on first
 * login. Ambiguous characters (0/O, 1/l/I) are left out so it can be read
 * from an email without mistakes.
 */
const crypto = require('crypto');

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const SPECIAL = '!@#$%&*?';
const ALL = UPPER + LOWER + DIGIT + SPECIAL;

const pick = (set) => set[crypto.randomInt(0, set.length)];

const generatePassword = (length = 12) => {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher–Yates shuffle with a CSPRNG so the guaranteed characters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

module.exports = { generatePassword };
