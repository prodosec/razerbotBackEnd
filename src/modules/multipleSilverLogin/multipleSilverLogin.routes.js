const express = require('express');
const router = express.Router();
const controller = require('./multipleSilverLogin.controller');
const auth = require('../../middleware/auth');

// POST /api/multiple-silver-login/load
// Body: { accounts: [{ email, password, serviceCode? }], batchSize?: number }
router.post('/load', auth, controller.bulkLoad);

// POST /api/multiple-silver-login/load-stream  (SSE — live progress)
// Body: { accounts: [{ email, password, serviceCode? }], batchSize?: number }
router.post('/load-stream', auth, controller.bulkLoadStream);

module.exports = router;
