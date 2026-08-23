const express = require('express');
const router = express.Router();

const { getBestTimeToQueue, evaluate } = require('../controllers/prescriptiveController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/best-time/:clinicId', getBestTimeToQueue);
router.get('/evaluate', evaluate);

module.exports = router;
