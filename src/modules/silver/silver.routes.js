const express = require('express');
const router = express.Router();
const silverController = require('./silver.controller');
const auth = require('../../middleware/auth');

router.get('/catalogs', auth, silverController.getSilverCatalogs);
router.get('/catalogs/permalink/:permalink', auth, silverController.getSilverCatalogByPermalink);

module.exports = router;
