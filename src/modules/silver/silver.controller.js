const silverService = require('./silver.service');

async function getSilverCatalogs(req, res, next) {
  try {
    const data = await silverService.fetchSilverCatalogs(req.userId);
    return res.json({
      success: true,
      message: 'Silver catalogs fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getSilverCatalogByPermalink(req, res, next) {
  try {
    const { permalink } = req.params;
    if (!permalink || !permalink.trim()) {
      return res.status(400).json({
        success: false,
        message: 'permalink param is required',
      });
    }

    const data = await silverService.fetchSilverCatalogByPermalink(req.userId, permalink.trim());
    return res.json({
      success: true,
      message: 'Silver catalog detail fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function redeemSilver(req, res, next) {
  try {
    const { zSilver_id, region_id, silver_reward_id, amount, rzrotptoken, rzrotptokenTs, otp_token_enc, otp_token, permalink } = req.body || {};

    const requiredFields = { zSilver_id, region_id, silver_reward_id, amount, rzrotptoken, rzrotptokenTs, otp_token_enc, otp_token };
    const missing = Object.entries(requiredFields)
      .filter(([, v]) => v === undefined || v === null || v === '')
      .map(([k]) => k);

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`,
      });
    }

    const data = await silverService.redeemSilver(req.userId, { zSilver_id, region_id, silver_reward_id, amount, rzrotptoken, rzrotptokenTs, otp_token_enc, otp_token, permalink });
    return res.json({
      success: true,
      message: 'Silver redeemed successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSilverCatalogs, getSilverCatalogByPermalink, redeemSilver };
