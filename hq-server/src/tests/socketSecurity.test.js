// Real-time data protection (Isip – System #6 and #9): who may join which
// Socket.IO room. Patients only ever get anonymous refresh pings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { stub, load, query } = require('./helpers/stub');

const users = {
  p1: { _id: 'p1', role: 'patient', isActive: true },
  s1: { _id: 's1', role: 'staff', clinicId: 'c1', isActive: true },
  sa: { _id: 'sa', role: 'super_admin', isActive: true },
  off: { _id: 'off', role: 'staff', clinicId: 'c1', isActive: false },
};
stub('models/User.js', { findById: (id) => query(() => users[id] || null) });
stub('middleware/auth.js', { isRevoked: async (d) => d.jti === 'revoked' });
const { registerSocketSecurity } = load('socket/socketSecurity.js');

let middleware; let onConnection;
registerSocketSecurity({ use: (fn) => { middleware = fn; }, on: (_e, fn) => { onConnection = fn; } });

const connect = async (tok) => {
  const handlers = {}; const rooms = [];
  const socket = { handshake: { auth: tok ? { token: tok } : {} }, on: (e, fn) => { handlers[e] = fn; }, join: (r) => rooms.push(r) };
  await new Promise((ok) => middleware(socket, ok));
  onConnection(socket);
  return { join: (ev, arg) => handlers[ev](arg), rooms };
};
const tok = (id, jti = 'ok') => jwt.sign({ id }, process.env.JWT_SECRET, { jwtid: jti });

test('anonymous socket cannot join any room', async () => {
  const s = await connect(null);
  s.join('join_clinic', 'c1'); s.join('join_user', 'p1');
  assert.deepEqual(s.rooms, []);
});

test('patient gets only the sanitized public clinic room and their own user room', async () => {
  const s = await connect(tok('p1'));
  s.join('join_clinic', 'c1'); s.join('join_user', 'p1'); s.join('join_user', 's1');
  assert.deepEqual(s.rooms, ['clinicpub_c1', 'user_p1']);
});

test('staff join only their own clinic room; super admin any', async () => {
  const st = await connect(tok('s1'));
  st.join('join_clinic', 'c1'); st.join('join_clinic', 'c2');
  assert.deepEqual(st.rooms, ['clinic_c1']);
  const sa = await connect(tok('sa'));
  sa.join('join_clinic', 'c2');
  assert.deepEqual(sa.rooms, ['clinic_c2']);
});

test('revoked, forged or deactivated-account tokens are treated as anonymous', async () => {
  for (const t of [tok('s1', 'revoked'), jwt.sign({ id: 's1' }, 'wrong-secret'), tok('off')]) {
    const s = await connect(t);
    s.join('join_clinic', 'c1');
    assert.deepEqual(s.rooms, []);
  }
});
