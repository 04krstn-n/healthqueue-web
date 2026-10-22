const path = require('path');
const dotenv = require('dotenv');

// 1. Attempt loading from current working directory
const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// 2. Fallback relative to this file if running from another directory
if (result.error) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const { HttpStatus } = require('../config/constants');

const NODE_ENV = process.env.NODE_ENV || 'development';

// JWT_SECRET must come from the environment (.env locally, Heroku config
// vars in production) in EVERY environment — there is no fallback value in
// the source code, because a secret that lives in the repo lets anyone who
// can read the code forge a login token for any user, including
// super_admin. The server refuses to start without it.
// FRONTEND_ORIGINS has no wildcard fallback either: production requires it.
const isProd = NODE_ENV === 'production';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
  throw new Error(
    'FATAL: JWT_SECRET must be set in the environment and be at least 32 characters. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}
if (isProd && !process.env.FRONTEND_ORIGINS) {
  throw new Error('FATAL: FRONTEND_ORIGINS must be set in the environment in production. Refusing to start.');
}

const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/pfg_hqdb',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',

  // Integrations & Keys
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY,
  SEMAPHORE_SENDER_NAME: process.env.SEMAPHORE_SENDER_NAME || 'HealthQ',
  RASA_SERVER_URL: process.env.RASA_SERVER_URL || 'http://localhost:5005',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,

  // CORS Security — no wildcard fallback. In dev, default to the local
  // Vite origin only; production requires FRONTEND_ORIGINS to be set
  // (enforced above).
  FRONTEND_ORIGINS: process.env.FRONTEND_ORIGINS
    ? process.env.FRONTEND_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:5173'],
};

// Validate environment variables in non-test mode
if (env.NODE_ENV !== 'test') {
  const requiredKeys = ['MONGO_URI', 'FRONTEND_ORIGINS'];

  requiredKeys.forEach((key) => {
    if (!process.env[key]) {
      console.warn(`\x1b[33m[WARN]\x1b[0m process.env.${key} is not set in .env. Using a local development default.`);
    }
  });
}

module.exports = { env, HttpStatus, ...env, };