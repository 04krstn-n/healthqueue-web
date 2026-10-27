/**
 * JWT Token Utilities
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/config');

/**
 * Sign a JWT for a user.
 */
const signToken = (user) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set in config.');
  }

  return jwt.sign(
    { 
      id: user._id, 
      _id: user._id, 
      role: user.role, 
      clinicId: user.clinicId || null 
    },
    JWT_SECRET,
    // jwtid gives every login its own id, so logout can revoke exactly this
    // token (see models/RevokedToken.js) without ending other devices.
    { expiresIn: JWT_EXPIRES_IN || '1d', jwtid: crypto.randomUUID() }
  );
};

/**
 * Verifies a token
 */
const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

module.exports = { 
  signToken, 
  generateToken: signToken, // Alias
  verifyToken 
};