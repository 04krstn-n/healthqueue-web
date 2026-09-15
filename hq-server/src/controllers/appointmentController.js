/**
 * Appointment Controller — Booking, scheduling, and slot management
 */
const Appointment = require('../models/Appointment');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient');
const TimeSlot = require('../models/TimeSlot');
const QueueEntry = require('../models/QueueEntry');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');
const { getNextQueueNumber, estimateWaitTime } = require('../utils/queueHelpers');

// ─── Appointment ↔ Queue check-in rules (Capstone Requirement #5) ───────────
// An appointment enters the ACTIVE queue only at check-in, never at booking
// time (see checkInAppointment below) — this is the "do not place every
// future appointment into the queue hours before its slot" requirement.
//
// Patients may check in starting this many minutes BEFORE their slot...
const EARLY_CHECKIN_WINDOW_MINUTES = 15;
// ...and are still treated as "on time" (keep their reserved slot position)
// up to this many minutes AFTER it. Beyond that grace window, checking in
// no longer honors the original slot — they queue based on when they
// actually showed up, same as a walk-in arriving at that moment.
const LATE_GRACE_MINUTES = 10;

/**
 * Computes the effective "joinedAt" an appointment check-in should use for
 * queue ordering. This is the key idea that lets appointment patients slot
 * into the SAME priority-ratio-ordered timeline as walk-ins (item 5)
 * without any separate appointment-vs-walk-in logic anywhere else in the
 * queue:
 *   - Checking in early or on time -> effectiveJoinedAt = the scheduled
 *     slot time (never earlier), so arriving 20 minutes early doesn't grant
 *     an earlier queue position than the slot itself, and doesn't cut in
 *     front of walk-ins who joined earlier than the slot time.
 *   - Checking in late (beyond the grace window) -> effectiveJoinedAt = the
 *     actual check-in time, i.e. they lose their reserved slot and queue
 *     like a walk-in arriving right now.
 */
const computeEffectiveJoinedAt = (appointmentDateTime, checkInTime) => {
  const graceDeadline = new Date(appointmentDateTime.getTime() + LATE_GRACE_MINUTES * 60 * 1000);
  return checkInTime <= graceDeadline ? new Date(appointmentDateTime) : new Date(checkInTime);
};

/**
 * Shared core: turns a confirmed Appointment into a live QueueEntry. Used by
 * both the patient's self check-in (checkInAppointment) and staff marking
 * an appointment "arrived" from the tablet (updateStatus) — one function,
 * so the two paths can never diverge in how positioning is calculated.
 */
const checkInAppointmentToQueue = async (appointment, req) => {
  const clinic = await Clinic.findById(appointment.clinic);
  if (!clinic) throw new Error('Clinic not found.');

  const now = new Date();
  const effectiveJoinedAt = computeEffectiveJoinedAt(appointment.appointmentDate, now);

  const prefix = (clinic.name.charAt(0) || 'Q').toUpperCase();
  const queueNumber = await getNextQueueNumber(appointment.clinic, prefix);
  const estWait = await estimateWaitTime(appointment.clinic, appointment.serviceId);

  const entry = await QueueEntry.create({
    clinic: appointment.clinic,
    patient: appointment.patient,
    patientName: appointment.patientName,
    patientPhone: appointment.patientPhone,
    patientType: appointment.patientType || 'Regular',
    serviceName: appointment.serviceName,
    serviceId: appointment.serviceId || null,
    queueNumber,
    queueType: appointment.patientType && appointment.patientType !== 'Regular' ? 'Priority' : 'Regular',
    priority: Boolean(appointment.patientType && appointment.patientType !== 'Regular'),
    joinedRemotely: false,
    estimatedWaitMinutes: estWait,
    joinedAt: effectiveJoinedAt,
  });

  appointment.status = 'arrived';
  appointment.arrivedAt = now;
  appointment.queueEntry = entry._id;
  await appointment.save();

  await Clinic.findByIdAndUpdate(appointment.clinic, { $inc: { queueLength: 1 } });

  const io = req?.app?.get('io');
  if (io) {
    io.to(`clinic_${appointment.clinic}`).emit('queue_entry_added', { entry, fromAppointment: true });
  }

  return entry;
};

// POST /api/appointments — Patient books an appointment
const bookAppointment = async (req, res) => {
  try {
    let { 
      clinicId, 
      serviceName, 
      serviceId, 
      staffId, 
      appointmentDate, 
      timeSlot, 
      endTime, 
      reason, 
      notes 
    } = req.body;

    if (!clinicId || !appointmentDate) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Clinic ID and appointment date are required.',
      });
    }

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

    // 1. Auto-fetch serviceName from clinic.services if serviceId is provided
    if (!serviceName && serviceId && Array.isArray(clinic.services)) {
      const foundService = clinic.services.find(
        (s) => s._id?.toString() === serviceId.toString() || s.id?.toString() === serviceId.toString()
      );
      if (foundService) {
        serviceName = foundService.name || foundService.serviceName;
      }
    }

    // 2. Fallback to the first service if still not set
    if (!serviceName && clinic.services && clinic.services.length > 0) {
      serviceName = clinic.services[0].name || clinic.services[0].serviceName;
      serviceId = serviceId || clinic.services[0]._id;
    }

    // 3. Fallback default serviceName if none found
    if (!serviceName) {
      serviceName = 'General Consultation';
    }

    // 4. Default timeSlot if omitted
    if (!timeSlot) {
      timeSlot = '09:00 AM';
    }

    const apptDate = new Date(appointmentDate);
    const dayStart = new Date(apptDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(apptDate); dayEnd.setHours(23, 59, 59, 999);

    // Prevent duplicate booking for the same time slot
    const existing = await Appointment.findOne({
      clinic: clinicId,
      patient: req.user._id,
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      timeSlot,
      status: { $nin: ['cancelled', 'no_show'] },
    });

    if (existing) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'You already have an appointment scheduled for this time slot.',
      });
    }

    const appointment = await Appointment.create({
      clinic: clinicId,
      patient: req.user._id,
      staff: staffId || null,
      serviceName,
      serviceId: serviceId || null,
      appointmentDate: apptDate,
      timeSlot,
      endTime: endTime || '',
      patientName: req.user.fullName || 'Patient',
      patientPhone: req.user.phone || '',
      reason: reason || notes || '',
      notes: notes || '',
      status: 'pending',
    });

    // Safely increment booked count on TimeSlot if schema/collection exists
    try {
      await TimeSlot.findOneAndUpdate(
        { clinic: clinicId, label: timeSlot },
        { $inc: { bookedCount: 1 } }
      );
    } catch (e) {
      // Non-blocking if TimeSlot collection is empty
    }

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: 'Appointment booked successfully.',
      data: appointment,
      appointment: {
        _id: appointment._id,
        clinicName: clinic.name,
        clinicAddress: clinic.address,
        serviceName,
        appointmentDate: appointment.appointmentDate,
        timeSlot,
        status: 'pending',
      },
    });
  } catch (err) {
    console.error('bookAppointment Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: err.message || 'Failed to book appointment.' 
    });
  }
};

// GET /api/appointments/my — Patient fetches own appointments
const getMyAppointments = async (req, res) => {
  try {
    const appts = await Appointment.find({ patient: req.user._id })
      .populate('clinic', 'name address contactNumber')
      .sort({ appointmentDate: -1 });

    return res.status(HttpStatus.OK).json({ 
      success: true, 
      count: appts.length,
      data: appts,
      appointments: appts 
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to fetch appointments.' 
    });
  }
};

// PUT /api/appointments/:id — Reschedules or updates appointment details
const updateAppointment = async (req, res) => {
  try {
    const { appointmentDate, timeSlot, notes, reason } = req.body;
    const appt = await Appointment.findById(req.params.id);

    if (!appt) {
      return res.status(HttpStatus.NOT_FOUND).json({ 
        success: false, 
        message: 'Appointment not found.' 
      });
    }

    if (req.user.role === 'patient' && appt.patient.toString() !== req.user._id.toString()) {
      return res.status(HttpStatus.FORBIDDEN).json({ 
        success: false, 
        message: 'Not authorized to modify this appointment.' 
      });
    }

    // Same rule as updateStatus — a cancelled appointment can't be
    // rescheduled/edited either, by staff or the patient.
    if (appt.status === 'cancelled') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'This appointment was cancelled and cannot be modified.',
      });
    }

    if (appointmentDate) appt.appointmentDate = new Date(appointmentDate);
    if (timeSlot) appt.timeSlot = timeSlot;
    if (notes) appt.notes = notes;
    if (reason) appt.reason = reason;

    await appt.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Appointment updated successfully.',
      data: appt,
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to update appointment.' 
    });
  }
};

// PUT /api/appointments/:id/cancel or cancel-my — Patient cancels appointment
const cancelMyAppointment = async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) {
      return res.status(HttpStatus.NOT_FOUND).json({ 
        success: false, 
        message: 'Appointment not found.' 
      });
    }

    if (req.user.role === 'patient' && appt.patient.toString() !== req.user._id.toString()) {
      return res.status(HttpStatus.FORBIDDEN).json({ 
        success: false, 
        message: 'Not authorized to cancel this appointment.' 
      });
    }

    appt.status = 'cancelled';
    appt.cancelledBy = req.user.role || 'patient';
    appt.cancellationReason = req.body.reason || 'Cancelled by patient';
    appt.cancelledAt = new Date();
    await appt.save();

    return res.status(HttpStatus.OK).json({ 
      success: true, 
      message: 'Appointment cancelled successfully.',
      data: appt 
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to cancel appointment.' 
    });
  }
};

// GET /api/appointments — Staff/Admin fetches appointments
const getAppointments = async (req, res) => {
  try {
    const { clinicId, status, date, dateFrom, dateTo } = req.query;
    const filter = {};

    if (req.user.role === 'facility_admin' && req.user.clinicId) {
      filter.clinic = req.user.clinicId;
    } else if (clinicId) {
      filter.clinic = clinicId;
    }

    if (status) filter.status = status;

    // dateFrom/dateTo let callers request a multi-day window (e.g. staff
    // reviewing today + the next few days to confirm upcoming appointments)
    // instead of only ever fetching one day at a time. `date` (single day)
    // is kept working as before for existing callers.
    if (dateFrom || dateTo) {
      const range = {};
      if (dateFrom) {
        const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
        range.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      filter.appointmentDate = range;
    } else if (date) {
      const d = new Date(date);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end   = new Date(d); end.setHours(23, 59, 59, 999);
      filter.appointmentDate = { $gte: start, $lte: end };
    }

    const appts = await Appointment.find(filter)
      .populate('clinic', 'name address')
      .populate('patient', 'fullName phone email')
      .sort({ appointmentDate: 1 });

    return res.status(HttpStatus.OK).json({ 
      success: true, 
      count: appts.length,
      data: appts,
      appointments: appts 
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to fetch appointments.' 
    });
  }
};

// GET /api/appointments/available-slots — Public available slots query
const getAvailableSlots = async (req, res) => {
  try {
    const { clinicId, date } = req.query;
    const defaultSlots = [
      '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
      '11:00 AM', '11:30 AM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
      '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM',
    ];

    if (!clinicId || !date) {
      return res.status(HttpStatus.OK).json({ success: true, data: defaultSlots });
    }

    const d = new Date(date);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end   = new Date(d); end.setHours(23, 59, 59, 999);

    const booked = await Appointment.find({
      clinic: clinicId,
      appointmentDate: { $gte: start, $lte: end },
      status: { $nin: ['cancelled', 'no_show'] },
    }).select('timeSlot');

    const counts = {};
    booked.forEach((a) => { counts[a.timeSlot] = (counts[a.timeSlot] || 0) + 1; });

    const available = defaultSlots.filter((s) => (counts[s] || 0) < 3);

    return res.status(HttpStatus.OK).json({ success: true, data: available });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to fetch available slots.' 
    });
  }
};

// ── TimeSlot Management (Admin) ──────────────────────────────────────────────
const getTimeSlots = async (req, res) => {
  try {
    const { clinicId } = req.query;
    const filter = clinicId ? { clinic: clinicId } : {};
    const slots = await TimeSlot.find(filter).populate('clinic', 'name');
    return res.status(HttpStatus.OK).json({ success: true, data: slots });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to fetch time slots.' 
    });
  }
};

const createTimeSlot = async (req, res) => {
  try {
    const slot = await TimeSlot.create(req.body);
    return res.status(HttpStatus.CREATED).json({ success: true, data: slot });
  } catch (err) {
    return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: err.message });
  }
};

const updateTimeSlot = async (req, res) => {
  try {
    const slot = await TimeSlot.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!slot) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Time slot not found.' });
    }
    return res.status(HttpStatus.OK).json({ success: true, data: slot });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to update time slot.' 
    });
  }
};

const deleteTimeSlot = async (req, res) => {
  try {
    await TimeSlot.findByIdAndDelete(req.params.id);
    return res.status(HttpStatus.OK).json({ success: true, message: 'Time slot deleted.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Failed to delete time slot.' 
    });
  }
};

const getAppointment = async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id).populate('clinic patient');
    if (!appt) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Not found.' });
    return res.status(HttpStatus.OK).json({ success: true, data: appt });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    // Full state-machine enforcement — the client (appointment_management_
    // screen.dart's _validNextStatuses) only offers valid transitions in
    // its UI, but that alone isn't enforcement; a direct API call could
    // still skip straight from e.g. 'pending' to 'completed', or "revive"
    // a terminal appointment. This mirrors the same rules the UI offers.
    const VALID_TRANSITIONS = {
      pending:   ['confirmed', 'cancelled'],
      confirmed: ['arrived', 'cancelled', 'no_show'],
      arrived:   ['serving', 'cancelled', 'no_show'],
      serving:   ['completed'],
      completed: [],
      cancelled: [],
      no_show:   [],
    };

    const existing = await Appointment.findById(req.params.id).select('status');
    if (!existing) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Appointment not found.' });
    }

    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(req.body.status)) {
      const isTerminal = allowed.length === 0;
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: isTerminal
          ? `This appointment is ${existing.status} and cannot be modified.`
          : `Cannot move an appointment from "${existing.status}" to "${req.body.status}".`,
      });
    }

    // 'arrived' is special-cased: staff marking a patient arrived from the
    // tablet must ALSO create the live queue entry (item 5) — otherwise a
    // patient checked in by staff would be "arrived" but never actually
    // enter the queue, exactly the disconnect the confirmed->arrived
    // transition used to have.
    if (req.body.status === 'arrived') {
      const fullAppt = await Appointment.findById(req.params.id);
      const appt = await checkInAppointmentToQueue(fullAppt, req);
      await logAction({
        actor: req.user, action: 'update', targetType: 'Appointment', targetId: fullAppt._id,
        targetLabel: `${fullAppt.patientName} — ${fullAppt.serviceName}`, clinicId: fullAppt.clinic,
        details: { status: 'arrived', checkedInBy: 'staff' },
      });
      return res.status(HttpStatus.OK).json({ success: true, data: fullAppt, queueEntry: appt });
    }

    const appt = await Appointment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });

    if (appt) {
      // Map to the specific audit action when we have one, otherwise fall
      // back to a generic 'update' so any status value is still recorded.
      const actionForStatus = { completed: 'complete', no_show: 'no_show' };
      await logAction({
        actor: req.user,
        action: actionForStatus[appt.status] || 'update',
        targetType: 'Appointment',
        targetId: appt._id,
        targetLabel: `${appt.patientName} — ${appt.serviceName}`,
        clinicId: appt.clinic,
        details: { status: appt.status },
      });
    }

    return res.status(HttpStatus.OK).json({ success: true, data: appt });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// PUT /api/appointments/:id/check-in — Patient self check-in (mobile). This
// is the ONLY moment a booked appointment enters the live queue (item 5,
// answers "when does the patient officially enter the queue?").
const checkInAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Appointment not found.' });
    }
    if (appointment.patient.toString() !== req.user._id.toString()) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'Not authorized for this appointment.' });
    }
    if (appointment.status !== 'confirmed') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot check in — appointment status is "${appointment.status}", not "confirmed".`,
      });
    }

    const now = new Date();
    const windowOpensAt = new Date(appointment.appointmentDate.getTime() - EARLY_CHECKIN_WINDOW_MINUTES * 60 * 1000);
    if (now < windowOpensAt) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Check-in opens at ${windowOpensAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} (${EARLY_CHECKIN_WINDOW_MINUTES} min before your slot).`,
      });
    }

    const entry = await checkInAppointmentToQueue(appointment, req);
    const isLate = now > new Date(appointment.appointmentDate.getTime() + LATE_GRACE_MINUTES * 60 * 1000);

    return res.status(HttpStatus.OK).json({
      success: true,
      message: isLate
        ? 'Checked in. You arrived after your slot\'s grace period, so you have been queued based on your actual arrival time.'
        : 'Checked in successfully. You have been added to the active queue.',
      data: appointment,
      queueEntry: entry,
      wasLate: isLate,
    });
  } catch (err) {
    console.error('checkInAppointment Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to check in.' });
  }
};

const getTodayAppointments = async (req, res) => {
  try {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);

    // This used to ignore clinicId entirely, so staff either saw every
    // clinic's appointments mixed together or — depending on how the
    // frontend filtered the result — none of their own. Scope it the same
    // way getAppointments() does: facility_admin/staff use their assigned
    // clinic, everyone else (e.g. super_admin) can pass ?clinicId=.
    const filter = { appointmentDate: { $gte: start, $lte: end } };
    if (['facility_admin', 'staff'].includes(req.user.role) && req.user.clinicId) {
      filter.clinic = req.user.clinicId;
    } else if (req.query.clinicId) {
      filter.clinic = req.query.clinicId;
    }

    const appts = await Appointment.find(filter).populate('clinic patient');
    return res.status(HttpStatus.OK).json({ success: true, data: appts });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

module.exports = {
  getMyAppointments,
  cancelMyAppointment,
  bookAppointment,
  updateAppointment,
  getAppointments,
  getAppointment,
  updateStatus,
  checkInAppointment,
  getAvailableSlots,
  getTodayAppointments,
  getTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
};