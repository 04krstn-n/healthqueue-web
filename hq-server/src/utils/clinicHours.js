/**
 * Clinic operating-hours checks, always evaluated in Philippine time
 * (the server may run in UTC). Clinic.operatingHours is free text such as
 * "8:00 AM - 5:00 PM" or "08:00-17:00". If a clinic's text can't be parsed we
 * do NOT block anybody (fail open) — a malformed hours string must not stop
 * patients from queuing.
 */
const TZ = 'Asia/Manila';

const to24 = (h, m, ap) => {
  let hh = parseInt(h, 10);
  const mm = parseInt(m || '0', 10);
  if (ap) {
    const isPm = /p/i.test(ap);
    if (hh === 12) hh = isPm ? 12 : 0;
    else if (isPm) hh += 12;
  }
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
};

/** "9:30 AM" / "09:30" -> minutes after midnight, or null. */
const parseClock = (text) => {
  const m = String(text || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  return m ? to24(m[1], m[2], m[3]) : null;
};

/** "8:00 AM - 5:00 PM" -> { open, close } in minutes, or null. */
const parseHours = (text) => {
  const parts = String(text || '').split(/\s*(?:-|–|—|to)\s*/i);
  if (parts.length !== 2) return null;
  const open = parseClock(parts[0]);
  const close = parseClock(parts[1]);
  if (open === null || close === null || close <= open) return null;
  return { open, close };
};

const manilaMinutes = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const h = parseInt(parts.find((p) => p.type === 'hour').value, 10) % 24;
  const m = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  return h * 60 + m;
};

/** true/false, or null when the clinic's hours text can't be understood. */
const isOpenAt = (operatingHours, date = new Date()) => {
  const hrs = parseHours(operatingHours);
  if (!hrs) return null;
  const now = manilaMinutes(date);
  return now >= hrs.open && now < hrs.close;
};

/** Is a slot label like "09:00 AM" inside the clinic's hours? null = unknown. */
const slotWithinHours = (operatingHours, slot) => {
  const hrs = parseHours(operatingHours);
  const at = parseClock(slot);
  if (!hrs || at === null) return null;
  return at >= hrs.open && at < hrs.close;
};

/** Combine a calendar date (any tz) and a slot label into a real instant in PH time. */
const slotInstant = (dateInput, slot) => {
  const at = parseClock(slot);
  if (at === null) return null;
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const hh = String(Math.floor(at / 60)).padStart(2, '0');
  const mm = String(at % 60).padStart(2, '0');
  return new Date(`${ymd}T${hh}:${mm}:00+08:00`);
};

module.exports = { parseClock, parseHours, isOpenAt, slotWithinHours, slotInstant };
