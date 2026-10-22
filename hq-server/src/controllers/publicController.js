/**
 * Public (no-login) endpoints.
 *
 * getQueueBoard powers the "Now Serving" display for a TV/monitor in the clinic
 * waiting room. It is intentionally PUBLIC (the screen has nobody logged in),
 * so it exposes the minimum possible: ticket numbers and counts only — never
 * patient names, phone numbers, services, patient types, or priority flags.
 */
const mongoose = require('mongoose');
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const { orderQueueByPriorityRatio, getPriorityRatio } = require('../utils/queueHelpers');
const { HttpStatus } = require('../config/config');

const NOW_SERVING_LIMIT = 6;
const NEXT_UP_LIMIT = 8;

const todayRange = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return { $gte: start, $lte: end };
};

// GET /api/public/queue-board/:clinicId
const getQueueBoard = async (req, res) => {
  try {
    const { clinicId } = req.params;
    if (!mongoose.isValidObjectId(clinicId)) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }

    const clinic = await Clinic.findById(clinicId).select('name status');
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }

    const entries = await QueueEntry.find({
      clinic: clinicId,
      status: { $in: ['waiting', 'called', 'serving'] },
      joinedAt: todayRange(),
    })
      .select('queueNumber status priority queueType joinedAt createdAt calledAt servedAt')
      .sort({ joinedAt: 1 });

    const waiting = entries.filter((e) => e.status === 'waiting');
    const ratio = await getPriorityRatio(clinicId);
    // Same ordering the tablet and patient app use, so the board never
    // disagrees with what staff see.
    const ordered = orderQueueByPriorityRatio(waiting, ratio);

    // Most recently called/started first — that's the ticket people look for.
    const active = entries
      .filter((e) => e.status === 'called' || e.status === 'serving')
      .sort((a, b) => new Date(b.calledAt || b.servedAt || 0) - new Date(a.calledAt || a.servedAt || 0));

    res.set('Cache-Control', 'no-store');
    return res.status(HttpStatus.OK).json({
      success: true,
      clinic: { name: clinic.name, status: clinic.status },
      nowServing: active.slice(0, NOW_SERVING_LIMIT).map((e) => ({
        ticket: e.queueNumber,
        status: e.status, // 'called' = please come to the counter; 'serving' = in consultation
      })),
      nextUp: ordered.slice(0, NEXT_UP_LIMIT).map((e, i) => ({
        ticket: e.queueNumber,
        position: i + 1,
      })),
      waitingCount: waiting.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getQueueBoard Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to load queue board.' });
  }
};

module.exports = { getQueueBoard };
