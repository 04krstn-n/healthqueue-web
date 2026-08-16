const path = require('path');
const dotenv = require('dotenv');

// 1. Attempt loading from current working directory
const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// 2. Fallback relative to this file if running from another directory
if (result.error) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const { HttpStatus } = require('../config/constants');

const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/pfg_hqdb',
  JWT_SECRET: process.env.JWT_SECRET || 'power_five_girls_health_queue_secret_key',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',

  // Integrations & Keys
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY,
  SEMAPHORE_SENDER_NAME: process.env.SEMAPHORE_SENDER_NAME || 'HealthQ',
  RASA_SERVER_URL: process.env.RASA_SERVER_URL || 'http://localhost:5005',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,

  // CORS Security
  FRONTEND_ORIGINS: process.env.FRONTEND_ORIGINS
    ? process.env.FRONTEND_ORIGINS.split(',').map((o) => o.trim())
    : '*',
};

// Validate environment variables in non-test mode
if (env.NODE_ENV !== 'test') {
  const requiredKeys = ['MONGO_URI', 'JWT_SECRET'];

  requiredKeys.forEach((key) => {
    if (!process.env[key]) {
      console.warn(`\x1b[33m[WARN]\x1b[0m process.env.${key} is not set in .env. Using fallback: "${env[key]}"`);
    }
  });
}

module.exports = { env, HttpStatus, ...env, };