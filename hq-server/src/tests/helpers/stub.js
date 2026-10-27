/**
 * Tiny test helpers — no extra npm packages needed (uses Node's built-in
 * node:test runner). Database models are replaced with in-memory stand-ins
 * by putting fake modules into Node's require cache BEFORE the code under
 * test is loaded, so these tests run without MongoDB, Firebase or Semaphore.
 *
 * Run all tests from the server folder:   node --test tests/
 */
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests-only-0123456789';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-not-used';

const SRC = path.join(__dirname, '..', '..', 'src');

const resolve = (rel) => require.resolve(path.join(SRC, rel));

/** Replace src/<rel> with `exports` for every later require(). */
const stub = (rel, exports) => {
  const p = resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
  return exports;
};

/** Load src/<rel> fresh (after stubs are in place). */
const load = (rel) => {
  const p = resolve(rel);
  delete require.cache[p];
  return require(p);
};

/** Minimal Express-style response object that records what was sent. */
const fakeRes = () => {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.sendFile = (f) => { res.body = { file: f }; return res; };
  return res;
};

/** Chainable query stand-in: await q, q.select(), q.lean(), q.populate(), q.sort()... */
const query = (value) => {
  const q = {
    select: () => q, lean: () => q, populate: () => q, sort: () => q, limit: () => q, session: () => q,
    then: (ok, fail) => Promise.resolve(typeof value === 'function' ? value() : value).then(ok, fail),
  };
  return q;
};

module.exports = { stub, load, fakeRes, query, SRC };
