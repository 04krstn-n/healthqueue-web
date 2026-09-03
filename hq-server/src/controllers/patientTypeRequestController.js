const fs = require('fs');
const path = require('path');
const PatientTypeRequest = require('../models/PatientTypeRequest');
const Patient = require('../models/Patient');
const QueueEntry = require('../models/QueueEntry');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');
const { uploadDir } = require('../middleware/upload');

// POST /api/patient-type-requests (patient, multipart/form-data: photo, requestedType)
const createRequest = async (req, res) => {
  try {
    const { requestedType } = req.body;
    if (!['Senior Citizen', 'PWD', 'Pregnant'].includes(requestedType)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'requestedType must be Senior Citizen, PWD, or Pregnant.',
      });
    }
    if (!req.file) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'A photo of your ID/certificate is required.',
      });
    }

    // One pending request at a time — otherwise a patient could spam
    // submissions while waiting for review.
    const existingPending = await PatientTypeRequest.findOne({
      patient: req.user._id,
      status: 'pending',
    });
    if (existingPending) {
      fs.unlink(req.file.path, () => {});
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'You already have a pending request awaiting review.',
      });
    }

    const request = await PatientTypeRequest.create({
      patient: req.user._id,
      requestedType,
      idPhotoPath: req.file.filename,
    });

    return res.status(HttpStatus.OK).json({ success: true, data: request });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('createRequest Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to submit request.',
    });
  }
};

// GET /api/patient-type-requests/mine (patient) — most recent request, so
// the app can show its status (pending/approved/rejected + review note).
const getMyRequest = async (req, res) => {
  try {
    const request = await PatientTypeRequest.findOne({ patient: req.user._id })
      .sort({ createdAt: -1 });
    return res.status(HttpStatus.OK).json({ success: true, data: request });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to load request status.',
    });
  }
};

// GET /api/patient-type-requests?status=pending (staff/facility_admin/super_admin)
// Not clinic-scoped — patient accounts aren't tied to a single clinic (they
// can join any clinic's queue), so any staff member can review any request,
// matching how PUT /api/patients/:id (the actual patientType write) is
// already staff/admin-wide rather than clinic-restricted.
const getRequests = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const requests = await PatientTypeRequest.find(filter)
      .populate('patient', 'fullName email phone')
      .populate('reviewedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(200);
    return res.status(HttpStatus.OK).json({ success: true, data: requests });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to load requests.',
    });
  }
};

// GET /api/patient-type-requests/:id/photo — streams the submitted image.
// Authenticated and ownership-checked rather than served from a public
// static folder, since these are identity documents (ID/certificate photos).
const getRequestPhoto = async (req, res) => {
  try {
    const request = await PatientTypeRequest.findById(req.params.id);
    if (!request) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Request not found.' });
    }
    const isOwner = request.patient.toString() === req.user._id.toString();
    const isStaff = ['staff', 'facility_admin', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'Not authorized.' });
    }
    const filePath = path.join(uploadDir, request.idPhotoPath);
    if (!fs.existsSync(filePath)) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Photo not found.' });
    }
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to load photo.' });
  }
};

// PUT /api/patient-type-requests/:id/approve (staff/facility_admin/super_admin)
// Applies the exact same write PUT /api/patients/:id already performs for
// patientType, just triggered from this review flow instead of a manual
// lookup — the patient's queue priority (see queueController.joinQueue)
// picks it up automatically on their next queue join.
const approveRequest = async (req, res) => {
  try {
    const request = await PatientTypeRequest.findById(req.params.id);
    if (!request) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Request not found.' });
    }
    if (request.status !== 'pending') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `This request was already ${request.status}.`,
      });
    }

    await Patient.findOneAndUpdate(
      { user: request.patient },
      { patientType: request.requestedType }
    );

    // If the patient is currently waiting/called in a queue right now,
    // update that entry's priority too — otherwise their account would
    // show "Priority" immediately, but their existing spot in an
    // already-joined queue would silently stay Regular until they left
    // and rejoined. This was the actual "not moved to Priority without a
    // manual refresh" gap: even after this fix's real-time push updates
    // the account, an in-progress queue entry needed its own update.
    const activeEntry = await QueueEntry.findOneAndUpdate(
      { patient: request.patient, status: { $in: ['waiting', 'called'] } },
      { queueType: 'Priority', priority: true },
      { new: true }
    );

    request.status = 'approved';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body.note || '';
    await request.save();

    await logAction({
      actor: req.user,
      action: 'approve',
      targetType: 'PatientTypeRequest',
      targetId: request._id,
      targetLabel: `Approved ${request.requestedType} for patient`,
      details: { requestedType: request.requestedType },
    });

    // Real-time push so the patient's account updates immediately without
    // needing to log out/in or otherwise refresh — see server.js's
    // 'join_user' room (patients aren't clinic-scoped, so this can't reuse
    // the clinic room broadcasts queue events already use).
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${request.patient}`).emit('patient_type_updated', {
        patientType: request.requestedType,
        status: 'approved',
      });
      // Also nudge the clinic's queue view (staff tablet + any other
      // patients watching that clinic) so the Priority tag appears on the
      // active entry right away, reusing the same event queue screens
      // already listen for.
      if (activeEntry) {
        io.to(`clinic_${activeEntry.clinic}`).emit('global_queue_change', {
          clinicId: activeEntry.clinic,
          eventName: 'patient_type_updated',
        });
      }
    }

    return res.status(HttpStatus.OK).json({ success: true, data: request });
  } catch (err) {
    console.error('approveRequest Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to approve request.' });
  }
};

// PUT /api/patient-type-requests/:id/reject (staff/facility_admin/super_admin)
const rejectRequest = async (req, res) => {
  try {
    const request = await PatientTypeRequest.findById(req.params.id);
    if (!request) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Request not found.' });
    }
    if (request.status !== 'pending') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `This request was already ${request.status}.`,
      });
    }

    request.status = 'rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewNote = req.body.note || '';
    await request.save();

    await logAction({
      actor: req.user,
      action: 'reject',
      targetType: 'PatientTypeRequest',
      targetId: request._id,
      targetLabel: `Rejected ${request.requestedType} request`,
      details: { requestedType: request.requestedType, note: request.reviewNote },
    });

    return res.status(HttpStatus.OK).json({ success: true, data: request });
  } catch (err) {
    console.error('rejectRequest Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to reject request.' });
  }
};

module.exports = {
  createRequest,
  getMyRequest,
  getRequests,
  getRequestPhoto,
  approveRequest,
  rejectRequest,
};
