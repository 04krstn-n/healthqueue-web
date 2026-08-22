/**
 * Queue Controller — Live queue management, remote en-route enrollment, and 5-min grace period
 */
const mongoose = require('mongoose');
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const { 
  getNextQueueNumber, 
  estimateWaitTime, 
  getGracePeriodExpiry 
} = require('../utils/queueHelpers');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');

const todayRange = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);
  return { $gte: start, $lte: end };
};

/**
 * Helper to emit Socket.io real-time updates across connected web, mobile, and tablet clients
 */
const emitQueueUpdate = (req, clinicId, eventName, payload) => {
  const io = req.app.get('io');
  if (io) {
    io.to(`clinic_${clinicId}`).emit(eventName, payload);
    io.emit('global_queue_change', { clinicId, eventName });
  }
};

// GET /api/queues — Retrieves daily queue entries filtered by role/clinic
const getQueueEntries = async (req, res) => {
  try {
    const { clinicId, status, date } = req.query;
    const filter = {};

    // Scope by user role
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinic = req.user.clinicId;
    } else if (clinicId) {
      filter.clinic = clinicId;
    }

    if (status) filter.status = status;

    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);
    filter.joinedAt = { $gte: start, $lte: end };

    const entries = await QueueEntry.find(filter)
      .populate('clinic', 'name address city')
      .populate('patient', 'fullName phone patientType')
      .sort({ joinedAt: 1 });

    return res.status(HttpStatus.OK).json({
      success: true,
      count: entries.length,
      data: entries,
    });
  } catch (err) {
    console.error('getQueueEntries Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to retrieve queue entries.' 
    });
  }
};

// POST /api/queues/join — Patient remote queue enrollment with en-route tracking
const joinQueue = async (req, res) => {
  try {
    let { clinicId, serviceName, serviceId, notes, priority, joinedRemotely } = req.body;

    if (!clinicId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        success: false, 
        message: 'Clinic ID is required.' 
      });
    }

    // 1. Fetch clinic (services are embedded here)
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ 
        success: false, 
        message: 'Clinic not found.' 
      });
    }

    if (clinic.status === 'closed') {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        success: false, 
        message: 'This clinic is currently closed.' 
      });
    }

    // 2. If serviceName is missing, extract it from clinic.services using serviceId
    if (!serviceName && serviceId && Array.isArray(clinic.services)) {
      const foundService = clinic.services.find(
        (s) => s._id?.toString() === serviceId.toString() || s.id?.toString() === serviceId.toString()
      );
      if (foundService) {
        serviceName = foundService.name || foundService.serviceName;
      }
    }

    // 3. Fallback: if no service matched or none provided, take the first clinic service
    if (!serviceName && clinic.services && clinic.services.length > 0) {
      serviceName = clinic.services[0].name || clinic.services[0].serviceName;
      serviceId = serviceId || clinic.services[0]._id;
    }

    // 4. Validate that a service name exists
    if (!serviceName) {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        success: false, 
        message: 'A valid serviceId or serviceName is required.' 
      });
    }

    // Prevent duplicate active queue entries today
    const existing = await QueueEntry.findOne({
      clinic: clinicId,
      patient: req.user._id,
      status: { $in: ['waiting', 'serving', 'called'] },
      joinedAt: todayRange(),
    });

    if (existing) {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        success: false, 
        message: "You already have an active queue ticket at this clinic." 
      });
    }

    // Auto-create/sync patient profile
    let patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      patient = await Patient.create({
        user: req.user._id,
        fullName: req.user.fullName || 'Patient',
        email: req.user.email || '',
        phone: req.user.phone || '',
        patientType: 'Regular',
      });
    }

    const prefix = (clinic.name.charAt(0) || 'Q').toUpperCase();
    const queueNumber = await getNextQueueNumber(clinicId, prefix);
    const estWait = await estimateWaitTime(clinicId);
    const activeCount = await QueueEntry.countDocuments({
      clinic: clinicId,
      status: { $in: ['waiting', 'serving', 'called'] },
      joinedAt: todayRange(),
    });

    const entry = await QueueEntry.create({
      clinic: clinicId,
      patient: req.user._id,
      patientName: patient.fullName || req.user.fullName,
      patientPhone: patient.phone || req.user.phone || '',
      patientType: patient.patientType || 'Regular',
      serviceName,
      serviceId: serviceId || null,
      queueNumber,
      queueType: (priority || patient.patientType !== 'Regular') ? 'Priority' : 'Regular',
      priority: priority || false,
      joinedRemotely: joinedRemotely !== undefined ? joinedRemotely : true,
      notes: notes || '',
      estimatedWaitMinutes: estWait,
      positionAtJoin: activeCount + 1,
      joinedAt: new Date(),
    });

    // Increment live clinic queue counters
    await Clinic.findByIdAndUpdate(clinicId, {
      $inc: { queueLength: 1 },
      currentWaitingTime: estWait,
    });

    // In-app notification dispatch
    await Notification.create({
      user: req.user._id,
      title: 'Queue Joined',
      message: `You joined the queue at ${clinic.name}. Queue Ticket #${queueNumber}. Est. wait: ${estWait} mins.`,
      type: 'queue',
      refType: 'QueueEntry',
      refId: entry._id,
    });

    // Trigger real-time Socket.io broadcast to staff tablets
    emitQueueUpdate(req, clinicId, 'queue_entry_added', { entry, activeCount: activeCount + 1 });

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: 'Joined queue successfully.',
      data: entry,
      entry: {
        _id: entry._id,
        queueNumber: entry.queueNumber,
        clinicName: clinic.name,
        serviceName: entry.serviceName,
        status: entry.status,
        joinedAt: entry.joinedAt,
        joinedRemotely: entry.joinedRemotely,
      },
      position: activeCount + 1,
      peopleAhead: activeCount,
      estimatedWaitTime: estWait,
    });
  } catch (err) {
    console.error('joinQueue Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to join queue.' 
    });
  }
};

// GET /api/queues/my-status — Real-time queue status for patient mobile dashboard
const getMyQueueStatus = async (req, res) => {
  try {
    const entry = await QueueEntry.findOne({
      patient: req.user._id,
      status: { $in: ['waiting', 'serving', 'called'] },
      joinedAt: todayRange(),
    }).populate('clinic', 'name address city');

    if (!entry) {
      return res.status(HttpStatus.OK).json({ success: true, activeQueue: false, entry: null });
    }

    const ahead = await QueueEntry.countDocuments({
      clinic: entry.clinic._id,
      status: 'waiting',
      joinedAt: todayRange(),
      _id: { $lt: entry._id },
    });

    const estWait = await estimateWaitTime(entry.clinic._id);

    return res.status(HttpStatus.OK).json({
      success: true,
      activeQueue: true,
      entry: {
        _id: entry._id,
        queueNumber: entry.queueNumber,
        serviceName: entry.serviceName,
        status: entry.status,
        joinedAt: entry.joinedAt,
        calledAt: entry.calledAt,
        joinedRemotely: entry.joinedRemotely,
        gracePeriodExpiresAt: entry.gracePeriodExpiresAt,
        clinic: entry.clinic,
      },
      position: ahead + 1,
      peopleAhead: ahead,
      estimatedWaitTime: estWait,
    });
  } catch (err) {
    console.error('getMyQueueStatus Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to fetch active queue status.' 
    });
  }
};

// PUT /api/queues/:id/call — Calls patient & starts 5-minute arrival grace period
const callPatient = async (req, res) => {
  try {
    const graceExpiry = getGracePeriodExpiry(5); // 5-minute arrival grace window

    const entry = await QueueEntry.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'called', 
        calledAt: new Date(),
        gracePeriodExpiresAt: graceExpiry 
      },
      { new: true }
    );

    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ 
        success: false, 
        message: 'Queue entry not found.' 
      });
    }

    // Trigger push notification
    await Notification.create({
      user: entry.patient,
      title: 'It is your turn!',
      message: `Ticket #${entry.queueNumber} — Please proceed to the counter within 5 minutes.`,
      type: 'turn_alert',
      refType: 'QueueEntry',
      refId: entry._id,
    });

    // Push Socket.io real-time event to patient mobile app
    emitQueueUpdate(req, entry.clinic, 'patient_called', { 
      entryId: entry._id, 
      queueNumber: entry.queueNumber,
      gracePeriodExpiresAt: graceExpiry 
    });

    await logAction({
      actor: req.user,
      action: 'call',
      targetType: 'QueueEntry',
      targetId: entry._id,
      targetLabel: `Ticket #${entry.queueNumber} — ${entry.patientName}`,
      clinicId: entry.clinic,
      details: { serviceName: entry.serviceName },
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Patient called. 5-minute grace period timer started.',
      entry,
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to call patient.' 
    });
  }
};

// PUT /api/queues/:id/start-service — Marks patient as in-consultation
const startService = async (req, res) => {
  try {
    const entry = await QueueEntry.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'serving', 
        servedAt: new Date() 
      },
      { new: true }
    );

    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }

    emitQueueUpdate(req, entry.clinic, 'service_started', { entryId: entry._id });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Service started.', entry });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to start service.' });
  }
};

// PUT /api/queues/:id/complete — Completes service session & updates TAT metrics
const completePatient = async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }

    entry.status = 'completed';
    entry.completedAt = new Date();
    await entry.save(); // Pre-save hook computes turnaroundTimeInMinutes (TAT)

    await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: -1 } });

    emitQueueUpdate(req, entry.clinic, 'queue_completed', { entryId: entry._id });

    await logAction({
      actor: req.user,
      action: 'complete',
      targetType: 'QueueEntry',
      targetId: entry._id,
      targetLabel: `Ticket #${entry.queueNumber} — ${entry.patientName}`,
      clinicId: entry.clinic,
      details: { serviceName: entry.serviceName },
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Patient consultation completed.',
      entry,
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to complete session.' 
    });
  }
};

// PUT /api/queues/:id/skip — Skips patient (e.g. grace period expired)
const skipPatient = async (req, res) => {
  try {
    const entry = await QueueEntry.findByIdAndUpdate(
      req.params.id, 
      { status: 'skipped' }, 
      { new: true }
    );
    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }

    await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: -1 } });

    emitQueueUpdate(req, entry.clinic, 'patient_skipped', { entryId: entry._id });

    await logAction({
      actor: req.user,
      action: 'skip',
      targetType: 'QueueEntry',
      targetId: entry._id,
      targetLabel: `Ticket #${entry.queueNumber} — ${entry.patientName}`,
      clinicId: entry.clinic,
      details: { serviceName: entry.serviceName },
    });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Patient skipped.', entry });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to skip entry.' });
  }
};

// PUT /api/queues/:id/no-show — Marks patient as no-show
const markNoShow = async (req, res) => {
  try {
    const entry = await QueueEntry.findByIdAndUpdate(
      req.params.id, 
      { status: 'no_show' }, 
      { new: true }
    );
    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }

    await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: -1 } });

    emitQueueUpdate(req, entry.clinic, 'patient_noshow', { entryId: entry._id });

    await logAction({
      actor: req.user,
      action: 'no_show',
      targetType: 'QueueEntry',
      targetId: entry._id,
      targetLabel: `Ticket #${entry.queueNumber} — ${entry.patientName}`,
      clinicId: entry.clinic,
      details: { serviceName: entry.serviceName },
    });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Marked as no-show.', entry });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to mark no-show.' });
  }
};

// PUT /api/queues/:id/cancel — Cancels queue entry
const cancelEntry = async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }

    if (req.user.role === 'patient' && entry.patient?.toString() !== req.user._id.toString()) {
      return res.status(HttpStatus.FORBIDDEN).json({ 
        success: false, 
        message: 'Not authorized to cancel this queue entry.' 
      });
    }

    entry.status = 'cancelled';
    entry.cancelledAt = new Date();
    await entry.save();

    await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: -1 } });

    emitQueueUpdate(req, entry.clinic, 'queue_cancelled', { entryId: entry._id });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Queue entry cancelled successfully.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to cancel queue entry.' });
  }
};

// PUT /api/queues/:id/requeue — Brings a called/skipped/no-show entry back to
// "waiting" so it isn't permanently stuck with no valid action.
const requeueEntry = async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }

    const requeueable = ['called', 'skipped', 'no_show'];
    if (!requeueable.includes(entry.status)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot requeue an entry with status "${entry.status}".`,
      });
    }

    await QueueEntry.findByIdAndUpdate(entry._id, {
      $set: { status: 'waiting' },
      $unset: { calledAt: '', gracePeriodExpiresAt: '' },
    });

    // skip/no-show decremented the live counter — restore it now that the
    // patient is back in the active queue.
    await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: 1 } });

    emitQueueUpdate(req, entry.clinic, 'queue_requeued', { entryId: entry._id });

    return res.status(HttpStatus.OK).json({ success: true, message: 'Patient returned to waiting.', entry });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to requeue entry.' });
  }
};

// GET /api/queues/metrics — Excludes cancelled transactions from average wait time
const getQueueMetrics = async (req, res) => {
  try {
    const clinicId = req.query.clinicId || req.user.clinicId;
    const filter = { joinedAt: todayRange() };
    if (clinicId) filter.clinic = clinicId;

    const [waiting, serving, done, total] = await Promise.all([
      QueueEntry.countDocuments({ ...filter, status: 'waiting' }),
      QueueEntry.countDocuments({ ...filter, status: { $in: ['serving', 'called'] } }),
      QueueEntry.countDocuments({ ...filter, status: { $in: ['done', 'completed'] } }),
      QueueEntry.countDocuments(filter),
    ]);

    // Calculate Average Wait Time strictly from completed entries (excluding cancelled)
    const completed = await QueueEntry.find({
      ...filter,
      status: { $in: ['done', 'completed'] },
      calledAt: { $ne: null },
    }).select('joinedAt calledAt');

    const avgWait = completed.length
      ? Math.round(completed.reduce((s, e) => s + (new Date(e.calledAt) - new Date(e.joinedAt)) / 60000, 0) / completed.length)
      : 0;

    return res.status(HttpStatus.OK).json({
      success: true,
      waiting,
      serving,
      done,
      total,
      avgWait,
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to fetch queue metrics.' });
  }
};

// POST /api/queues/add-walkin — Staff manual registration for walk-in patients
const addWalkIn = async (req, res) => {
  try {
    let { patientName, phone, serviceName, serviceId, patientType, clinicId } = req.body;
    if (!patientName) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Patient name is required.' });
    }

    // Contact number is required so the patient can actually receive
    // call/turn notifications — it used to be optional.
    if (!phone || !phone.toString().trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Contact number is required for notifications.' });
    }

    const cId = clinicId || req.user.clinicId;
    if (!cId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Clinic ID is required.' });
    }

    const clinic = await Clinic.findById(cId);
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }

    // Auto-fetch serviceName from serviceId — services live embedded on the
    // Clinic document (added by the Facility Admin via /api/services), there
    // is no separate Service collection.
    if (!serviceName && serviceId && clinic.services?.length > 0) {
      const matched = clinic.services.id
        ? clinic.services.id(serviceId)
        : clinic.services.find((s) => s._id?.toString() === serviceId.toString());
      if (matched) serviceName = matched.name;
    }

    if (!serviceName) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Service ID or Service name is required.' });
    }

    const prefix = (clinic.name.charAt(0) || 'Q').toUpperCase();
    const queueNumber = await getNextQueueNumber(cId, prefix);
    const estWait = await estimateWaitTime(cId);
    const activeCount = await QueueEntry.countDocuments({
      clinic: cId,
      status: { $in: ['waiting', 'serving', 'called'] },
      joinedAt: todayRange(),
    });

    const entry = await QueueEntry.create({
      clinic: cId,
      patientName: patientName.trim(),
      patientPhone: phone || '',
      patientType: patientType || 'Regular',
      serviceName,
      queueNumber,
      queueType: patientType && patientType !== 'Regular' ? 'Priority' : 'Regular',
      joinedRemotely: false, // Walk-in on-site
      estimatedWaitMinutes: estWait,
      positionAtJoin: activeCount + 1,
      joinedAt: new Date(),
    });

    await Clinic.findByIdAndUpdate(cId, { $inc: { queueLength: 1 } });

    emitQueueUpdate(req, cId, 'walkin_added', { entry });

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: 'Walk-in patient added to queue.',
      data: entry,
      entry,
      position: activeCount + 1,
      estimatedWaitTime: estWait,
    });
  } catch (err) {
    console.error('addWalkIn Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to add walk-in patient.' });
  }
};

module.exports = {
  getQueueEntries,
  joinQueue,
  getMyQueueStatus,
  callPatient,
  startService,
  completePatient,
  skipPatient,
  markNoShow,
  cancelEntry,
  requeueEntry,
  getQueueMetrics,
  addWalkIn,
};