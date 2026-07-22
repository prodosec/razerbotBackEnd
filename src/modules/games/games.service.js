const { getStoredRazerHeaders } = require('../wallet/wallet.service');
const { getAxiosForUser, getProxyCountryForUser } = require('../../utils/proxyAxios');

const RAZER_GAMES_SEARCH_URL = 'https://gold.razer.com/api/search/gold-catalog';
const GOPRECHECK_PRICE_URL = process.env.GOPRECHECK_PRICE_URL || 'https://gold.razer.com/api/webshop/precheck/price';

// Razer has no Saudi storefront. The KSA products (xbox-ksa, netflix-ksa, amazon-ksa,
// anghami-plus-ksa, …) exist only in the global USD catalog, regionId 2 — the US regions
// (26/33) contain none of them, so no proxy change can surface them. When the account is
// routed through a Saudi proxy, force region 2; every other country keeps the caller's regionId.
const SAUDI_REGION_ID = 2;
const SAUDI_COUNTRY = /saudi|ksa/i;

async function resolveRegionId(userId, regionId) {
  const country = await getProxyCountryForUser(userId);
  if (country && SAUDI_COUNTRY.test(country)) {
    console.log(`[games] Saudi proxy (${country}) — overriding regionId ${regionId} → ${SAUDI_REGION_ID}`);
    return SAUDI_REGION_ID;
  }
  return regionId;
}

async function fetchGamesList(userId, regionId) {
  const [headers, axiosInstance, region] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), resolveRegionId(userId, regionId)]);
  const response = await axiosInstance.get(`https://gold.razer.com/api/v2/content/gold/catalogs/${region}`, { headers });
  return response.data;
}

async function searchGames(userId, keyword, regionId) {
  const [headers, axiosInstance, region] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), resolveRegionId(userId, regionId)]);
  const response = await axiosInstance.get(RAZER_GAMES_SEARCH_URL, {
    headers,
    params: { regionId: region, keyword },
  });
  return response.data;
}

async function fetchGameDetail(userId, regionId, permalink) {
  const [headers, axiosInstance, region] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), resolveRegionId(userId, regionId)]);
  const response = await axiosInstance.get(`https://gold.razer.com/api/v2/content/gold/catalogs/${region}/${permalink}`, { headers });
  return response.data;
}

async function fetchProductPrice(userId, payload) {
  const [headers, axiosInstance, region] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), resolveRegionId(userId, payload.regionId)]);
  const response = await axiosInstance.post(GOPRECHECK_PRICE_URL, { ...payload, regionId: region }, {
    headers: { ...headers, 'content-type': 'application/json' },
  });
  return response.data;
}

module.exports = { fetchGamesList, searchGames, fetchGameDetail, fetchProductPrice };
