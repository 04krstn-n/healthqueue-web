// Login protection, password recovery and patient-data scoping
// (Isip – System #1 and #9).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { stub, load, fakeRes, query } = require('./helpers/stub');

// ── in-memory users ──────────────────────────────────────────────────────────
let account; const sms = []; const audit = [];
const applySet = (u) => { Object.assign(account, u.$set); };
stub('models/User.js', {
  findOne: () => query(() => account && {
    ...account,
    comparePassword: (p) => bcrypt.compare(p, account.password),
  }),
  updateOne: async (_f, u) => applySet(u),
  findById: () => query(() => account),
});
stub('models/Patient.js', { findOne: () => query(null) });
stub('models/PendingRegistration.js', {});
stub('models/PasswordReset.js', { findOneAndUpdate: async () => ({ _id: 'r1' }) });
stub('models/RevokedToken.js', {});
stub('utils/auditLog.js', { logAction: async (e) => { audit.push(e.action); } });
stub('services/smsService.js', { sendOTP: async () => ({ success: true }), sendSMS: async (to, m) => { sms.push({ to, m }); return { success: true }; } });
stub('services/emailService.js', { validateEmailAddress: async (e) => ({ ok: true, email: e }), sendOTPEmail: async () => ({ success: true }), sendPasswordChangedEmail: async () => {} });

const auth = load('controllers/authController.js');
const login = async (password) => { const res = fakeRes(); await auth.login({ body: { identifier: '09171234567', password } }, res); return res; };

beforeEach(async () => {
  account = { _id: 'u1', role: 'staff', fullName: 'Staff One', phone: '09171234567', isActive: true, isVerified: true,
    password: await bcrypt.hash('Correct!pass1', 4), failedLoginAttempts: 0, lockUntil: null };
  sms.length = 0; audit.length = 0;
});

test('5 wrong passwords lock the account for 15 minutes; correct password is refused while locked', async () => {
  for (let i = 1; i <= 4; i += 1) {
    const r = await login('Wrong!pass1');
    assert.equal(r.statusCode, 401);
    assert.equal(account.failedLoginAttempts, i);
  }
  const fifth = await login('Wrong!pass1');
  assert.match(fifth.body.message, /locked for 15 minutes/);
  assert.ok(account.lockUntil > new Date(Date.now() + 14 * 60000));
  assert.ok(audit.includes('account_locked'), 'lockout written to the audit log');

  const whileLocked = await login('Correct!pass1');
  assert.equal(whileLocked.statusCode, 429);
});

test('lock expires by itself, and a successful login resets the counter', async () => {
  account.failedLoginAttempts = 3;
  account.lockUntil = new Date(Date.now() - 1000); // expired
  const r = await login('Correct!pass1');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.token);
  assert.equal(account.failedLoginAttempts, 0);
  assert.equal(account.lockUntil, null);
});

test('deactivated and unverified accounts cannot log in', async () => {
  account.isActive = false;
  assert.equal((await login('Correct!pass1')).statusCode, 403);
  account.isActive = true; account.isVerified = false;
  assert.equal((await login('Correct!pass1')).statusCode, 403);
});

test('forgot-password gives the same answer for registered and unknown numbers (no account discovery)', async () => {
  const known = fakeRes(); await auth.forgotPassword({ body: { phone: '09171234567' } }, known);
  account = null;
  const unknown = fakeRes(); await auth.forgotPassword({ body: { phone: '09999999999' } }, unknown);
  assert.equal(known.statusCode, 200); assert.equal(unknown.statusCode, 200);
  assert.equal(known.body.message, unknown.body.message);
  assert.ok(unknown.body.resetId, 'decoy reset id returned');
});

test('forgot-password rejects an invalid phone format', async () => {
  const res = fakeRes(); await auth.forgotPassword({ body: { phone: '12345' } }, res);
  assert.equal(res.statusCode, 400);
});

test('password policy is enforced on the server', () => {
  assert.deepEqual(auth.validatePasswordStrength('Str0ng!pass'), []);
  assert.ok(auth.validatePasswordStrength('weak').length >= 3);
  assert.ok(auth.validatePasswordStrength('NoDigits!!').includes('one number'));
});
