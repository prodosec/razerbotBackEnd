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
    const regionId = Number(req.query.regionId);
    if (!Number.isInteger(regionId) || regionId < 1) {
      return res.status(400).json({
        success: false,
        message: 'regionId query parameter is required and must be a positive integer',
      });
    }

    const data = await gamesService.fetchGamesList(req.userId, regionId);
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
    const regionId = Number(req.query.regionId);

    if (!keyword) {
      return res.status(400).json({
        success: false,
        message: 'keyword query parameter is required',
      });
    }

    if (!Number.isInteger(regionId) || regionId < 1) {
      return res.status(400).json({
        success: false,
        message: 'regionId query parameter is required and must be a positive integer',
      });
    }

    const data = await gamesService.searchGames(req.userId, keyword, regionId);

    return res.json({
      success: true,
      message: 'Games search fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getGameDetail(req, res, next) {
  try {
    const regionId = Number(req.params.regionId);
    const permalink = req.params.permalink?.trim();

    if (!Number.isInteger(regionId) || regionId < 1) {
      return res.status(400).json({
        success: false,
        message: 'regionId param must be a positive integer',
      });
    }

    if (!permalink) {
      return res.status(400).json({
        success: false,
        message: 'permalink param is required',
      });
    }

    const data = await gamesService.fetchGameDetail(req.userId, regionId, permalink);
    return res.json({
      success: true,
      message: 'Game detail fetched successfully',
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
  getGameDetail,
  getProductPrices,
};
