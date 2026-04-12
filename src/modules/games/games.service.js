const axios = require('axios');
const { getStoredRazerHeaders } = require('../wallet/wallet.service');

const RAZER_GAMES_SEARCH_URL = 'https://gold.razer.com/api/search/gold-catalog';
const GOPRECHECK_PRICE_URL = process.env.GOPRECHECK_PRICE_URL || 'https://gold.razer.com/api/webshop/precheck/price';

async function fetchGamesList(userId, regionId) {
  const headers = await getStoredRazerHeaders(userId);
  const response = await axios.get(`https://gold.razer.com/api/v2/content/gold/catalogs/${regionId}`, { headers });
  return response.data;
}

async function searchGames(userId, keyword, regionId) {
  const headers = await getStoredRazerHeaders(userId);
  const response = await axios.get(RAZER_GAMES_SEARCH_URL, {
    headers,
    params: { regionId, keyword },
  });
  return response.data;
}

async function fetchGameDetail(userId, regionId, permalink) {
  const headers = await getStoredRazerHeaders(userId);
  const response = await axios.get(`https://gold.razer.com/api/v2/content/gold/catalogs/${regionId}/${permalink}`, { headers });
  return response.data;
}

async function fetchProductPrice(userId, payload) {
  const headers = await getStoredRazerHeaders(userId);
  const requestHeaders = {
    ...headers,
    'content-type': 'application/json',
  };

  const response = await axios.post(GOPRECHECK_PRICE_URL, payload, {
    headers: requestHeaders,
  });

  return response.data;
}

module.exports = {
  fetchGamesList,
  searchGames,
  fetchGameDetail,
  fetchProductPrice,
};
