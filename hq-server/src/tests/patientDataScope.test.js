// Patient data protection (Isip – System #9 / RA 10173): ID photos submitted
// for Senior/PWD/Pregnant priority are visible only to the patient, staff of a
// clinic the patient actually visited, and super admins — and are stored
// encrypted (AES-256-GCM) in the database instead of the server's disk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { stub, load, fakeRes, query } = require('./helpers/stub');

process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const photos = new Map(); const requests = new Map();
stub('models/IdPhoto.js', {
  create: async (d) => { const _id = `p${photos.size + 1}`; photos.set(_id, { _id, ...d }); return { _id }; },
  findById: (id) => query(() => photos.get(String(id))),
});
stub('models/PatientTypeRequest.js', {
  findOne: () => query(null),
  create: async (d) => { const _id = 'r1'; requests.set(_id, { _id, ...d }); return requests.get(_id); },
  findById: async (id) => requests.get(String(id)) || null,
  find: () => query([]),
});
stub('models/Patient.js', {});
stub('models/QueueEntry.js', {});
stub('utils/auditLog.js', { logAction: async () => {} });
// Patient P1 has visited clinic A only.
stub('controllers/patientController.js', {
  patientBelongsToClinic: async (patient, clinic) => String(patient) === 'aaaaaaaaaaaaaaaaaaaaaaa1' && String(clinic) === 'clinicA',
  getClinicPatientIds: async (clinic) => (clinic === 'clinicA' ? ['aaaaaaaaaaaaaaaaaaaaaaa1'] : []),
});

const ctrl = load('controllers/patientTypeRequestController.js');
const P1 = { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', role: 'patient' };

test('upload: real image bytes are required (renamed non-image is rejected)', async () => {
  const res = fakeRes();
  await ctrl.createRequest({ user: P1, body: { requestedType: 'PWD' }, file: { buffer: Buffer.from('%PDF-1.7 not an image....'), size: 24 } }, res);
  assert.equal(res.statusCode, 400);
});

test('upload: photo is stored ENCRYPTED in the database', async () => {
  const res = fakeRes();
  await ctrl.createRequest({ user: P1, body: { requestedType: 'Senior Citizen' }, file: { buffer: JPEG, size: JPEG.length } }, res);
  assert.equal(res.statusCode, 200);
  const stored = photos.get('p1');
  assert.equal(stored.encrypted, true);
  assert.notDeepEqual(Buffer.from(stored.data), JPEG, 'ciphertext differs from the original');
  assert.equal(stored.mimeType, 'image/jpeg');
});

test('photo access: owner, same-clinic staff and super admin allowed; other clinics refused', async () => {
  // Same request as uploaded above, under a valid 24-hex id (the controller checks the id format first).
  requests.set('bbbbbbbbbbbbbbbbbbbbbbb1', { ...requests.get('r1'), _id: 'bbbbbbbbbbbbbbbbbbbbbbb1' });
  const get = async (user) => { const res = fakeRes(); await ctrl.getRequestPhoto({ user, params: { id: 'bbbbbbbbbbbbbbbbbbbbbbb1' } }, res); return res; };

  const own = await get(P1);
  assert.equal(own.statusCode, 200);
  assert.deepEqual(Buffer.from(own.body), JPEG, 'decrypted bytes match the upload');
  assert.equal(own.headers['Cache-Control'], 'no-store');

  assert.equal((await get({ _id: 's1', role: 'staff', clinicId: 'clinicA' })).statusCode, 200);
  assert.equal((await get({ _id: 's2', role: 'staff', clinicId: 'clinicB' })).statusCode, 403);
  assert.equal((await get({ _id: 'f2', role: 'facility_admin', clinicId: 'clinicB' })).statusCode, 403);
  assert.equal((await get({ _id: 'x', role: 'patient' })).statusCode, 403);
  assert.equal((await get({ _id: 'sa', role: 'super_admin' })).statusCode, 200);
});

test('approve/reject: staff of a clinic the patient never visited is refused', async () => {
  const res = fakeRes();
  await ctrl.approveRequest({ user: { _id: 's2', role: 'staff', clinicId: 'clinicB' }, params: { id: 'bbbbbbbbbbbbbbbbbbbbbbb1' }, body: {}, app: { get: () => null } }, res);
  assert.equal(res.statusCode, 403);
});

test('tampered ciphertext cannot be decrypted (integrity check)', () => {
  const { encryptBuffer, decryptBuffer } = load('utils/fieldCrypto.js');
  const enc = encryptBuffer(JPEG);
  enc.data[5] ^= 0xff;
  assert.throws(() => decryptBuffer(enc));
});
