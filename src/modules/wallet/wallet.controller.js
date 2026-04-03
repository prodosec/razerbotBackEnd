const walletService = require('./wallet.service');

/**
 * Refresh wallet balance from Razer API
 */
async function refreshBalance(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    const razerAccessToken = req.user.accessToken_razer;

    if (!razerAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Razer access token not found. Please log in with Razer.'
      });
    }

    const wallet = await walletService.updateWalletBalance(userId, razerAccessToken);
    return res.json({
      success: true,
      message: 'Balance refreshed successfully',
      data: {
        gold: wallet.gold,
        currency: wallet.currency,
        razer_gold_balance: wallet.razer_gold_balance,
        razer_currency_balance: wallet.razer_currency_balance,
        lastUpdated: wallet.lastUpdated,
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getSilverWallet(req, res, next) {
  try {
    const data = await walletService.fetchRazerWalletBalances(req.userId);

    return res.json({
      success: true,
      message: 'Silver wallet fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}



module.exports = {
  refreshBalance,
  getSilverWallet,
};
