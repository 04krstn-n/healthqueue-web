/**
 * Multi-service visits.
 *
 * A patient who selects several services gets ONE queue entry PER service
 * (each with its own ticket number and its own line), all sharing a `visitId`.
 *
 * Rules (so no service counter sits idle while patients wait for it):
 *  - Lines are per service: positions, ordering and "people ahead" are
 *    computed inside one service's line, not across the whole clinic.
 *  - First call wins: once ANY entry of a visit is `called` or `serving`, the
 *    patient's other entries are ON HOLD. A held entry keeps its place, but
 *    staff cannot call it (the server rejects it), so staff simply call the
 *    next patient and the service never waits on someone who is busy at
 *    another counter.
 *  - The hold lifts by itself the moment the busy entry is completed, skipped,
 *    marked no-show or cancelled — so if the patient doesn't arrive within the
 *    5-minute grace period at the first service, their other lines are freed.
 *    A freed entry keeps its original join time, so it is next in its line.
 *
 * The hold is DERIVED from sibling statuses, never stored, so it can't go
 * stale or get stuck.
 */
const QueueEntry = require('../models/QueueEntry');

const BUSY = ['called', 'serving'];

const lineKeyOf = (e) => {
  const clinic = e.clinic?._id?.toString() || e.clinic?.toString();
  const svc = e.serviceId ? String(e.serviceId) : `n:${String(e.serviceName || '').toLowerCase()}`;
  return `${clinic}|${svc}`;
};

/** Group entries by (clinic, service) line. */
const groupByLine = (entries) => {
  const map = new Map();
  for (const e of entries) {
    const k = lineKeyOf(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
};

/**
 * Returns a Map visitId -> [busy sibling entries] for the given entries.
 * One query, however many entries are passed.
 */
const busyByVisit = async (entries) => {
  const ids = [...new Set(entries.filter((e) => e.visitId).map((e) => String(e.visitId)))];
  const out = new Map();
  if (ids.length === 0) return out;
  const busy = await QueueEntry.find({ visitId: { $in: ids }, status: { $in: BUSY } })
    .select('visitId queueNumber serviceName status calledAt')
    .lean();
  for (const b of busy) {
    const k = String(b.visitId);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(b);
  }
  return out;
};

/** Is this entry held because a sibling is busy? Returns the busy sibling or null. */
const heldBy = (entry, busyMap) => {
  if (!entry.visitId) return null;
  const list = busyMap.get(String(entry.visitId)) || [];
  return list.find((b) => String(b._id) !== String(entry._id)) || null;
};

const holdText = (b) => `Currently at ${b.serviceName} (#${b.queueNumber})`;

module.exports = { BUSY, lineKeyOf, groupByLine, busyByVisit, heldBy, holdText };
