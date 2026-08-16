/**
 * Global Error Handler Middleware
 */
const { HttpStatus, NODE_ENV } = require('../config/config');

// 404 Catcher
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  res.status(HttpStatus.NOT_FOUND);
  next(error);
};

// Global Error Responder
const errorHandler = (err, req, res, next) => {
  const statusCode =
    res.statusCode && res.statusCode !== HttpStatus.OK
      ? res.statusCode
      : HttpStatus.INTERNAL_SERVER_ERROR;

  console.error(`[ERROR] ${err.message}`);

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    // Include stack trace only in development mode
    ...(NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };