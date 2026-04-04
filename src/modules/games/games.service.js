const axios = require('axios');
const { getStoredRazerHeaders } = require('../wallet/wallet.service');

const RAZER_GAMES_CATALOG_URL = 'https://gold.razer.com/api/v2/content/gold/catalogs/29';
const RAZER_GAMES_SEARCH_URL = 'https://gold.razer.com/api/search/gold-catalog';

async function fetchGamesList(userId) {
  const headers = await getStoredRazerHeaders(userId);
  const response = await axios.get(RAZER_GAMES_CATALOG_URL, { headers });
  return response.data;
}

async function searchGames(userId, keyword) {
  const headers = await getStoredRazerHeaders(userId);
  const response = await axios.get(RAZER_GAMES_SEARCH_URL, {
    headers,
    params: {
      regionId: 29,
      keyword,
    },
  });
  return response.data;
}

module.exports = {
  fetchGamesList,
  searchGames,
};
