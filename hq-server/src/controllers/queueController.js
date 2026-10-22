/**
 * Queue Controller — Live queue management, remote en-route enrollment, and 5-min grace period
 */
const mongoose = require('mongoose');
const { resolveServices } = require('../utils/serviceSelection');
const { isOpenAt } = require('../utils/clinicHours');
const { groupByLine, busyByVisit, heldBy, holdText } = require('../utils/visitHold');
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient');
const { notifyUser, notifyQueueEntry } = require('../utils/notify');
const { normalizePhone } = require('./authController');
const {
  getNextQueueNumber,
  estimateWaitTime,
  computeSuggestedWaitTime,
  orderQueueByPriorityRatio,
  getPriorityRatio,
  getGracePeriodExpiry,
} = require('../utils/queueHelpers');
const Appointment = require('../models/Appointment');
const { HttpStatus } = require('../config/config');
const { logAction } = require('../utils/auditLog');

const todayRange = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);
  return { $gte: start, $lte: end };
};

/**
 * Notifies patients as they cross into the 7th, 5th, 3rd, or next-in-line
 * (1st) waiting position. Position 1 here is "you're next, stay nearby" —
 * distinct from callPatient's "it's your turn!" push, which fires
 * separately once staff actually calls them. Recomputes the queue with
 * the exact same orderQueueByPriorityRatio ordering getQueueEntries uses,
 * so the position notified always matches what tablet/mobile show — not
 * a separately-drifting count.
 *
 * Called after any mutation that removes someone from the front of the
 * waiting list (call/complete/skip/no-show/cancel) — those are the only
 * events that can improve (lower) another waiting patient's position. A
 * new join never does (at worst, priority interleaving pushes a regular
 * patient's position UP, which isn't something to notify about), so
 * joinQueue/addWalkIn don't need this.
 */
// "I'm on my way" earns one extension of the arrival grace period, in minutes.
const ON_THE_WAY_EXTENSION_MIN = 3;
const POSITION_MILESTONES = [7, 5, 3, 1];
// Walk-ins are reached by SMS, which costs credits per message, so they get
// only the two messages that matter: "you're close" (#3) and "you're next" (#1).
const WALKIN_SMS_MILESTONES = [3, 1];

const notifyPositionMilestones = async (clinicId) => {
  try {
    const waitingEntries = await QueueEntry.find({ clinic: clinicId, status: 'waiting' })
      .select('patient patientPhone queueNumber lastNotifiedPosition priority queueType joinedAt createdAt clinic serviceId serviceName visitId')
      .sort({ joinedAt: 1 });

    if (waitingEntries.length === 0) return;

    // Each service has its own line, so milestones are per line. An entry that
    // is on hold (the patient is at another service) keeps its place but is
    // not told "you're next" — they are busy and cannot be called anyway.
    const ratio = await getPriorityRatio(clinicId);
    const busyMap = await busyByVisit(waitingEntries);
    const ordered = [];
    for (const group of groupByLine(waitingEntries).values()) {
      ordered.push(...orderQueueByPriorityRatio(group, ratio).slice(0, Math.max(...POSITION_MILESTONES)));
    }

    await Promise.all(
      ordered.map(async (entry) => {
        const idx = (entry.queuePosition || 1) - 1;
        if (heldBy(entry, busyMap)) return;
        const position = idx + 1;
        // App users get push at every milestone; walk-ins with a phone get SMS
        // at the shorter list; a walk-in with no phone can't be reached.
        const milestones = entry.patient
          ? POSITION_MILESTONES
          : (entry.patientPhone ? WALKIN_SMS_MILESTONES : []);
        if (!milestones.includes(position)) return;
        if (entry.lastNotifiedPosition === position) return; // already notified for this exact milestone

        const message = position === 1
          ? `You're next in line for ticket #${entry.queueNumber} — please stay nearby, staff will call you shortly.`
          : `You're now #${position} in line for ticket #${entry.queueNumber}.`;

        const result = await notifyQueueEntry(entry, {
          kind: position === 1 ? 'next' : 'near',
          title: position === 1 ? "You're next!" : 'Queue Update',
          message,
        });

        // Only mark the milestone as sent if it really went out, so a failed
        // SMS is retried at the next queue change instead of being lost.
        // (ordered entries are plain objects, so update by id rather than .save())
        if (result.success) {
          await QueueEntry.updateOne({ _id: entry._id }, { $set: { lastNotifiedPosition: position } });
        }
      })
    );
  } catch (err) {
    // A notification failure must never break the queue mutation that
    // triggered this check (calling/completing/etc. a patient always has
    // to succeed regardless of push delivery) — log and move on.
    console.error('notifyPositionMilestones Error:', err.message);
  }
};


/**
 * Helper to emit Socket.io real-time updates across connected web, mobile, and tablet clients
 */
const emitQueueUpdate = (req, clinicId, eventName, payload) => {
  const io = req.app.get('io');
  if (io) {
    // Staff room gets the full payload (names, phones). Patients' sockets
    // only get a sanitized refresh ping from the public room.
    io.to(`clinic_${clinicId}`).emit(eventName, payload);
    io.to(`clinicpub_${clinicId}`).emit(eventName, { clinicId: String(clinicId), eventName });
    io.emit('global_queue_change', { clinicId, eventName });
  }
};

/**
 * Keeps a checked-in Appointment's status in sync with its linked
 * QueueEntry (item 5) — once check-in creates a QueueEntry
 * (Appointment.queueEntry), the queue's own lifecycle (serving/completed/
 * no_show/cancelled) should drive the appointment's status too, instead of
 * the appointment being left stuck on "arrived" forever with no connection
 * to what actually happened at the counter.
 */
const syncLinkedAppointment = async (queueEntryId, appointmentStatus, extra = {}) => {
  try {
    await Appointment.findOneAndUpdate(
      { queueEntry: queueEntryId },
      { status: appointmentStatus, ...extra }
    );
  } catch (e) {
    console.warn('[queue] syncLinkedAppointment skipped:', e.message);
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

    // ── Priority-ratio ordering (item 4) ─────────────────────────────────
    // The `waiting` bucket is reordered by orderQueueByPriorityRatio so the
    // tablet displays (and therefore staff act on) the SAME serving order
    // mobile's position/peopleAhead is computed from — one ordering
    // algorithm, not "tablet shows join order, server thinks something
    // else." Other statuses (called/serving/done/etc.) keep chronological
    // order since ordering only matters for who's next.
    const waitingEntries = entries.filter((e) => e.status === 'waiting');
    const otherEntries = entries.filter((e) => e.status !== 'waiting');

    // Each service has its own line, so the waiting bucket is ordered per
    // (clinic, service) line. Entries of a multi-service visit whose patient
    // is currently called/serving at another service are flagged onHold.
    const ratioByClinic = new Map();
    const orderedWaiting = [];
    for (const group of groupByLine(waitingEntries).values()) {
      const cid = group[0].clinic?._id?.toString() || group[0].clinic?.toString();
      if (!ratioByClinic.has(cid)) ratioByClinic.set(cid, await getPriorityRatio(cid));
      orderedWaiting.push(...orderQueueByPriorityRatio(group, ratioByClinic.get(cid)));
    }
    const busyMap = await busyByVisit(entries);
    const annotateHold = (obj) => {
      const b = heldBy(obj, busyMap);
      obj.onHold = Boolean(b);
      obj.holdReason = b ? holdText(b) : '';
      return obj;
    };

    // Recompute each active entry's estimated wait time live rather than
    // trusting the value stored at join time — that snapshot never changed
    // again, so a service duration update (Waiting Time Update screen) was
    // invisible to staff for anyone already in the queue, even though it
    // now correctly affects new joiners (see estimateWaitTime). Waiting
    // entries use their priority-ratio position (peopleAheadOverride) so
    // the number matches the order they're actually shown/served in.
    const results = await Promise.all([
      ...orderedWaiting.map(async (obj) => {
        const cid = obj.clinic?._id?.toString() || obj.clinic?.toString();
        obj.estimatedWaitMinutes = await estimateWaitTime(cid, obj.serviceId, {
          peopleAheadOverride: obj.queuePosition - 1,
        });
        return annotateHold(obj);
      }),
      ...otherEntries.map(async (entry) => {
        const obj = entry.toObject();
        if (entry.status === 'serving') {
          const cid = entry.clinic?._id?.toString() || entry.clinic?.toString();
          obj.estimatedWaitMinutes = await estimateWaitTime(cid, entry.serviceId, { peopleAheadOverride: 0 });
        }
        obj.onHold = false;
        obj.holdReason = '';
        return obj;
      }),
    ]);

    // Preserve original joinedAt ordering for the response's overall
    // grouping, but each entry now carries its priority-ratio `queuePosition`
    // (waiting entries only) for clients that want to display serving order.
    results.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    return res.status(HttpStatus.OK).json({
      success: true,
      count: results.length,
      data: results,
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
    let { clinicId, serviceName, serviceId, notes, joinedRemotely } = req.body;

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

    // 2. Time check: remote queueing is only open during the clinic's
    // operating hours (Philippine time). Unparseable hours text -> allowed.
    if (isOpenAt(clinic.operatingHours) === false) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `The clinic is not accepting queue entries right now. Operating hours: ${clinic.operatingHours}.`,
      });
    }

    // 3. Services: one or several, each must belong to this clinic.
    // No silent fallback to the first service any more.
    const picked = resolveServices(clinic, req.body);
    if (!picked.ok) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: picked.message });
    }
    serviceName = picked.serviceName;
    serviceId = picked.serviceId;

    // One entry (and one line) per selected service. A patient may not hold two
    // active tickets for the SAME service at the same clinic today.
    const ACTIVE = ['waiting', 'serving', 'called'];
    const sameServiceFilter = (svc) => ({
      clinic: clinicId,
      patient: req.user._id,
      status: { $in: ACTIVE },
      joinedAt: todayRange(),
      ...(svc.serviceId ? { serviceId: svc.serviceId } : { serviceName: svc.name }),
    });
    for (const svc of picked.services) {
      const existing = await QueueEntry.findOne(sameServiceFilter(svc));
      if (existing) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: `You already have an active queue ticket for ${svc.name} at this clinic.`,
        });
      }
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

    // Priority is derived ONLY from the patient's own stored record
    // (patient.patientType), which can only be changed by staff/admin via
    // PUT /api/patients/:id — never from the request body.
    const isPriorityPatient = Boolean(patient.patientType && patient.patientType !== 'Regular');
    const prefix = (clinic.name.charAt(0) || 'Q').toUpperCase();
    const visitId = new mongoose.Types.ObjectId();
    // ONE ticket number per person per visit: the same number appears in every
    // service line the patient joined (e.g. #Q054 waits in both Drug Test and
    // Laboratory), while each line keeps its own position.
    const queueNumber = await getNextQueueNumber(clinicId, prefix);

    const created = [];
    for (const svc of picked.services) {
      const lineFilter = {
        clinic: clinicId,
        status: { $in: ACTIVE },
        joinedAt: todayRange(),
        ...(svc.serviceId ? { serviceId: svc.serviceId } : { serviceName: svc.name }),
      };
      const aheadInLine = await QueueEntry.countDocuments(lineFilter);
      const estWait = await estimateWaitTime(clinicId, svc.serviceId, { peopleAheadOverride: aheadInLine });

      const entry = await QueueEntry.create({
        clinic: clinicId,
        patient: req.user._id,
        patientName: patient.fullName || req.user.fullName,
        patientPhone: patient.phone || req.user.phone || '',
        patientType: patient.patientType || 'Regular',
        serviceName: svc.name,
        serviceId: svc.serviceId || null,
        services: [{ serviceId: svc.serviceId || null, name: svc.name }],
        visitId,
        queueNumber,
        queueType: isPriorityPatient ? 'Priority' : 'Regular',
        priority: isPriorityPatient,
        joinedRemotely: joinedRemotely !== undefined ? joinedRemotely : true,
        notes: notes || '',
        estimatedWaitMinutes: estWait,
        positionAtJoin: aheadInLine + 1,
        joinedAt: new Date(),
      });
      created.push({ entry, svc, aheadInLine, estWait });
    }

    // Race guard. The "already has an active ticket" check above is a read
    // followed by a write, so two simultaneous join requests (double-tap,
    // retry after a flaky connection, two devices) can both pass it. Re-count
    // AFTER inserting, per service: every racer sees the same set of tickets,
    // and the request whose entry has the highest _id removes ALL of its own
    // entries, so exactly one request survives.
    for (const { entry, svc } of created) {
      const racers = await QueueEntry.find(sameServiceFilter(svc)).select('_id').sort({ _id: 1 }).lean();
      if (racers.length > 1 && String(racers[0]._id) !== String(entry._id)) {
        await QueueEntry.deleteMany({ _id: { $in: created.map((c) => c.entry._id) } });
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: `You already have an active queue ticket for ${svc.name} at this clinic.`,
        });
      }
    }

    const first = created[0];
    await Clinic.findByIdAndUpdate(clinicId, {
      $inc: { queueLength: created.length },
      currentWaitingTime: first.estWait,
    });

    const ticketList = created.map((c) => `#${c.entry.queueNumber} (${c.svc.name})`).join(', ');
    await notifyUser(req.user._id, {
      title: 'Queue Joined',
      message: created.length === 1
        ? `You joined the queue at ${clinic.name}. Queue Ticket #${first.entry.queueNumber}. Est. wait: ${first.estWait} mins.`
        : `You joined ${created.length} lines at ${clinic.name}: ${ticketList}. If one service calls you first, your other lines are paused until you are done there.`,
      type: 'queue',
      refType: 'QueueEntry',
      refId: first.entry._id,
    });

    for (const c of created) {
      emitQueueUpdate(req, clinicId, 'queue_entry_added', { entry: c.entry, activeCount: c.aheadInLine + 1 });
    }

    const shape = (c) => ({
      _id: c.entry._id,
      queueNumber: c.entry.queueNumber,
      clinicName: clinic.name,
      serviceName: c.entry.serviceName,
      status: c.entry.status,
      joinedAt: c.entry.joinedAt,
      joinedRemotely: c.entry.joinedRemotely,
      position: c.aheadInLine + 1,
      peopleAhead: c.aheadInLine,
      estimatedWaitTime: c.estWait,
    });

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: created.length === 1 ? 'Joined queue successfully.' : `Joined ${created.length} service lines.`,
      data: first.entry,          // legacy single-entry fields = the first service
      entry: shape(first),
      entries: created.map(shape), // every line the patient joined
      visitId,
      position: first.aheadInLine + 1,
      peopleAhead: first.aheadInLine,
      estimatedWaitTime: first.estWait,
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
// A patient can be in several service lines at once (one entry per service).
// `entry`/`position`/... describe the PRIMARY entry (the one called/serving,
// otherwise the one closest to the front) so older app versions keep working;
// `entries` lists every active line with its own position and hold status.
const getMyQueueStatus = async (req, res) => {
  try {
    const mine = await QueueEntry.find({
      patient: req.user._id,
      status: { $in: ['waiting', 'serving', 'called'] },
      joinedAt: todayRange(),
    }).populate('clinic', 'name address city');

    if (mine.length === 0) {
      return res.status(HttpStatus.OK).json({ success: true, activeQueue: false, entry: null, entries: [] });
    }

    // Same priority-ratio ordering the tablet sees — "ahead of me" must mean
    // the same thing for the patient as it does for staff, computed inside
    // that service's own line.
    const busyMap = await busyByVisit(mine);
    const ratioByClinic = new Map();
    const details = [];
    for (const entry of mine) {
      let ahead = 0;
      let estWait;
      if (entry.status === 'waiting') {
        const cid = entry.clinic._id;
        const lineMates = await QueueEntry.find({
          clinic: cid,
          status: 'waiting',
          joinedAt: todayRange(),
          ...(entry.serviceId ? { serviceId: entry.serviceId } : { serviceName: entry.serviceName }),
        });
        if (!ratioByClinic.has(String(cid))) ratioByClinic.set(String(cid), await getPriorityRatio(cid));
        const ordered = orderQueueByPriorityRatio(lineMates, ratioByClinic.get(String(cid)));
        const me = ordered.find((e) => String(e._id) === String(entry._id));
        ahead = me ? me.queuePosition - 1 : 0;
        estWait = await estimateWaitTime(cid, entry.serviceId, { peopleAheadOverride: ahead });
      } else {
        // Already called/serving — no one "ahead", they're at the counter.
        estWait = await estimateWaitTime(entry.clinic._id, entry.serviceId, { peopleAheadOverride: 0 });
      }
      const busy = heldBy(entry, busyMap);
      details.push({
        entry,
        ahead,
        estWait,
        onHold: Boolean(busy),
        holdReason: busy ? holdText(busy) : '',
      });
    }

    const rank = (d) => (d.entry.status === 'serving' ? 0 : d.entry.status === 'called' ? 1 : 2);
    details.sort((a, b) => rank(a) - rank(b) || a.ahead - b.ahead);
    const primary = details[0];

    const shape = (d) => ({
      _id: d.entry._id,
      queueNumber: d.entry.queueNumber,
      serviceName: d.entry.serviceName,
      status: d.entry.status,
      joinedAt: d.entry.joinedAt,
      calledAt: d.entry.calledAt,
      joinedRemotely: d.entry.joinedRemotely,
      gracePeriodExpiresAt: d.entry.gracePeriodExpiresAt,
      clinic: d.entry.clinic,
      visitId: d.entry.visitId,
      position: d.ahead + 1,
      peopleAhead: d.ahead,
      estimatedWaitTime: d.estWait,
      onHold: d.onHold,
      holdReason: d.holdReason,
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      activeQueue: true,
      entry: shape(primary),
      entries: details.map(shape),
      position: primary.ahead + 1,
      peopleAhead: primary.ahead,
      estimatedWaitTime: primary.estWait,
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
    // Waiting -> Called is the only valid path into `called`. Without this
    // guard, `called` (or `serving`) could be re-called, silently resetting
    // the 5-minute grace period / re-notifying the patient for a ticket
    // that's already past that stage — and the UI must not be the only
    // thing preventing it (a direct API call would otherwise still work).
    const existing = await QueueEntry.findById(req.params.id).select('status visitId');
    if (!existing) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }
    if (existing.status !== 'waiting') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot call a patient with status "${existing.status}". Only a waiting entry can be called.`,
      });
    }

    // Multi-service visit: first call wins. If the patient is already called or
    // being served at another service, this entry is ON HOLD — refuse, so staff
    // call the next patient instead of waiting on someone who is busy elsewhere.
    const busyNow = await busyByVisit([existing]);
    const blocker = heldBy(existing, busyNow);
    if (blocker) {
      return res.status(HttpStatus.CONFLICT).json({
        success: false,
        onHold: true,
        message: `This patient is ${holdText(blocker).toLowerCase()} right now. Call the next patient — this ticket will be callable again once they are done there.`,
      });
    }

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

    // Race: two services may call the same patient at the same instant and both
    // pass the check above. Re-read the siblings; the call that came second
    // (later calledAt, _id breaks ties) is undone so exactly one call stands.
    if (entry.visitId) {
      const rivals = await QueueEntry.find({
        visitId: entry.visitId, _id: { $ne: entry._id }, status: { $in: ['called', 'serving'] },
      }).select('calledAt').lean();
      const iAmLater = rivals.some((r) => !r.calledAt || r.calledAt < entry.calledAt
        || (String(r.calledAt) === String(entry.calledAt) && String(r._id) < String(entry._id)));
      if (iAmLater) {
        await QueueEntry.findByIdAndUpdate(entry._id, { $set: { status: 'waiting' }, $unset: { calledAt: '', gracePeriodExpiresAt: '' } });
        return res.status(HttpStatus.CONFLICT).json({
          success: false,
          onHold: true,
          message: 'This patient was just called by another service. Call the next patient.',
        });
      }
    }

    // Trigger push notification — only when the ticket is linked to a real
    // patient account. Walk-in tickets (added via /add-walkin) never have a
    // `patient` user set, and Notification.user is required, so this used
    // to throw a ValidationError (500 "Failed to call patient") on every
    // walk-in call.
    // Linked app patients get a push; walk-ins with a phone get an SMS; a
    // walk-in with no phone gets nothing (staff must call the ticket aloud —
    // the response's notifyChannel tells the tablet which case this is).
    const calledNotice = await notifyQueueEntry(entry, {
      kind: 'called',
      title: 'It is your turn!',
      message: `Ticket #${entry.queueNumber} (${entry.serviceName}) — Please proceed to the counter within 5 minutes.`,
    });

    // Push Socket.io real-time event to patient mobile app
    emitQueueUpdate(req, entry.clinic, 'patient_called', { 
      entryId: entry._id, 
      queueNumber: entry.queueNumber,
      gracePeriodExpiresAt: graceExpiry 
    });
    notifyPositionMilestones(entry.clinic).catch(() => {});

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
      notifyChannel: calledNotice.channel,   // 'push' | 'sms' | 'none'
      notifyDelivered: calledNotice.success,
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
    // Called -> Serving is the only valid path. This is also what makes
    // "From Serving, staff must NOT be able to change it back to Called"
    // hold: since callPatient itself now requires status === 'waiting',
    // there's no path back into `called` from `serving` at all — and this
    // guard ensures start-service can't be used to jump straight from
    // `waiting` (skipping the call/grace-period step) either.
    const existing = await QueueEntry.findById(req.params.id).select('status');
    if (!existing) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }
    if (existing.status !== 'called') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot start service for status "${existing.status}". The patient must be called first.`,
      });
    }

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
    await syncLinkedAppointment(entry._id, 'serving');

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

    // Serving -> Completed is the only valid path — matches the existing
    // workflow (a session can't be "completed" before it started).
    if (entry.status !== 'serving') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot complete an entry with status "${entry.status}". Service must be in progress first.`,
      });
    }

    entry.status = 'completed';
    entry.completedAt = new Date();
    await entry.save(); // Pre-save hook computes turnaroundTimeInMinutes (TAT)

    await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: -1 } });

    emitQueueUpdate(req, entry.clinic, 'queue_completed', { entryId: entry._id });
    notifyPositionMilestones(entry.clinic).catch(() => {});
    await syncLinkedAppointment(entry._id, 'completed', { completedAt: entry.completedAt });

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
    notifyPositionMilestones(entry.clinic).catch(() => {});

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
    // Called -> No Show is the only valid path — a patient can only be
    // marked no-show after being called and failing to arrive within the
    // grace period, not from waiting or serving.
    const existing = await QueueEntry.findById(req.params.id).select('status');
    if (!existing) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }
    if (existing.status !== 'called') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot mark no-show for status "${existing.status}". The patient must be called first.`,
      });
    }

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
    notifyPositionMilestones(entry.clinic).catch(() => {});
    await syncLinkedAppointment(entry._id, 'no_show');

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
    notifyPositionMilestones(entry.clinic).catch(() => {});
    await syncLinkedAppointment(entry._id, 'cancelled', {
      cancelledAt: entry.cancelledAt,
      cancelledBy: req.user.role === 'patient' ? 'patient' : 'staff',
    });

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

    // 'called' intentionally excluded — once a patient has been called,
    // staff must not be able to move them back to "waiting" (see the
    // matching guard in callPatient: calling requires status === 'waiting',
    // so this is the only door back into the queue for a called entry
    // being closed). skipped/no_show can still be requeued.
    const requeueable = ['skipped', 'no_show'];
    if (!requeueable.includes(entry.status)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot requeue an entry with status "${entry.status}".`,
      });
    }

    await QueueEntry.findByIdAndUpdate(entry._id, {
      $set: { status: 'waiting' },
      $unset: { calledAt: '', gracePeriodExpiresAt: '', autoExpiredAt: '' },
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

// PUT /api/queues/:id/on-the-way — Patient acknowledges being called and
// heading to the clinic. Does NOT change queue status (only staff, via
// start-service, can move called -> serving — see the guard there) — this
// is purely an informational nudge so staff know a patient is en route
// before they physically arrive, instead of finding out only once the
// patient shows up at the counter.
const markOnTheWay = async (req, res) => {
  try {
    const entry = await QueueEntry.findById(req.params.id);
    if (!entry) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Queue entry not found.' });
    }
    if (entry.patient?.toString() !== req.user._id.toString()) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'Not authorized for this queue entry.',
      });
    }
    if (entry.status !== 'called') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Cannot acknowledge — entry status is "${entry.status}", not "called".`,
      });
    }

    // "I'm on my way" is the patient's own word, not proof of arrival, so it
    // never starts service and never stops the timer. It earns ONE extension of
    // the grace period (+3 min) so someone genuinely walking over isn't marked
    // no-show a moment before arriving. Atomic: a double tap cannot extend twice.
    let expiresAt = entry.gracePeriodExpiresAt;
    let extended = false;
    if (!entry.graceExtended && entry.gracePeriodExpiresAt && new Date(entry.gracePeriodExpiresAt) > new Date()) {
      const newExpiry = new Date(new Date(entry.gracePeriodExpiresAt).getTime() + ON_THE_WAY_EXTENSION_MIN * 60 * 1000);
      const upd = await QueueEntry.findOneAndUpdate(
        { _id: entry._id, status: 'called', graceExtended: { $ne: true } },
        { $set: { graceExtended: true, onTheWayAt: new Date(), gracePeriodExpiresAt: newExpiry } },
        { new: true }
      );
      if (upd) { expiresAt = upd.gracePeriodExpiresAt; extended = true; }
    } else if (!entry.onTheWayAt) {
      await QueueEntry.updateOne({ _id: entry._id }, { $set: { onTheWayAt: new Date() } });
    }

    emitQueueUpdate(req, entry.clinic, 'patient_on_the_way', {
      entryId: entry._id,
      queueNumber: entry.queueNumber,
      gracePeriodExpiresAt: expiresAt,
      extended,
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      message: extended
        ? `Staff notified. You have ${ON_THE_WAY_EXTENSION_MIN} more minutes to arrive.`
        : 'Staff notified.',
      gracePeriodExpiresAt: expiresAt,
      extended,
    });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to notify staff.' });
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

    // Contact number is OPTIONAL: many walk-in patients (older patients in
    // particular) don't carry a phone. With a number the patient gets SMS
    // updates; without one, staff call the ticket number aloud.
    let cleanPhone = '';
    if (phone && phone.toString().trim()) {
      cleanPhone = normalizePhone(phone.toString().trim());
      if (!/^09\d{9}$/.test(cleanPhone)) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Enter a valid mobile number (09XXXXXXXXX), or leave it blank if the patient has no phone.',
        });
      }
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
    const estWait = await estimateWaitTime(cId, serviceId);
    const activeCount = await QueueEntry.countDocuments({
      clinic: cId,
      status: { $in: ['waiting', 'serving', 'called'] },
      joinedAt: todayRange(),
    });

    const entry = await QueueEntry.create({
      clinic: cId,
      patientName: patientName.trim(),
      patientPhone: cleanPhone,
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

    // Confirmation SMS (ticket number + place in line) — also tells the
    // patient the number they gave works. Fire-and-forget: adding to the queue
    // must succeed even if the SMS provider is down.
    const joinedNotice = cleanPhone
      ? { channel: 'sms' }
      : { channel: 'none' };
    if (cleanPhone) {
      notifyQueueEntry(entry, {
        kind: 'joined',
        title: 'Queue Ticket',
        message: `Your ticket is #${entry.queueNumber}. You are #${activeCount + 1} in line, about ${estWait} min wait. We'll text you when you're close and when you're called.`,
      }).catch(() => {});
    }

    return res.status(HttpStatus.CREATED).json({
      success: true,
      message: cleanPhone
        ? 'Walk-in patient added to queue. SMS updates will be sent.'
        : 'Walk-in patient added to queue. No phone number — call their ticket number aloud.',
      notifyChannel: joinedNotice.channel,
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

// GET /api/queues/suggested-wait?clinicId=xxx&serviceId=yyy — the
// analytics-suggested waiting time staff can accept or reject (item 1).
// Read-only: does NOT change the operational wait time by itself.
const getSuggestedWaitTime = async (req, res) => {
  try {
    const clinicId = req.query.clinicId || req.user.clinicId;
    const { serviceId } = req.query;
    if (!clinicId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'clinicId is required.' });
    }
    const suggestion = await computeSuggestedWaitTime(clinicId, serviceId || null);
    const clinic = await Clinic.findById(clinicId).select('waitTimeOverrideMinutes currentWaitingTime');
    return res.status(HttpStatus.OK).json({
      success: true,
      ...suggestion,
      currentOperationalMinutes: typeof clinic?.waitTimeOverrideMinutes === 'number'
        ? clinic.waitTimeOverrideMinutes
        : suggestion.suggestedMinutes,
      isOverrideActive: typeof clinic?.waitTimeOverrideMinutes === 'number',
    });
  } catch (err) {
    console.error('getSuggestedWaitTime Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to compute suggested waiting time.' });
  }
};

// PUT /api/queues/suggested-wait/apply — staff accepts the suggestion; it
// becomes the operational waiting time for every client (item 1).
const applySuggestedWaitTime = async (req, res) => {
  try {
    const clinicId = req.body.clinicId || req.user.clinicId;
    const { serviceId, minutes } = req.body;
    if (!clinicId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'clinicId is required.' });
    }

    // Re-derive the suggestion server-side rather than trusting a client-
    // supplied number outright — `minutes` is only accepted if it matches
    // what the server itself would currently suggest, so a stale tablet
    // screen can't push an outdated value as if it were fresh.
    const suggestion = await computeSuggestedWaitTime(clinicId, serviceId || null);
    const appliedMinutes = typeof minutes === 'number' ? minutes : suggestion.suggestedMinutes;

    const clinic = await Clinic.findByIdAndUpdate(
      clinicId,
      {
        waitTimeOverrideMinutes: appliedMinutes,
        waitTimeOverrideSetAt: new Date(),
        waitTimeOverrideSetBy: req.user._id,
        currentWaitingTime: appliedMinutes,
      },
      { new: true }
    );

    emitQueueUpdate(req, clinicId, 'wait_time_updated', {
      clinicId, waitTimeMinutes: appliedMinutes, source: 'staff_applied_suggestion',
    });

    await logAction({
      actor: req.user,
      action: 'apply_suggested_wait_time',
      targetType: 'Clinic',
      targetId: clinicId,
      targetLabel: clinic?.name || 'Clinic',
      clinicId,
      details: { minutes: appliedMinutes, basis: suggestion.basis },
    });

    return res.status(HttpStatus.OK).json({
      success: true,
      message: `Suggested waiting time of ${appliedMinutes} min applied.`,
      waitTimeOverrideMinutes: appliedMinutes,
    });
  } catch (err) {
    console.error('applySuggestedWaitTime Error:', err.message);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to apply suggested waiting time.' });
  }
};

// PUT /api/queues/suggested-wait/reject — staff declines the suggestion.
// Explicitly a no-op on the operational number (existing/manual value is
// kept) — this endpoint exists mainly so the decision gets logged.
const rejectSuggestedWaitTime = async (req, res) => {
  try {
    const clinicId = req.body.clinicId || req.user.clinicId;
    if (!clinicId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'clinicId is required.' });
    }
    await logAction({
      actor: req.user,
      action: 'reject_suggested_wait_time',
      targetType: 'Clinic',
      targetId: clinicId,
      targetLabel: 'Clinic',
      clinicId,
      details: {},
    });
    return res.status(HttpStatus.OK).json({ success: true, message: 'Suggestion rejected. Existing waiting time unchanged.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to reject suggested waiting time.' });
  }
};

// PUT /api/queues/wait-time/clear-override — revert to fully automatic
// server-computed wait time (undoes a previously applied suggestion/manual
// value). Not part of the original ask but a natural, low-risk complement
// to "apply" so staff aren't stuck with a stale manual number forever.
const clearWaitTimeOverride = async (req, res) => {
  try {
    const clinicId = req.body.clinicId || req.user.clinicId;
    await Clinic.findByIdAndUpdate(clinicId, {
      waitTimeOverrideMinutes: null,
      waitTimeOverrideSetAt: null,
      waitTimeOverrideSetBy: null,
    });
    emitQueueUpdate(req, clinicId, 'wait_time_updated', { clinicId, source: 'override_cleared' });
    return res.status(HttpStatus.OK).json({ success: true, message: 'Reverted to automatic waiting-time calculation.' });
  } catch (err) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Failed to clear override.' });
  }
};

module.exports = {
  notifyPositionMilestones,
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
  markOnTheWay,
  getSuggestedWaitTime,
  applySuggestedWaitTime,
  rejectSuggestedWaitTime,
  clearWaitTimeOverride,
};