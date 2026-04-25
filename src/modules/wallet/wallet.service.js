const axios = require('axios');
const Wallet = require('./wallet.model');
const RazerPayloadData = require('../auth/razerPayloadData.model');
const { getAxiosForUser } = require('../../utils/proxyAxios');

const DEFAULT_RAZER_GOLD_URL = process.env.RAZER_GOLD_URL || 'https://gold.razer.com/pk/en';

async function getStoredRazerHeaders(userId) {
  const payload = await RazerPayloadData.findOne({ userId });
  if (!payload) {
    throw { status: 404, message: 'Razer payload data not found. Please log in with Razer first.' };
  }

  if (!payload.xRazerAccessToken) {
    throw { status: 400, message: 'Stored Razer headers are incomplete. Please log in with Razer again.' };
  }

  return {
    accept: 'application/json, text/plain, */*',
    cookie: payload.cookieHeader || '',
    referer: payload.referer || DEFAULT_RAZER_GOLD_URL,
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'x-razer-accesstoken': payload.xRazerAccessToken,
    'x-razer-fpid': payload.xRazerFpid,
    'x-razer-razerid': payload.xRazerRazerid,
  };
}

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

async function refreshAccessToken(userId, axiosInstance) {
  const payload = await RazerPayloadData.findOne({ userId });
  if (!payload) return null;

  const SSO_CLIENT_ID = process.env.LAST_CLIENT_ID_PASSED || '63c74d17e027dc11f642146bfeeaee09c3ce23d8';
  try {
    const res = await axiosInstance.post(
      'https://oauth2.razer.com/services/sso',
      new URLSearchParams({ client_id: SSO_CLIENT_ID, client_key: 'enZhdWx0', scope: 'sso cop' }).toString(),
      {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/x-www-form-urlencoded',
          'cookie': payload.cookieHeader || '',
          'Origin': 'https://gold.razer.com',
          'Referer': 'https://gold.razer.com/',
        },
        validateStatus: () => true,
      }
    );
    const newToken = res.data?.access_token || null;
    if (newToken) {
      await RazerPayloadData.findOneAndUpdate({ userId }, { $set: { xRazerAccessToken: newToken, capturedAt: new Date() } });
      console.log(`[wallet] Access token refreshed for userId=${userId}`);
    }
    return newToken;
  } catch {
    return null;
  }
}

async function fetchGoldBalance(userId) {
  const [headers, axiosInstance] = await Promise.all([
    getStoredRazerHeaders(userId),
    getAxiosForUser(userId),
  ]);

  const doFetch = (h) =>
    axiosInstance.get('https://gold.razer.com/api/gold/balance', { headers: h, validateStatus: () => true });

  let response = await doFetch(headers);

  if (response.status === 401 || response.status === 403) {
    console.warn(`[wallet] ${response.status} received — refreshing access token for userId=${userId}`);
    const newToken = await refreshAccessToken(userId, axiosInstance);
    if (newToken) {
      headers['x-razer-accesstoken'] = newToken;
      response = await doFetch(headers);
    }
  }

  if (response.status !== 200) throw { status: response.status, message: `Gold balance API error (${response.status})` };

  return response.data;
}

async function fetchRazerWalletBalances(userId) {
  const [headers, axiosInstance] = await Promise.all([
    getStoredRazerHeaders(userId),
    getAxiosForUser(userId),
  ]);

  const doFetch = (h) => Promise.all([
    axiosInstance.get('https://gold.razer.com/api/silver/wallet', { headers: h, validateStatus: () => true }),
    axiosInstance.get('https://gold.razer.com/api/gold/balance', { headers: h, validateStatus: () => true }),
  ]);

  let [responseSilver, responseGold] = await doFetch(headers);

  // If either call returned 401/403, refresh token and retry once
  if ([401, 403].includes(responseSilver.status) || [401, 403].includes(responseGold.status)) {
    console.warn(`[wallet] ${responseSilver.status}/${responseGold.status} received — refreshing access token for userId=${userId}`);
    const newToken = await refreshAccessToken(userId, axiosInstance);
    if (newToken) {
      headers['x-razer-accesstoken'] = newToken;
      [responseSilver, responseGold] = await doFetch(headers);
    }
  }

  if (responseSilver.status !== 200) throw { status: responseSilver.status, message: `Silver wallet API error (${responseSilver.status})` };
  if (responseGold.status !== 200) throw { status: responseGold.status, message: `Gold balance API error (${responseGold.status})` };

  return {
    silver: responseSilver.data,
    gold: responseGold.data,
  };
}



module.exports = {
  fetchRazerBalance,
  updateWalletBalance,
  fetchRazerWalletBalances,
  fetchGoldBalance,
  getStoredRazerHeaders,
};
