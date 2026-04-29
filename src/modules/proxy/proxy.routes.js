const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const proxyController = require('./proxy.controller');

router.get('/', auth, proxyController.listProxies);
router.post('/', auth, proxyController.createProxy);
router.patch('/:id', auth, proxyController.updateProxy);
router.delete('/:id', auth, proxyController.deleteProxy);
router.post('/reload', auth, proxyController.reload);

module.exports = router;
