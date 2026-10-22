const express = require('express');
const router = express.Router();
const { getQueueBoard } = require('../controllers/publicController');

// No `protect` here on purpose — see publicController.js for what is exposed.
router.get('/queue-board/:clinicId', getQueueBoard);

module.exports = router;
