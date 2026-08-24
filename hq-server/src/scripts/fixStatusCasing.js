/**
 * One-time migration: lowercase any legacy `status` values left over from
 * before the enum casing change, so .save() / findByIdAndUpdate stop
 * throwing ValidationErrors on old records.
 *
 * Run once with:  node src/scripts/fixStatusCasing.js
 */
const mongoose = require('mongoose');
const { env } = require('../config/config');
const Clinic = require('../models/Clinic');
const Appointment = require('../models/Appointment');
const QueueEntry = require('../models/QueueEntry');

// snake_case targets that don't just fall out of a plain .toLowerCase()
const SPECIAL_CASES = {
  noshow: 'no_show',
  'no-show': 'no_show',
};

function normalize(value) {
  if (typeof value !== 'string') return value;
  const lower = value.toLowerCase().trim();
  return SPECIAL_CASES[lower] || lower;
}

async function fixCollection(Model, label) {
  const docs = await Model.find({}).select('status');
  let fixed = 0;

  for (const doc of docs) {
    const normalized = normalize(doc.status);
    if (normalized !== doc.status) {
      // Bypass full-document validation (that's exactly what's broken on
      // these docs right now) — write the corrected value directly.
      await Model.updateOne({ _id: doc._id }, { $set: { status: normalized } });
      fixed += 1;
      console.log(`  ${label} ${doc._id}: "${doc.status}" -> "${normalized}"`);
    }
  }

  console.log(`${label}: checked ${docs.length}, fixed ${fixed}`);
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected. Scanning for legacy status casing...\n');

  await fixCollection(Clinic, 'Clinic');
  await fixCollection(Appointment, 'Appointment');
  await fixCollection(QueueEntry, 'QueueEntry');

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
