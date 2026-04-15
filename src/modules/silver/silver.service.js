const { getStoredRazerHeaders } = require('../wallet/wallet.service');

const SILVER_CATALOGS_URL = 'https://gold.razer.com/api/content/silver/catalogs';

async function fetchSilverCatalogs(userId) {
  const headers = await getStoredRazerHeaders(userId);

  const response = await fetch(SILVER_CATALOGS_URL, {
    method: 'GET',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'x-razer-fpid': headers['x-razer-fpid'],
      'x-razer-language': 'en',
      'cookie': headers['cookie'],
      'Referer': 'https://gold.razer.com/globalzh/en/silver/redeem',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(could not read body)');
    throw { status: response.status, message: `Razer silver catalogs API returned ${response.status}: ${body}` };
  }

  return response.json();
}

async function fetchSilverCatalogByPermalink(userId, permalink) {
  const headers = await getStoredRazerHeaders(userId);

  const response = await fetch(`https://gold.razer.com/api/content/silver/catalogs/permalink/${permalink}`, {
    method: 'GET',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'x-razer-fpid': headers['x-razer-fpid'],
      'x-razer-language': 'en',
      'cookie': headers['cookie'],
      'Referer': `https://gold.razer.com/globalzh/en/silver/redeem/summary/${permalink}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(could not read body)');
    throw { status: response.status, message: `Razer silver catalog detail API returned ${response.status}: ${body}` };
  }

  return response.json();
}

module.exports = { fetchSilverCatalogs, fetchSilverCatalogByPermalink };
