// Data validation (Isip – System #2): shared validators + NoSQL-operator sanitizer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/stub');
const { load } = require('./helpers/stub');

const v = load('utils/validators.js');
const { _clean } = load('middleware/sanitize.js');

test('normalizes every accepted PH mobile format to 09XXXXXXXXX', () => {
  for (const input of ['09171234567', '+639171234567', '639171234567', '9171234567', '0917-123-4567', '0917 123 4567']) {
    assert.equal(v.normalizePhone(input), '09171234567', input);
  }
});

test('rejects invalid mobile numbers (invalid input cases)', () => {
  for (const bad of ['12345', '0817123456', '091712345678', 'abcdefghijk', '', '02-8123-4567']) {
    assert.equal(v.isValidPHMobile(v.normalizePhone(bad)), false, bad);
  }
  assert.equal(v.checkOptionalPhone({ $gt: '' }).ok, false, 'object payload rejected');
  assert.deepEqual(v.checkOptionalPhone(undefined), { ok: true, provided: false });
  assert.equal(v.checkOptionalPhone('').value, '');
  assert.equal(v.checkOptionalPhone('+639171234567').value, '09171234567');
});

test('isObjectId accepts only 24-hex ids', () => {
  assert.equal(v.isObjectId('64b7f0c2a1b2c3d4e5f60718'), true);
  for (const bad of ['123', 'zzzzzzzzzzzzzzzzzzzzzzzz', { $ne: null }, null, undefined, 'aaaaaaaaaaaa']) {
    assert.equal(v.isObjectId(bad), false, String(bad));
  }
});

test('escapeRegex makes user text match literally', () => {
  const re = new RegExp(v.escapeRegex('X-Ray (Chest)+.*'), 'i');
  assert.ok(re.test('x-ray (chest)+.*'));
  assert.ok(!re.test('X-Ray Chest'));
});

test('sanitizer strips MongoDB operator keys at any depth', () => {
  const body = { phone: { $gt: '' }, nested: { ok: 1, deeper: [{ $where: 'x', keep: 2 }] }, 'a.b': 1, name: 'Ana' };
  _clean(body);
  assert.deepEqual(body, { phone: {}, nested: { ok: 1, deeper: [{ keep: 2 }] }, name: 'Ana' });
});
