/**
 * Clinic Controller — Clinic profile management & Proximity Recommendation Engine
 */
const Clinic = require('../models/Clinic');
const InsightsLog = require('../models/InsightsLog');
const { calculateDistance } = require('../utils/calculateDistance');
const { generatePrescriptiveInsight } = require('../services/openaiService');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');

// GET /api/clinics — Retrieves all active clinics
const getClinics = async (req, res) => {
  try {
    const clinics = await Clinic.find({ isActive: true }).sort({ name: 1 });
    return res.status(HttpStatus.OK).json({ success: true, data: clinics });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch clinics.' });
  }
};

// GET /api/clinics/directory — Public directory for clinic comparison
const getClinicDirectory = async (req, res) => {
  try {
    const clinics = await Clinic.find({ isActive: true, status: { $ne: 'closed' } })
      .select('name address city latitude longitude services contactNumber status queueLength currentWaitingTime baseWaitTimePerPerson peakHours')
      .sort({ name: 1 });

    return res.status(HttpStatus.OK).json({ success: true, data: clinics });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch directory.' });
  }
};

// GET /api/clinics/:id — Single clinic lookup
const getClinic = async (req, res) => {
  try {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }
    return res.status(HttpStatus.OK).json({ success: true, data: clinic });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch clinic.' });
  }
};

// POST /api/clinics — Add clinic (Admin)
const createClinic = async (req, res) => {
  try {
    const clinic = await Clinic.create(req.body);

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'Clinic',
      targetId: clinic._id,
      targetLabel: clinic.name,
      clinicId: clinic._id,
      details: { status: clinic.status },
    });

    return res.status(HttpStatus.CREATED).json({ success: true, data: clinic });
  } catch (err) {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: err.message });
  }
};

// PUT /api/clinics/:id — Update clinic
const updateClinic = async (req, res) => {
  try {
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }

    await logAction({
      actor: req.user,
      action: 'update',
      targetType: 'Clinic',
      targetId: clinic._id,
      targetLabel: clinic.name,
      clinicId: clinic._id,
      details: req.body,
    });

    return res.status(HttpStatus.OK).json({ success: true, data: clinic });
  } catch (err) {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: err.message });
  }
};

// DELETE /api/clinics/:id — Soft delete clinic
const deleteClinic = async (req, res) => {
  try {
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });

    await logAction({
      actor: req.user,
      action: 'deactivate',
      targetType: 'Clinic',
      targetId: req.params.id,
      targetLabel: clinic?.name,
      clinicId: req.params.id,
    });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Clinic deactivated.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to deactivate clinic.' });
  }
};

// GET /api/clinics/recommend — Proximity & Prescriptive Recommendation Engine
const getRecommendations = async (req, res) => {
  try {
    const { latitude, longitude, service } = req.query;
    const userLat = parseFloat(latitude) || 14.5995; // Default Metro Manila lat
    const userLng = parseFloat(longitude) || 120.9842; // Default Metro Manila lng

    const filter = { isActive: true, status: { $ne: 'closed' } };
    if (service) {
      filter['services.name'] = { $regex: new RegExp(service, 'i') };
    }

    const clinics = await Clinic.find(filter).lean();

    // Map distance and evaluate metrics
    const evaluated = clinics.map((c) => {
      const distanceKm = calculateDistance(userLat, userLng, c.latitude || 0, c.longitude || 0);
      return {
        ...c,
        distanceKm,
        avgWaitMinutes: c.currentWaitingTime || 15,
      };
    });

    // Sort options: 1. Lowest Wait Time 2. Proximity
    const sortedBySpeed = [...evaluated].sort((a, b) => a.avgWaitMinutes - b.avgWaitMinutes);
    const sortedByDistance = [...evaluated].sort((a, b) => a.distanceKm - b.distanceKm);

    const nearestClinic = sortedByDistance[0] || null;
    const fastestClinic = sortedBySpeed[0] || null;

    // Generate OpenAI Prescriptive Advice
    let aiExplanation = null;
    try {
      aiExplanation = await generatePrescriptiveInsight(
        { latitude: userLat, longitude: userLng },
        sortedBySpeed.slice(0, 3)
      );
    } catch (e) {
      aiExplanation = `We recommend ${fastestClinic?.name} due to its low estimated wait time (${fastestClinic?.avgWaitMinutes} mins)[cite: 1].`;
    }

    // Save evaluation log for ISO/IEC 25010 tracking
    if (req.user && fastestClinic) {
      await InsightsLog.create({
        patient: req.user._id,
        patientLocation: { latitude: userLat, longitude: userLng },
        recommendedClinic: fastestClinic._id,
        recommendationType: 'lowest_wait_time',
        aiExplanation,
        evaluatedClinics: sortedBySpeed.map((item) => ({
          clinic: item._id,
          distanceKm: item.distanceKm,
          estimatedWaitMinutes: item.avgWaitMinutes,
          activeQueueCount: item.queueLength || 0,
        })),
      }).catch((e) => console.warn('[Clinic] InsightsLog save skipped:', e.message));
    }

    return res.status(HttpStatus.OK).json({
      success: true,
      recommendation: aiExplanation,
      nearestClinic,
      fastestClinic,
      clinics: sortedBySpeed,
    });
  } catch (err) {
    console.error('getRecommendations Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch recommendations.' });
  }
};

module.exports = {
  getClinics,
  getClinicDirectory,
  getClinic,
  createClinic,
  updateClinic,
  deleteClinic,
  getRecommendations,
};