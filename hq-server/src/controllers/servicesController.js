/**
 * Services Controller — manage clinic services (embedded in Clinic document)
 * Access: facility_admin (own clinic), super_admin (any)
 */
const Clinic = require('../models/Clinic');
const { logAction } = require('../utils/auditLog');

// Helper for tenant checking
const isUnauthorizedClinic = (req, targetClinicId) => {
  if (req.user.role === 'super_admin') return false;
  return req.user.clinicId?.toString() !== targetClinicId?.toString();
};

// GET /api/services?clinicId=xxx
const getServices = async (req, res) => {
  try {
    const clinicId = req.query.clinicId || req.user.clinicId;
    if (!clinicId) return res.status(400).json({ message: 'clinicId is required.' });

    if (isUnauthorizedClinic(req, clinicId)) {
      return res.status(403).json({ message: 'Access denied to this clinic.' });
    }

    const clinic = await Clinic.findById(clinicId).select('name services');
    if (!clinic) return res.status(404).json({ message: 'Clinic not found.' });

    return res.json({ clinicId: clinic._id, clinicName: clinic.name, services: clinic.services });
  } catch (err) {
    console.error('getServices Error:', err.message);
    return res.status(500).json({ message: 'Failed to fetch services.' });
  }
};

// POST /api/services
const addService = async (req, res) => {
  try {
    const { clinicId, name, description, durationMinutes, isAvailable } = req.body;
    const targetClinicId = clinicId || req.user.clinicId;

    if (!targetClinicId || !name) {
      return res.status(400).json({ message: 'clinicId and name are required.' });
    }

    if (isUnauthorizedClinic(req, targetClinicId)) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const trimmedName = name.trim();

    // Prevent duplicates & push atomically
    const clinic = await Clinic.findOneAndUpdate(
      { _id: targetClinicId, 'services.name': { $ne: trimmedName } },
      {
        $push: {
          services: {
            name: trimmedName,
            description: description?.trim() || '',
            durationMinutes: durationMinutes || 30,
            isAvailable: isAvailable !== false,
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!clinic) {
      const exists = await Clinic.findById(targetClinicId);
      if (!exists) return res.status(404).json({ message: 'Clinic not found.' });
      return res.status(409).json({ message: 'Service with this name already exists.' });
    }

    const addedService = clinic.services[clinic.services.length - 1];

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'Service',
      targetId: addedService._id,
      targetLabel: addedService.name,
      clinicId: targetClinicId,
      details: { durationMinutes: addedService.durationMinutes, isAvailable: addedService.isAvailable },
    });

    return res.status(201).json(addedService);
  } catch (err) {
    console.error('addService Error:', err.message);
    return res.status(500).json({ message: 'Failed to add service.' });
  }
};

// PUT /api/services/:clinicId/:serviceId
const updateService = async (req, res) => {
  try {
    const { clinicId, serviceId } = req.params;

    if (isUnauthorizedClinic(req, clinicId)) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const allowed = ['name', 'description', 'durationMinutes', 'isAvailable'];
    const setOps = {};
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) setOps[`services.$[svc].${f}`] = req.body[f];
    });

    if (Object.keys(setOps).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }

    // Previously this loaded the whole clinic, mutated the one service
    // subdocument in memory, then called clinic.save() — but .save()
    // re-validates the ENTIRE document, including every other service
    // already on that clinic. One unrelated service with bad/legacy data
    // (e.g. a blank name from an old import) would then make every future
    // edit to any OTHER service on that clinic fail with this same generic
    // message, with nothing in the server logs to explain why.
    // findOneAndUpdate + arrayFilters (the same atomic pattern addService
    // already uses for $push) only touches and validates the targeted
    // service, so sibling data can no longer block this update.
    const clinic = await Clinic.findOneAndUpdate(
      { _id: clinicId, 'services._id': serviceId },
      { $set: setOps },
      { new: true, runValidators: true, arrayFilters: [{ 'svc._id': serviceId }] }
    );

    if (!clinic) {
      const exists = await Clinic.findById(clinicId).select('_id');
      if (!exists) return res.status(404).json({ message: 'Clinic not found.' });
      return res.status(404).json({ message: 'Service not found.' });
    }

    const svc = clinic.services.id(serviceId);

    await logAction({
      actor: req.user,
      action: 'update',
      targetType: 'Service',
      targetId: serviceId,
      targetLabel: svc?.name || '',
      clinicId,
      details: req.body,
    });

    return res.json(svc);
  } catch (err) {
    console.error('updateService Error:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Failed to update service.' });
  }
};

// DELETE /api/services/:clinicId/:serviceId
const deleteService = async (req, res) => {
  try {
    const { clinicId, serviceId } = req.params;

    if (isUnauthorizedClinic(req, clinicId)) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Look up the service name before it's removed, so the audit trail
    // still shows what was deleted rather than just an id.
    const before = await Clinic.findById(clinicId).select('services');
    const removedService = before?.services?.id(serviceId);

    // Atomic removal to avoid race conditions
    const clinic = await Clinic.findByIdAndUpdate(
      clinicId,
      { $pull: { services: { _id: serviceId } } },
      { new: true }
    );

    if (!clinic) return res.status(404).json({ message: 'Clinic not found.' });

    await logAction({
      actor: req.user,
      action: 'delete',
      targetType: 'Service',
      targetId: serviceId,
      targetLabel: removedService?.name || '',
      clinicId,
    });

    return res.json({ message: 'Service removed.' });
  } catch (err) {
    console.error('deleteService Error:', err.message);
    return res.status(500).json({ message: 'Failed to delete service.' });
  }
};

module.exports = { getServices, addService, updateService, deleteService };