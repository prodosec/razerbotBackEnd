const { getStoredRazerHeaders } = require('../wallet/wallet.service');
const { getAxiosForUser, getProxyCountryForUser } = require('../../utils/proxyAxios');

const RAZER_GAMES_SEARCH_URL = 'https://gold.razer.com/api/search/gold-catalog';
const GOPRECHECK_PRICE_URL = process.env.GOPRECHECK_PRICE_URL || 'https://gold.razer.com/api/webshop/precheck/price';

// Razer has no Saudi storefront, and the KSA/MENA products are split across two catalogs
// with neither a superset of the other:
//   region 2  — Xbox (KSA), Amazon (KSA), Saya (KSA), Yalla Live, Free Fire top-up, MBC Shahid
//   region 38 — the PlayStation Store Gulf family (KSA, UAE, Kuwait, Qatar, Oman, Bahrain)
// The US regions (26/33) contain none of them, which is why a Saudi proxy alone changed
// nothing. A Saudi account therefore lists both catalogs merged, and each product carries
// the regionId it came from so detail/price lookups hit the catalog that actually has it.
const SAUDI_REGION_IDS = [2, 38];
const SAUDI_COUNTRY = /saudi|ksa/i;

async function isSaudiUser(userId) {
  const country = await getProxyCountryForUser(userId);
  return !!country && SAUDI_COUNTRY.test(country);
}

async function resolveRegionId(userId, regionId) {
  if (!(await isSaudiUser(userId))) return regionId;
  // Honour whichever Saudi catalog the client asked for; otherwise fall back to the primary.
  const asked = Number(regionId);
  return SAUDI_REGION_IDS.includes(asked) ? asked : SAUDI_REGION_IDS[0];
}

// Merge catalogs from several regions, first region wins on duplicate permalinks.
function mergeCatalogs(parts, regionIds) {
  const merged = { ...parts[0], catalogs: [] };
  const seen = new Set();
  parts.forEach((part, i) => {
    for (const item of part?.catalogs || []) {
      if (seen.has(item.permalink)) continue;
      seen.add(item.permalink);
      merged.catalogs.push({ ...item, regionId: regionIds[i] });
    }
  });
  return merged;
}

async function fetchGamesList(userId, regionId) {
  const [headers, axiosInstance, saudi] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), isSaudiUser(userId)]);
  const fetchRegion = async (region) => {
    const response = await axiosInstance.get(`https://gold.razer.com/api/v2/content/gold/catalogs/${region}`, { headers });
    return response.data;
  };

  if (!saudi) return fetchRegion(regionId);

  const parts = await Promise.all(SAUDI_REGION_IDS.map(fetchRegion));
  const merged = mergeCatalogs(parts, SAUDI_REGION_IDS);
  console.log(`[games] Saudi proxy — merged regions ${SAUDI_REGION_IDS.join('+')} → ${merged.catalogs.length} products`);
  return merged;
}

async function searchGames(userId, keyword, regionId) {
  const [headers, axiosInstance, saudi] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), isSaudiUser(userId)]);
  const searchRegion = async (region) => {
    const response = await axiosInstance.get(RAZER_GAMES_SEARCH_URL, {
      headers,
      params: { regionId: region, keyword },
    });
    return response.data;
  };

  if (!saudi) return searchRegion(regionId);

  // Search both Saudi catalogs so region-38-only hits (PlayStation Store Gulf) still surface.
  const parts = await Promise.all(SAUDI_REGION_IDS.map(searchRegion));
  const data = [];
  const seen = new Set();
  parts.forEach((part, i) => {
    for (const item of part?.data || []) {
      if (seen.has(item.permalink)) continue;
      seen.add(item.permalink);
      data.push({ ...item, regionId: SAUDI_REGION_IDS[i] });
    }
  });
  return { ...parts[0], totalCount: data.length, data };
}

async function fetchGameDetail(userId, regionId, permalink) {
  const [headers, axiosInstance, region] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId), resolveRegionId(userId, regionId)]);
  const response = await axiosInstance.get(`https://gold.razer.com/api/v2/content/gold/catalogs/${region}/${permalink}`, { headers });
  return response.data;
}

async function fetchProductPrice(userId, payload) {
  const [headers, axiosInstance] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId)]);
  const response = await axiosInstance.post(GOPRECHECK_PRICE_URL, payload, {
    headers: { ...headers, 'content-type': 'application/json' },
  });
  return response.data;
}

module.exports = { fetchGamesList, searchGames, fetchGameDetail, fetchProductPrice };
