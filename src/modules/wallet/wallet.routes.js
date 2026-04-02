const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
const auth = require('../../middleware/auth');

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
router.get('/silver', auth, walletController.getSilverWallet);

/**
 * @route GET /api/wallet/summary
 * @desc Get wallet summary
 * @access Private
 */
// router.get('/summary', authenticateToken, walletController.getWalletSummary);

module.exports = router;
