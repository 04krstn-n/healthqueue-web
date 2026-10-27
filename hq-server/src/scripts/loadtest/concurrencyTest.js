#!/usr/bin/env node
/**
 * HealthQueue+ concurrency & load test (panel: "assess system performance
 * under concurrent users" and "multiple patients joining the queue
 * simultaneously / duplicate bookings").
 *
 * NO extra packages — needs Node 18+ (built-in fetch).
 *
 * RUN IT AGAINST A TEST/STAGING SERVER, NEVER THE LIVE CLINIC DATABASE.
 * The server under test must run with:
 *     NODE_ENV=development          (anything except "production")
 *     DISABLE_RATE_LIMIT=true       (otherwise one machine is blocked after 10 logins)
 *     SEMAPHORE_API_KEY unset       (so registration returns the OTP in the response)
 *
 * Example:
 *   node scripts/loadtest/concurrencyTest.js --base http://localhost:4000 \
 *        --clinic <clinicId> --service "General Consultation" --users 50 --duration 30
 *
 * Options:
 *   --base       API server URL (default http://localhost:4000)
 *   --clinic     clinic _id to test (must be open now, with the service below)
 *   --service    service name offered by that clinic
 *   --users      number of simulated patients (default 50)
 *   --duration   seconds of the polling phase (default 30)
 *   --slot       appointment slot to stress, e.g. "03:00 PM" (default 03:00 PM)
 *   --date       appointment date YYYY-MM-DD (default: tomorrow)
 *   --skip-appointments   skip phase 4
 *
 * Phases:
 *   1. Register + log in N test patients (also measures auth latency)
 *   2. All N patients join the SAME queue at the SAME moment
 *        -> every join succeeds, every queue number is unique
 *   3. Every patient sends TWO joins at once (double tap / two devices)
 *        -> 0 extra tickets are created
 *   4. All N patients book the SAME appointment slot at once
 *        -> bookings never exceed the slot capacity; nobody double-books
 *   5. N patients poll their queue status for --duration seconds
 *        -> response time p50/p95/p99, error rate, requests per second
 *   6. Clean-up: every test patient cancels their ticket/appointment
 *
 * Results are printed and saved to loadtest-results-<timestamp>.json/.md
 * (paste the .md table into Chapter 4).
 */
const fs = require('fs');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const BASE = String(args.base || 'http://localhost:4000').replace(/\/$/, '');
const N = parseInt(args.users || '50', 10);
const DURATION = parseInt(args.duration || '30', 10);
const CLINIC = args.clinic;
const SERVICE = args.service;
const SLOT = args.slot || '03:00 PM';
const DATE = args.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);

if (!CLINIC || !SERVICE) {
  console.error('Usage: node scripts/loadtest/concurrencyTest.js --clinic <clinicId> --service "<service name>" [--users 50] [--base URL]');
  process.exit(1);
}

const api = async (method, path, { token, body } = {}) => {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    return { status: res.status, data, ms: performance.now() - t0 };
  } catch (err) {
    return { status: 0, data: { message: err.message }, ms: performance.now() - t0 };
  }
};

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};
const stats = (rs) => {
  const ms = rs.map((r) => r.ms);
  const ok = rs.filter((r) => r.status >= 200 && r.status < 300).length;
  // Server errors = crashes/timeouts (5xx or no response). 4xx answers are
  // the server correctly REFUSING a request (duplicate, slot full) — counted
  // separately because in phases 3 and 4 they are the expected outcome.
  const errors = rs.filter((r) => r.status === 0 || r.status >= 500).length;
  return {
    requests: rs.length, ok, rejected4xx: rs.length - ok - errors, errors,
    errorRatePct: rs.length ? Math.round((errors / rs.length) * 1000) / 10 : 0,
    p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: ms.length ? Math.round(Math.max(...ms)) : null,
  };
};

const results = { base: BASE, clinic: CLINIC, users: N, startedAt: new Date().toISOString(), phases: {} };
const line = (s = '') => console.log(s);

(async () => {
  line(`HealthQueue+ concurrency test — ${N} simulated patients against ${BASE}`);

  // ── Phase 1: create patients ──────────────────────────────────────────────
  const runId = Date.now().toString().slice(-6);
  const patients = [];
  const authCalls = [];
  for (let i = 0; i < N; i += 1) {
    const phone = `09${runId}${String(i).padStart(3, '0')}`; // 09 + 6 + 3 = 11 digits (up to 999 users)
    const password = 'LoadTest!2026';
    const reg = await api('POST', '/auth/register', { body: { fullName: `Load Test ${runId}-${i}`, phone, password } });
    authCalls.push(reg);
    if (!reg.data?.devOtp) {
      console.error(`\nRegistration #${i} did not return devOtp (status ${reg.status}: ${reg.data?.message}).`);
      console.error('Run the server with NODE_ENV=development, DISABLE_RATE_LIMIT=true and no SEMAPHORE_API_KEY.');
      process.exit(1);
    }
    const ver = await api('POST', '/auth/verify-otp', { body: { userId: reg.data.userId, otp: reg.data.devOtp } });
    authCalls.push(ver);
    if (!ver.data?.token) { console.error('OTP verification failed:', ver.data?.message); process.exit(1); }
    patients.push({ phone, token: ver.data.token, id: ver.data.user?._id });
  }
  results.phases.registration = stats(authCalls);
  line(`1. Registered ${patients.length} test patients`);

  // ── Phase 2: simultaneous joins ───────────────────────────────────────────
  const joins = await Promise.all(patients.map((p) => api('POST', '/queues/join', {
    token: p.token, body: { clinicId: CLINIC, serviceName: SERVICE, joinedRemotely: true },
  })));
  joins.forEach((r, i) => { patients[i].entryId = r.data?.entry?._id; });
  const numbers = joins.filter((r) => r.status === 201).map((r) => r.data.entry.queueNumber);
  const unique = new Set(numbers).size;
  results.phases.simultaneousJoin = {
    ...stats(joins), ticketsCreated: numbers.length, uniqueQueueNumbers: unique,
    pass: numbers.length === N && unique === N,
    sampleErrors: joins.filter((r) => r.status !== 201).slice(0, 3).map((r) => `${r.status} ${r.data?.message}`),
  };
  line(`2. ${N} patients joined at once: ${numbers.length} tickets, ${unique} unique numbers -> ${results.phases.simultaneousJoin.pass ? 'PASS' : 'FAIL'}`);

  // ── Phase 3: duplicate joins (double tap) ─────────────────────────────────
  const dup = await Promise.all(patients.flatMap((p) => [0, 1].map(() => api('POST', '/queues/join', {
    token: p.token, body: { clinicId: CLINIC, serviceName: SERVICE, joinedRemotely: true },
  }))));
  const extra = dup.filter((r) => r.status === 201).length;
  results.phases.duplicateJoin = { ...stats(dup), extraTicketsCreated: extra, pass: extra === 0 };
  line(`3. ${dup.length} duplicate join requests: ${extra} extra tickets -> ${extra === 0 ? 'PASS' : 'FAIL'}`);

  // ── Phase 4: simultaneous booking of one slot ─────────────────────────────
  if (!args['skip-appointments']) {
    const book = (p) => api('POST', '/appointments', {
      token: p.token, body: { clinicId: CLINIC, appointmentDate: DATE, timeSlot: SLOT, serviceName: SERVICE },
    });
    const first = await Promise.all(patients.map(book));
    first.forEach((r, i) => { patients[i].apptId = r.data?.data?._id || r.data?.appointment?._id; });
    const booked = first.filter((r) => r.status === 201 || r.status === 200).length;
    const full = first.filter((r) => r.status === 409).length;
    const again = await Promise.all(patients.filter((p) => p.apptId).map(book)); // same patients try again
    const doubleBooked = again.filter((r) => r.status === 201 || r.status === 200).length;
    results.phases.slotBooking = {
      ...stats(first), booked, rejectedAsFull: full, doubleBookings: doubleBooked,
      note: 'booked must not exceed the slot capacity (default 3); doubleBookings must be 0',
      pass: booked > 0 && booked <= 3 && doubleBooked === 0,
    };
    line(`4. ${N} patients booked ${DATE} ${SLOT} at once: ${booked} booked, ${full} told "slot full", ${doubleBooked} double bookings`);
  }

  // ── Phase 5: sustained polling ────────────────────────────────────────────
  const polls = [];
  const until = Date.now() + DURATION * 1000;
  await Promise.all(patients.map(async (p) => {
    while (Date.now() < until) {
      polls.push(await api('GET', '/queues/my-status', { token: p.token }));
      await new Promise((r) => setTimeout(r, 1000)); // each simulated phone polls ~1/s
    }
  }));
  results.phases.polling = { ...stats(polls), durationSec: DURATION, requestsPerSec: Math.round((polls.length / DURATION) * 10) / 10 };
  line(`5. Polling: ${polls.length} requests in ${DURATION}s, p95 ${results.phases.polling.p95} ms, server errors ${results.phases.polling.errorRatePct}%`);

  // ── Phase 6: clean-up ─────────────────────────────────────────────────────
  await Promise.all(patients.map(async (p) => {
    if (p.entryId) await api('PUT', `/queues/${p.entryId}/cancel`, { token: p.token, body: {} });
    if (p.apptId) await api('PUT', `/appointments/${p.apptId}/cancel`, { token: p.token, body: { reason: 'load test clean-up' } });
  }));
  line('6. Clean-up done (test tickets and appointments cancelled). Test patient accounts remain — deactivate them in the admin panel.');

  // ── Report ────────────────────────────────────────────────────────────────
  results.finishedAt = new Date().toISOString();
  const rows = Object.entries(results.phases).map(([name, s]) =>
    `| ${name} | ${s.requests} | ${s.ok} | ${s.rejected4xx} | ${s.errorRatePct}% | ${s.p50} | ${s.p95} | ${s.p99} | ${s.pass === undefined ? '—' : (s.pass ? 'PASS' : 'FAIL')} |`);
  const md = [
    `Concurrency test — ${N} simultaneous patients, ${results.startedAt}`,
    '',
    '| Phase | Requests | Accepted (2xx) | Refused (4xx) | Server error rate | p50 (ms) | p95 (ms) | p99 (ms) | Result |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
  line(`\n${md}`);
  const stamp = results.startedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(`loadtest-results-${stamp}.json`, JSON.stringify(results, null, 2));
  fs.writeFileSync(`loadtest-results-${stamp}.md`, md);
  line(`\nSaved loadtest-results-${stamp}.json and .md`);
  const failed = Object.values(results.phases).some((s) => s.pass === false);
  process.exit(failed ? 1 : 0);
})();
