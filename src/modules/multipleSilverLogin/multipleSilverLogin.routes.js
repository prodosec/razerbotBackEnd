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

// POST /api/multiple-silver-login/authenticate
// Body: { accounts: [{ email, authenticatorCode }] }
router.post('/authenticate', auth, controller.bulkAuthenticate);

// GET /api/multiple-silver-login/product-balance/:permalink  (single)
router.get('/product-balance/:permalink', auth, controller.productBalance);



// POST /api/multiple-silver-login/transact
// Body: { accounts: [{ email, authenticatorCode }], product: { productId, regionId, paymentChannelId, permalink }, batchSize? }
router.post('/transact', auth, controller.bulkTransact);

// GET /api/multiple-silver-login/debug/:email
router.get('/debug/:email', auth, controller.debugPayload);

// POST /api/multiple-silver-login/silver-balances
// Body: { emails?: ["email1", "email2"] }  — omit emails to fetch all loaded accounts
router.post('/silver-balances', auth, controller.bulkSilverBalance);

// GET /api/multiple-silver-login/logs?limit=100
router.get('/logs', auth, controller.getLogs);
// DELETE /api/multiple-silver-login/logs
router.delete('/logs', auth, controller.clearLogs);

module.exports = router;
