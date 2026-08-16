// db.js
const mongoose = require('mongoose');
const { env } = require('./config');
const { MONGO_URI, NODE_ENV } = env; 

const connectDB = async () => {
  if (!MONGO_URI) {
    console.error('FATAL: MONGO_URI environment variable is not set in config.');
    process.exit(1);
  }

  try {
    // Connection lifecycle listeners
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected — attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected successfully');
    });

    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB connection error: ${err.message}`);
    });

    const conn = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host} [${NODE_ENV}]`);
  } catch (err) {
    console.error(`FATAL: MongoDB initial connection failed — ${err.message}`);
    process.exit(1);
  }
};

// Graceful shutdown on process termination
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed due to app termination (SIGINT)');
  process.exit(0);
});

module.exports = connectDB;