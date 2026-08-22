const express = require('express');
const router = express.Router();
const { register, login, logout, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public Authentication
router.post('/register', register);
router.post('/login', login);

// Authenticated Account Context
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

module.exports = router;