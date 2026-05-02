const express = require('express');
const router = express.Router();
const controller = require('./multiAccountHistory.controller');
const auth = require('../../middleware/auth');

// POST /api/multiple-silver-login/transactions-history
// Body: { accounts: [{ email, fromDate, toDate }] }
router.post('/transactions-history', auth, controller.transactionsHistory);

// POST /api/multiple-silver-login/pin-history
// Body: { accounts: [{ email, transactionNumbers: [...] }] }
router.post('/pin-history', auth, controller.pinHistory);

module.exports = router;
