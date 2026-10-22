/**
 * Automatic 5-minute arrival grace period.
 *
 * Calling a patient sets gracePeriodExpiresAt = now + 5 min. Before this, only
 * a staff member pressing "No-show" ended the wait, so a patient who never
 * arrived could block their other service lines (see utils/visitHold.js) for
 * as long as staff forgot. Now this sweeper runs every 30 seconds and marks any
 * `called` entry whose grace period has passed as `no_show`, then:
 *   - decrements the clinic's live queue counter,
 *   - syncs a linked appointment,
 *   - tells staff/patient apps in real time (patient_noshow),
 *   - frees the patient's other service lines (the hold is derived from sibling
 *     status, so it lifts the instant this entry stops being `called`),
 *   - tells an app-user patient what happened (walk-ins are not texted: SMS
 *     costs credits and staff can see the no-show on the tablet).
 * Staff can still requeue a no-show (PUT /api/queues/:id/requeue).
 *
 * The status change is a single atomic findOneAndUpdate on {status:'called',
 * grace expired}, so two server instances (or a staff tap at the same moment)
 * can never double-process an entry.
 */
const QueueEntry = require('../models/QueueEntry');
const Clinic = require('../models/Clinic');
const Appointment = require('../models/Appointment');
const { notifyQueueEntry } = require('../utils/notify');

const SWEEP_MS = 30 * 1000;

const sweepOnce = async ({ io, onChange } = {}) => {
  const now = new Date();
  const due = await QueueEntry.find({ status: 'called', gracePeriodExpiresAt: { $lte: now } })
    .select('_id')
    .lean();

  let expired = 0;
  for (const { _id } of due) {
    const entry = await QueueEntry.findOneAndUpdate(
      { _id, status: 'called', gracePeriodExpiresAt: { $lte: now } },
      { $set: { status: 'no_show', autoExpiredAt: now } },
      { new: true }
    );
    if (!entry) continue; // staff handled it in the meantime
    expired += 1;

    try {
      await Clinic.findByIdAndUpdate(entry.clinic, { $inc: { queueLength: -1 } });
      await Appointment.findOneAndUpdate({ queueEntry: entry._id }, { status: 'no_show' }).catch(() => {});

      if (io) {
        io.to(`clinic_${entry.clinic}`).emit('patient_noshow', { entryId: entry._id, auto: true });
        io.to(`clinicpub_${entry.clinic}`).emit('patient_noshow', { clinicId: String(entry.clinic), eventName: 'patient_noshow' });
        io.emit('global_queue_change', { clinicId: entry.clinic, eventName: 'patient_noshow' });
      }

      if (entry.patient) {
        await notifyQueueEntry(entry, {
          kind: 'no_show',
          title: 'Missed your turn',
          message: `Ticket #${entry.queueNumber} (${entry.serviceName}) was skipped because you did not arrive within 5 minutes. Please ask the staff to put you back in line.`,
        });
      }

      if (onChange) await onChange(entry.clinic);
    } catch (err) {
      console.error('graceSweeper follow-up error:', err.message);
    }
  }
  return expired;
};

let timer = null;
const startGraceSweeper = ({ io, onChange } = {}) => {
  if (timer) return timer;
  timer = setInterval(() => {
    sweepOnce({ io, onChange }).catch((err) => console.error('graceSweeper error:', err.message));
  }, SWEEP_MS);
  if (timer.unref) timer.unref();
  return timer;
};

module.exports = { sweepOnce, startGraceSweeper, SWEEP_MS };
