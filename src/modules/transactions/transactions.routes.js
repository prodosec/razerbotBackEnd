const express = require('express');
const auth = require('../../middleware/auth');
const transactionsController = require('./transactions.controller');

const router = express.Router();

router.post('/batches', auth, transactionsController.startBatch);
router.get('/batches/:jobId', auth, transactionsController.getBatchStatus);
router.post('/batches/:jobId/pause', auth, transactionsController.pauseBatch);
router.post('/batches/:jobId/resume', auth, transactionsController.resumeBatch);
router.post('/batches/:jobId/stop', auth, transactionsController.stopBatch);

module.exports = router;
