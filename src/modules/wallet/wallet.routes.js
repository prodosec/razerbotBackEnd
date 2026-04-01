const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
// const { authenticateToken } = require('../../middleware/auth');

/**
 * @route GET /api/wallet/balance
 * @desc Get user's wallet balance
 * @access Private
 */

/**
 * @route POST /api/wallet/refresh
 * @desc Refresh wallet balance from Razer API
 * @access Private
 */
// router.post('/refresh', authenticateToken, walletController.refreshBalance);

/**
 * @route GET /api/wallet/summary
 * @desc Get wallet summary
 * @access Private
 */
// router.get('/summary', authenticateToken, walletController.getWalletSummary);

module.exports = router;
