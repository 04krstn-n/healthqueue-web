/**
 * Appointment Controller — Booking, scheduling, and slot management
 */
const Appointment = require('../models/Appointment');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient');
const TimeSlot = require('../models/TimeSlot');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');

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
    const { clinicId, status, date } = req.query;
    const filter = {};

    if (req.user.role === 'facility_admin' && req.user.clinicId) {
      filter.clinic = req.user.clinicId;
    } else if (clinicId) {
      filter.clinic = clinicId;
    }

    if (status) filter.status = status;
    if (date) {
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
  getAvailableSlots,
  getTodayAppointments,
  getTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
};