/**
 * Counter — backs atomic sequence generation (currently just queue
 * numbers). See utils/queueHelpers.js's getNextQueueNumber for why this
 * exists: MongoDB's findOneAndUpdate with $inc is a single atomic
 * operation, so two requests arriving at the same instant can never be
 * handed the same sequence value — unlike the previous "count existing
 * entries, then use count+1" approach, which had a real race window
 * between counting and the new entry actually being saved.
 *
 * _id is a composite key (e.g. "<clinicId>_<YYYY-MM-DD>_<prefix>") so the
 * sequence naturally resets to 1 each day per clinic+prefix, matching the
 * daily-reset behavior the old count-based approach already had.
 */
const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', CounterSchema);
