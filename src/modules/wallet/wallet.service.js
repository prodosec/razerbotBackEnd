const axios = require('axios');
const Wallet = require('./wallet.model');
const RazerPayloadData = require('../auth/razerPayloadData.model');

const DEFAULT_RAZER_GOLD_URL = process.env.RAZER_GOLD_URL || 'https://gold.razer.com/pk/en';

/**
 * Fetch gold and currency balance from Razer API
 */
async function fetchRazerBalance(razerAccessToken) {
  try {
    // Fetch wallet balance from Razer API
    const response = await axios.get(
      'https://razerid.razer.com/api/emily/7/wallet/balance',
      {
        headers: {
          Authorization: `Bearer ${razerAccessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    );

    console.log('Razer wallet response:', response.data);

    return {
      gold: response.data?.gold || 0,
      currency: response.data?.currency || 0,
      razer_gold_balance: response.data?.gold || 0,
      razer_currency_balance: response.data?.currency || 0,
    };
  } catch (err) {
    console.error('Error fetching Razer balance:', err.response?.data || err.message);
    // Return default values on error
    return {
      gold: 0,
      currency: 0,
      razer_gold_balance: 0,
      razer_currency_balance: 0,
    };
  }
}

/**
 * Update wallet with Razer data
 */
async function updateWalletBalance(userId, razerAccessToken) {
  try {
    const balanceData = await fetchRazerBalance(razerAccessToken);

    let wallet = await Wallet.findOneAndUpdate(
      { userId },
      {
        $set: {
          gold: balanceData.gold,
          currency: balanceData.currency,
          razer_gold_balance: balanceData.razer_gold_balance,
          razer_currency_balance: balanceData.razer_currency_balance,
          lastUpdated: new Date(),
        }
      },
      { upsert: true, new: true }
    );

    return wallet;
  } catch (err) {
    console.error('Error updating wallet balance:', err.message);
    throw { status: 500, message: 'Failed to update wallet balance' };
  }
}

async function fetchRazerWalletBalances(userId) {
  const payload = await RazerPayloadData.findOne({ userId });
  if (!payload) {
    throw { status: 404, message: 'Razer payload data not found. Please log in with Razer first.' };
  }

  if (!payload.xRazerAccessToken || !payload.xRazerFpid || !payload.xRazerRazerid) {
    throw { status: 400, message: 'Stored Razer headers are incomplete. Please log in with Razer again.' };
  }

  const headers = {
    accept: 'application/json, text/plain, */*',
    cookie: payload.cookieHeader || '',
    referer: payload.referer || DEFAULT_RAZER_GOLD_URL,
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'x-razer-accesstoken': payload.xRazerAccessToken,
    'x-razer-fpid': payload.xRazerFpid,
    'x-razer-razerid': payload.xRazerRazerid,
  };

  const [responseSilver, responseGold] = await Promise.all([
    axios.get('https://gold.razer.com/api/silver/wallet', { headers }),
    axios.get('https://gold.razer.com/api/gold/balance', { headers }),
  ]);

  return {
    silver: responseSilver.data,
    gold: responseGold.data,
  };
}



module.exports = {
  fetchRazerBalance,
  updateWalletBalance,
  fetchRazerWalletBalances,
};
