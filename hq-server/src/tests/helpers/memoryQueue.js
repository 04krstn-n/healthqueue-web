/**
 * In-memory stand-in for the QueueEntry model — just enough of the Mongoose
 * API (find / findById / findOne / findOneAndUpdate / findByIdAndUpdate /
 * countDocuments / create / updateOne) for queue controller and sweeper
 * tests. Filters support equality, $in, $nin, $lte, $gte, $ne.
 */
const { query } = require('./stub');

const matches = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
  const val = doc[k];
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === '$in') return x.map(String).includes(String(val));
      if (op === '$nin') return !x.map(String).includes(String(val));
      if (op === '$lte') return val != null && val <= x;
      if (op === '$gte') return val != null && val >= x;
      if (op === '$ne') return String(val) !== String(x);
      throw new Error(`unsupported operator ${op}`);
    });
  }
  return String(val) === String(cond);
});

const applyUpdate = (doc, update) => {
  const set = update.$set || (Object.keys(update).some((k) => k.startsWith('$')) ? {} : update);
  Object.assign(doc, set);
  for (const k of Object.keys(update.$unset || {})) delete doc[k];
  for (const [k, n] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + n;
};

const createStore = () => {
  const docs = new Map();
  let seq = 0;
  const wrap = (d) => (d ? { ...d, save: async function save() { docs.set(String(this._id), { ...this }); } } : null);
  const model = {
    docs,
    reset: () => docs.clear(),
    insert: (d) => { const _id = d._id || `e${++seq}`; docs.set(String(_id), { _id, ...d }); return _id; },
    get: (id) => docs.get(String(id)),
    create: async (d) => wrap(docs.get(String(model.insert(d)))),
    find: (f = {}) => query(() => [...docs.values()].filter((d) => matches(d, f)).map(wrap)),
    findOne: (f = {}) => query(() => wrap([...docs.values()].find((d) => matches(d, f)))),
    findById: (id) => query(() => wrap(docs.get(String(id)))),
    countDocuments: async (f = {}) => [...docs.values()].filter((d) => matches(d, f)).length,
    findOneAndUpdate: async (f, u) => {
      // Atomic in a single-threaded test: filter check + update together.
      const d = [...docs.values()].find((x) => matches(x, f));
      if (!d) return null;
      applyUpdate(d, u);
      return wrap(d);
    },
    findByIdAndUpdate: async (id, u) => { const d = docs.get(String(id)); if (d) applyUpdate(d, u); return wrap(d); },
    updateOne: (f, u) => { const d = [...docs.values()].find((x) => matches(x, f)); if (d && !u.$push) applyUpdate(d, u); return { catch: () => {} }; },
    deleteOne: async (f) => { const d = [...docs.values()].find((x) => matches(x, f)); if (d) docs.delete(String(d._id)); },
  };
  return model;
};

module.exports = { createStore, matches };
