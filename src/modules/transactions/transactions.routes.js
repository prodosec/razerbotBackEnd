const express = require('express');
const auth = require('../../middleware/auth');
const transactionsController = require('./transactions.controller');

const router = express.Router();

router.post('/batches', auth, transactionsController.startBatch);
router.get('/batches/:jobId', auth, transactionsController.getBatchStatus);
router.post('/batches/:jobId/pause', auth, transactionsController.pauseBatch);
router.post('/batches/:jobId/resume', auth, transactionsController.resumeBatch);
router.post('/batches/:jobId/stop', auth, transactionsController.stopBatch);
router.post('/otp/generate', auth, transactionsController.generateOTP);
router.get('/history', auth, transactionsController.getTransactionHistory);
module.exports = router;
