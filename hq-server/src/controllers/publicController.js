/**
 * Public (no-login) endpoints.
 *
 * getQueueBoard powers the "Now Serving" display for a TV/monitor in the clinic
 * waiting room. It is intentionally PUBLIC (the screen has nobody logged in),
 * so it exposes the minimum possible: ticket numbers, counts and the SERVICE
 * LINE each ticket is waiting in (a clinic's public service names) — never
 * patient names, phone numbers, patient types, or priority flags.
 */
const mongoose = require('mongoose');
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const { groupByLine, lineKeyOf } = require('../utils/visitHold');
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

    const clinic = await Clinic.findById(clinicId).select('name status services');
    if (!clinic) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Clinic not found.' });
    }

    const entries = await QueueEntry.find({
      clinic: clinicId,
      status: { $in: ['waiting', 'called', 'serving'] },
      joinedAt: todayRange(),
    })
      .select('queueNumber status priority queueType joinedAt createdAt calledAt servedAt clinic serviceId serviceName')
      .sort({ joinedAt: 1 });

    const waiting = entries.filter((e) => e.status === 'waiting');
    const ratio = await getPriorityRatio(clinicId);
    // Each service has its own line, ordered like the tablet and patient app.
    // A patient in several lines holds ONE ticket number (shared by the lines),
    // so the board lists each ticket once: at its best position, and not at all
    // while that same ticket is already called/serving at another service.
    const lines = [...groupByLine(waiting).values()].map((g) => orderQueueByPriorityRatio(g, ratio));
    const activeTickets = new Set(
      entries.filter((e) => e.status === 'called' || e.status === 'serving').map((e) => e.queueNumber)
    );
    const best = new Map();
    for (const line of lines) {
      line.forEach((e, i) => {
        if (activeTickets.has(e.queueNumber)) return;
        const prev = best.get(e.queueNumber);
        if (!prev || i + 1 < prev.position) best.set(e.queueNumber, { ticket: e.queueNumber, position: i + 1, joinedAt: e.joinedAt });
      });
    }
    const ordered = [...best.values()].sort(
      (a, b) => a.position - b.position || new Date(a.joinedAt) - new Date(b.joinedAt)
    );

    // Most recently called/started first — that's the ticket people look for.
    // One tile per ticket even if it is called at two services.
    const activeSorted = entries
      .filter((e) => e.status === 'called' || e.status === 'serving')
      .sort((a, b) => new Date(b.calledAt || b.servedAt || 0) - new Date(a.calledAt || a.servedAt || 0));
    const seenTicket = new Set();
    const active = activeSorted.filter((e) => (seenTicket.has(e.queueNumber) ? false : seenTicket.add(e.queueNumber)));

    // One column per service. Every available service of the clinic gets a
    // column (even when empty), keyed by service NAME so two catalog rows with
    // the same name never produce two columns. A multi-service patient's single
    // ticket number appears in each of its lines; a waiting ticket whose patient
    // is called/serving at ANOTHER service goes to that column's "on hold" list.
    const nameKey = (n) => String(n || 'General').trim().toLowerCase();
    const activeAt = new Map(); // ticket -> service where it is called/serving
    for (const e of entries) {
      if (e.status === 'called' || e.status === 'serving') activeAt.set(e.queueNumber, e.serviceName);
    }
    const lineMap = new Map();
    const ensure = (name) => {
      const k = nameKey(name);
      if (!lineMap.has(k)) lineMap.set(k, { service: String(name || 'General').trim(), nowServing: [], waiting: [], onHold: [] });
      return lineMap.get(k);
    };
    for (const svc of clinic.services || []) {
      if (svc && svc.name && svc.isAvailable !== false) ensure(svc.name);
    }
    activeSorted.forEach((e) => ensure(e.serviceName).nowServing.push({ ticket: e.queueNumber, status: e.status }));
    const byName = new Map();
    for (const e of waiting) {
      const k = nameKey(e.serviceName);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(e);
    }
    for (const g of byName.values()) {
      const line = ensure(g[0].serviceName);
      orderQueueByPriorityRatio(g, ratio).forEach((e) => {
        const at = activeAt.get(e.queueNumber);
        if (at) line.onHold.push({ ticket: e.queueNumber, heldAt: at });
        else line.waiting.push({ ticket: e.queueNumber });
      });
    }
    const boardLines = [...lineMap.values()].map((l) => ({
      ...l,
      waiting: l.waiting.slice(0, NEXT_UP_LIMIT).map((t, i) => ({ ...t, position: i + 1 })),
      onHold: l.onHold.slice(0, NEXT_UP_LIMIT),
    }));
    // Order = the clinic's own service list order (then any service that only
    // exists in today's entries), so removing a service shifts later ones left.

    res.set('Cache-Control', 'no-store');
    return res.status(HttpStatus.OK).json({
      success: true,
      clinic: { name: clinic.name, status: clinic.status },
      nowServing: active.slice(0, NOW_SERVING_LIMIT).map((e) => ({
        ticket: e.queueNumber,
        status: e.status, // 'called' = please come to the counter; 'serving' = in consultation
      })),
      nextUp: ordered.slice(0, NEXT_UP_LIMIT).map((e, i) => ({
        ticket: e.ticket,
        position: i + 1,
      })),
      lines: boardLines,
      waitingCount: new Set(waiting.map((e) => e.queueNumber)).size,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getQueueBoard Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to load queue board.' });
  }
};

module.exports = { getQueueBoard };
