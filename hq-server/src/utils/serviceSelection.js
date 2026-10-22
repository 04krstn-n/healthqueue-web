/**
 * Resolves which service(s) a patient picked and checks they really belong to
 * the clinic. Accepts:
 *   - serviceNames: ["A", "B"]   (multi-select, preferred)
 *   - serviceName:  "A"          (single, legacy clients)
 *   - serviceIds:   [...] / serviceId
 * There is NO silent fallback any more: previously a missing service quietly
 * became the clinic's first service (or "General Consultation"), so invalid or
 * incomplete requests were accepted and produced misleading records.
 *
 * Returns { ok:true, services:[{serviceId,name}], serviceName:"A, B", serviceId }
 *      or { ok:false, message }.
 */

const nameOf = (s) => (s && (s.name || s.serviceName)) || '';
const idOf = (s) => (s && (s._id || s.id)) || null;

const resolveServices = (clinic, body = {}) => {
  const catalog = Array.isArray(clinic.services) ? clinic.services : [];

  const names = [];
  const ids = [];
  const push = (arr, v) => { if (v !== undefined && v !== null && String(v).trim()) arr.push(String(v).trim()); };

  if (Array.isArray(body.serviceNames)) body.serviceNames.forEach((n) => push(names, n));
  else push(names, body.serviceName);
  if (Array.isArray(body.serviceIds)) body.serviceIds.forEach((i) => push(ids, i));
  else push(ids, body.serviceId);

  const picked = [];
  const seen = new Set();
  const add = (svc) => {
    const key = String(idOf(svc) || nameOf(svc)).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({ serviceId: idOf(svc), name: nameOf(svc) });
  };

  for (const id of ids) {
    const svc = catalog.find((s) => String(idOf(s)) === id);
    if (!svc) return { ok: false, message: 'One of the selected services does not exist at this clinic.' };
    add(svc);
  }
  for (const name of names) {
    const svc = catalog.find((s) => nameOf(s).trim().toLowerCase() === name.toLowerCase());
    if (!svc) return { ok: false, message: `"${name}" is not a service offered at this clinic.` };
    add(svc);
  }

  if (picked.length === 0) return { ok: false, message: 'Please select at least one service.' };
  // No arbitrary cap: each service is its own line, limited only by what the clinic offers.

  return {
    ok: true,
    services: picked,
    serviceName: picked.map((p) => p.name).join(', '),
    serviceId: picked[0].serviceId || null,
  };
};

module.exports = { resolveServices };
