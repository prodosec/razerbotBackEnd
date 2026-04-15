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

module.exports = { getSilverCatalogs, getSilverCatalogByPermalink };
