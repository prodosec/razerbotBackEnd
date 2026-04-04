const gamesService = require('./games.service');

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

module.exports = {
  getGamesList,
  searchGames,
};
