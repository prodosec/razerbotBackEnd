const gamesService = require('./games.service');

function normalizeProductPayload(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return null;
  }

  return {
    regionId: Number(body.regionId),
    productId: Number(body.productId),
    paymentChannelId: Number(body.paymentChannelId),
    permalink: typeof body.permalink === 'string' ? body.permalink.trim() : '',
    hasGoldWallet: body.hasGoldWallet,
    productName: typeof body.productName === 'string' ? body.productName.trim() : '',
  };
}

async function getGamesList(req, res, next) {
  try {
    const data = await gamesService.fetchGamesList(req.userId);
    return res.json({
      success: true,
      message: 'Games list fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function searchGames(req, res, next) {
  try {
    const keyword = req.query.keyword?.trim();

    if (!keyword) {
      return res.status(400).json({
        success: false,
        message: 'keyword query parameter is required',
      });
    }

    const data = await gamesService.searchGames(req.userId, keyword);

    return res.json({
      success: true,
      message: 'Games search fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getProductPrices(req, res, next) {
  try {
    const payload = normalizeProductPayload(req.body);

    if (!payload) {
      return res.status(400).json({
        success: false,
        message: 'Request body must be a single product object',
      });
    }

    if (
      !Number.isInteger(payload.regionId) ||
      !Number.isInteger(payload.productId) ||
      !Number.isInteger(payload.paymentChannelId) ||
      typeof payload.hasGoldWallet !== 'boolean' ||
      !payload.permalink ||
      !payload.productName
    ) {
      return res.status(400).json({
        success: false,
        message: 'regionId, productId, paymentChannelId, permalink, hasGoldWallet, and productName are required',
      });
    }

    const data = await gamesService.fetchProductPrice(req.userId, payload);

    return res.json({
      success: true,
      message: 'Product price fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getGamesList,
  searchGames,
  getProductPrices,
};
