/**
 * Authentication & Role-based Access Control Middleware
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { HttpStatus, JWT_SECRET } = require('../config/config');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Not authorized — no token provided.',
      });
    }
    const token = authHeader.split(' ')[1];

    if (!JWT_SECRET) {
      console.error('FATAL: JWT_SECRET is not set in environment variables.');
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Server configuration error.',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Support both decoded.id and decoded._id
    const userId = decoded.id || decoded._id;
    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Not authorized — user not found.',
      });
    }

    if (!user.isActive) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: 'Your account has been deactivated.',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Token expired. Please log in again.',
      });
    }
    return res.status(HttpStatus.UNAUTHORIZED).json({
      success: false,
      message: 'Not authorized — invalid token.',
    });
  }
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(HttpStatus.FORBIDDEN).json({
      success: false,
      message: `Access denied. Required role(s): [${roles.join(', ')}].`,
    });
  }
  next();
};

const adminOnly      = authorizeRoles('super_admin', 'facility_admin');
const superAdminOnly = authorizeRoles('super_admin');
const staffOnly      = authorizeRoles('staff', 'facility_admin', 'super_admin');
const patientOnly    = authorizeRoles('patient');

module.exports = { 
  protect, 
  authorizeRoles, 
  adminOnly, 
  superAdminOnly, 
  staffOnly, 
  patientOnly 
};