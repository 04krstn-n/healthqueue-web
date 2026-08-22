/**
 * SystemConfig Controller — key/value system settings
 */
const SystemConfig = require('../models/SystemConfig');
const { logAction } = require('../utils/auditLog');

// GET /api/config
const getConfigs = async (req, res) => {
  try {
    const configs = await SystemConfig.find().sort({ group: 1, key: 1 });
    return res.json(configs);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to load system config.' });
  }
};

// GET /api/config/:key
const getConfig = async (req, res) => {
  try {
    const cfg = await SystemConfig.findOne({ key: req.params.key });
    if (!cfg) return res.status(404).json({ message: 'Config key not found.' });
    return res.json(cfg);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to load config.' });
  }
};

// PUT /api/config/:id
const updateConfig = async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ message: 'value is required.' });

    const cfg = await SystemConfig.findByIdAndUpdate(
      req.params.id,
      { value },
      { new: true, runValidators: true }
    );
    if (!cfg) return res.status(404).json({ message: 'Config not found.' });

    await logAction({
      actor: req.user,
      action: 'update',
      targetType: 'SystemConfig',
      targetId: cfg._id,
      targetLabel: cfg.key,
      details: { value },
    });

    return res.json(cfg);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update config.' });
  }
};

// POST /api/config
const createConfig = async (req, res) => {
  try {
    const { key, value, label, description, group } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ message: 'key and value are required.' });
    }

    const normalizedKey = key.trim();
    const existing = await SystemConfig.findOne({ key: normalizedKey });
    if (existing) {
      return res.status(409).json({ message: `Config key "${normalizedKey}" already exists.` });
    }

    const cfg = await SystemConfig.create({
      key: normalizedKey,
      value,
      label: label || normalizedKey,
      description: description || '',
      group: group || 'General',
    });

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'SystemConfig',
      targetId: cfg._id,
      targetLabel: cfg.key,
      details: { value },
    });

    return res.status(201).json(cfg);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create config.' });
  }
};

module.exports = { getConfigs, getConfig, updateConfig, createConfig };