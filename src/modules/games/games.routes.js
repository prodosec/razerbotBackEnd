const express = require('express');
const router = express.Router();
const gamesController = require('./games.controller');
const auth = require('../../middleware/auth');

router.get('/list', auth, gamesController.getGamesList);
router.get('/search', auth, gamesController.searchGames);
router.post('/prices', auth, gamesController.getProductPrices);
router.get('/:regionId/:permalink', auth, gamesController.getGameDetail);

module.exports = router;
