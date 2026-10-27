/**
 * RevokedToken — login tokens that were ended by logging out (S9).
 *
 * A JWT stays valid until it expires, so without this a token copied before
 * logout could still call the API afterwards. On logout the token's unique
 * id (jti) is stored here; middleware/auth.js refuses any token whose jti is
 * listed. MongoDB deletes each row automatically once the token would have
 * expired anyway (TTL index), so the collection never grows unbounded.
 */
const mongoose = require('mongoose');

const RevokedTokenSchema = new mongoose.Schema({
  jti:       { type: String, required: true, unique: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  expiresAt: { type: Date, required: true },
});

RevokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RevokedToken', RevokedTokenSchema);
