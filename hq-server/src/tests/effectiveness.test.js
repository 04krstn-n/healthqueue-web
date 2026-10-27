// Effectiveness module (Saac-Nape #1 / #2): before-vs-after waiting time and
// predicted-vs-actual with a historical-average baseline.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stub, load, fakeRes, query } = require('./helpers/stub');

const tickets = [];
stub('models/BaselineObservation.js', { find: () => query(() => [10, 20, 30, 40, 50].map((w) => ({ waitMinutes: w }))) });
stub('models/QueueEntry.js', { find: () => query(() => tickets) });
const eff = load('controllers/effectivenessController.js');

test('regression: actual wait is read from waitTimeInMinutes (the field the model really stores)', async () => {
  tickets.length = 0;
  for (let i = 0; i < 8; i += 1) {
    tickets.push({ queueNumber: `A${i}`, joinedAt: new Date(2026, 9, 1, 8, i), estimatedWaitMinutes: 20, waitTimeInMinutes: 18 + (i % 3), serviceTimeInMinutes: 7 });
  }
  const res = fakeRes();
  await eff.getEffectiveness({ user: { role: 'facility_admin', clinicId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, query: {} }, res);
  const d = res.body.data;
  assert.equal(d.after.waitMinutes.n, 8, 'before the fix this was always 0');
  assert.equal(d.forecastAccuracy.n, 8);
  assert.equal(d.before.waitMinutes.mean, 30);
  assert.ok(d.change.meanWaitDifferenceMinutes < 0, 'shorter after');
  assert.ok(d.forecastAccuracy.baseline.n > 0, 'baseline comparison present');
  assert.ok(typeof d.forecastAccuracy.comparison.verdict === 'string');
});

test('MAE, bias and within-N% are computed correctly', () => {
  const r = eff._forecastAccuracy([
    { estimatedWaitMinutes: 10, waitTimeInMinutes: 12 },
    { estimatedWaitMinutes: 20, waitTimeInMinutes: 10 },
    { estimatedWaitMinutes: 30, waitTimeInMinutes: 33 },
  ]);
  assert.equal(r.n, 3);
  assert.equal(r.mae, 5);          // (2 + 10 + 3) / 3
  assert.equal(r.bias, 1.7);       // (-2 + 10 - 3) / 3
  assert.equal(r.within5Pct, 66.7);
});

test('historical-average baseline never uses the ticket it predicts', () => {
  const t = (m, w) => ({ joinedAt: new Date(2026, 0, 1, 8, m), waitTimeInMinutes: w });
  // first 5 tickets only build history; ticket 6 predicted with mean(10..50)=30
  const r = eff._baselineAccuracy([t(0, 10), t(1, 20), t(2, 30), t(3, 40), t(4, 50), t(5, 36)]);
  assert.equal(r.n, 1);
  assert.equal(r.mae, 6);
});
