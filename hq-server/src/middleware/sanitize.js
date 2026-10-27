/**
 * NoSQL-injection guard. MongoDB treats object keys that start with "$"
 * (e.g. { "$gt": "" }) as query operators, so a JSON body such as
 *   { "resetId": { "$ne": null } }
 * could change the meaning of a query. This middleware removes every key that
 * starts with "$" or contains "." from req.body (recursively) before any
 * controller sees them. (Route params are plain URL path strings.) Query strings are parsed with the "simple"
 * parser in server.js, which never produces nested objects, so they cannot
 * carry operators either.
 */
const MAX_DEPTH = 20;

const clean = (value, depth = 0) => {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = clean(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
    } else {
      value[key] = clean(value[key], depth + 1);
    }
  }
  return value;
};

const sanitizeRequest = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') clean(req.body);
  next();
};

module.exports = { sanitizeRequest, _clean: clean };
