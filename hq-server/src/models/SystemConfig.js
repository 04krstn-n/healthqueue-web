/**
 * SystemConfig model — key/value system settings
 */
const mongoose = require('mongoose');

const SystemConfigSchema = new mongoose.Schema(
  {
    key:         { type: String, required: true, unique: true, trim: true },
    value:       { type: mongoose.Schema.Types.Mixed, required: true },
    label:       { type: String, default: '' },
    description: { type: String, default: '' },
    group:       { type: String, default: 'General' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SystemConfig', SystemConfigSchema);