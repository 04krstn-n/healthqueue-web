/**
 * Clinic Controller — Clinic profile management & Proximity Recommendation Engine
 */
const Clinic = require('../models/Clinic');
const InsightsLog = require('../models/InsightsLog');
const { calculateDistance } = require('../utils/calculateDistance');
const { generatePrescriptiveInsight } = require('../services/openaiService');
const { geocodeAddress } = require('../services/geocodeService');
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
      .select('name address city latitude longitude services contactNumber status queueLength currentWaitingTime baseWaitTimePerPerson maxQueueCapacity peakHours')
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
    const payload = { ...req.body };
    let geocodeWarning = null;

    // Only auto-geocode when the admin didn't already provide real
    // coordinates (e.g. from a map-pin picker) — this just fills the gap
    // for the common case of typing an address and nothing else.
    // NOTE: must check for undefined/null first — Number(undefined) is NaN,
    // and NaN !== 0 is true, so without this check every clinic (where the
    // form never sends latitude/longitude at all) was wrongly treated as
    // "already has coordinates" and geocoding was skipped entirely.
    const hasExplicitCoords =
      payload.latitude != null && payload.longitude != null &&
      Number(payload.latitude) !== 0 && Number(payload.longitude) !== 0;

    if (!hasExplicitCoords && (payload.address || payload.city)) {
      const geo = await geocodeAddress({
        address: payload.address,
        city: payload.city,
        province: payload.province,
      });
      if (geo) {
        payload.latitude = geo.lat;
        payload.longitude = geo.lng;
        payload.location = { type: 'Point', coordinates: [geo.lng, geo.lat] };
        payload.googlePlaceId = geo.placeId;
      } else {
        geocodeWarning =
          'Could not automatically locate this address on the map. ' +
          'The clinic was saved, but you may want to double-check the address or set its map pin manually.';
      }
    }

    const clinic = await Clinic.create(payload);

    await logAction({
      actor: req.user,
      action: 'create',
      targetType: 'Clinic',
      targetId: clinic._id,
      targetLabel: clinic.name,
      clinicId: clinic._id,
      details: { status: clinic.status },
    });

    return res.status(HttpStatus.CREATED).json({
      success: true,
      data: clinic,
      ...(geocodeWarning ? { warning: geocodeWarning } : {}),
    });
  } catch (err) {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: err.message });
  }
};

// PUT /api/clinics/:id — Update clinic
const updateClinic = async (req, res) => {
  try {
    // Facility admins can hit this route (see clinicRoutes.js) but were
    // never actually checked against WHICH clinic they were editing — a
    // facility_admin for Clinic A could call PUT /clinics/<Clinic B's id>
    // and successfully rewrite Clinic B's name, address, service
    // durations, priority ratio, etc. super_admin is unrestricted, as
    // intended.
    if (req.user.role === 'facility_admin' &&
        req.user.clinicId?.toString() !== req.params.id) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'You can only update your own clinic.',
      });
    }

    const payload = { ...req.body };
    const addressChanged = payload.address !== undefined || payload.city !== undefined;
    const hasExplicitCoords =
      payload.latitude !== undefined && payload.longitude !== undefined &&
      Number(payload.latitude) !== 0 && Number(payload.longitude) !== 0;

    if (addressChanged && !hasExplicitCoords) {
      const existing = await Clinic.findById(req.params.id).select('address city province');
      const geo = await geocodeAddress({
        address: payload.address ?? existing?.address,
        city: payload.city ?? existing?.city,
        province: payload.province ?? existing?.province,
      });
      if (geo) {
        payload.latitude = geo.lat;
        payload.longitude = geo.lng;
        payload.location = { type: 'Point', coordinates: [geo.lng, geo.lat] };
        payload.googlePlaceId = geo.placeId;
      }
      // If geocoding fails here, we simply leave the clinic's existing
      // coordinates untouched rather than blocking the address edit.
    }

    const clinic = await Clinic.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
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

// GET /api/clinics/network-status — Real-time peer-clinic status for
// Facility Admin referral decisions. Distinct from getClinicDirectory
// (public, patient-facing, no distance/capacity computed) — this is
// authenticated, computes distance from the REQUESTING clinic server-side
// (instead of the client doing Haversine math itself), and flags capacity
// so the UI doesn't have to derive it. Aggregate fields only — no patient
// or individual queue-entry data crosses clinics here, by design.
const getClinicNetworkStatus = async (req, res) => {
  try {
    // facility_admin/staff are scoped to their own clinic; super_admin has
    // none, so it may pass ?clinicId= to view the network from any clinic's
    // vantage point (or omit it to just get all clinics, unsorted by distance).
    const requestingClinicId = req.user.clinicId || req.query.clinicId || null;

    const [ownClinic, clinics] = await Promise.all([
      requestingClinicId ? Clinic.findById(requestingClinicId).select('latitude longitude').lean() : null,
      Clinic.find({ isActive: true, status: { $ne: 'closed' }, _id: { $ne: requestingClinicId } })
        .select('name address city latitude longitude status queueLength currentWaitingTime baseWaitTimePerPerson maxQueueCapacity')
        .lean(),
    ]);

    const network = clinics.map((c) => {
      const distanceKm = ownClinic
        ? calculateDistance(ownClinic.latitude || 0, ownClinic.longitude || 0, c.latitude || 0, c.longitude || 0)
        : null;
      return {
        ...c,
        distanceKm,
        atCapacity: c.maxQueueCapacity ? c.queueLength >= c.maxQueueCapacity : false,
      };
    });

    network.sort((a, b) => {
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    return res.status(HttpStatus.OK).json({ success: true, data: network });
  } catch (err) {
    console.error('getClinicNetworkStatus Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch clinic network status.' });
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
  getClinicNetworkStatus,
};