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

  const data = await response.json();
  if (Array.isArray(data.catalogs)) {
    data.catalogs = data.catalogs.map(({ imgName, ...item }) => item);
  }
  return data;
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

async function redeemSilver(userId, payload) {
  const tag = `[silver][redeem]`;

  const missingOtpFields = ['otp_token', 'rzrotptoken', 'rzrotptokenTs', 'otp_token_enc'].filter(
    (f) => !payload[f] || String(payload[f]).trim() === ''
  );
  if (missingOtpFields.length > 0) {
    throw new Error(`Missing or empty OTP fields: ${missingOtpFields.join(', ')}. Please generate OTP first.`);
  }

  const razerPayload = await require('../auth/razerPayloadData.model').findOne({ userId });
  if (!razerPayload) {
    throw { status: 404, message: `No Razer session found for user ${userId}. Please log in again.` };
  }

  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'pragma': 'no-cache',
    'x-razer-accesstoken': razerPayload.xRazerAccessToken,
    'x-razer-fpid': razerPayload.xRazerFpid,
    'x-razer-razerid': razerPayload.xRazerRazerid,
    'cookie': `${razerPayload.cookieHeader}; _rzrotptoken=${payload.rzrotptoken}; _rzrotptokents=${payload.rzrotptokenTs}; otpToken=${encodeURIComponent(payload.otp_token)}`,
    'Referer': `https://gold.razer.com/globalzh/en/silver/redeem/summary/${payload.permalink || ''}`,
  };

  const body = {
    zSilver_id: payload.zSilver_id,
    region_id: payload.region_id,
    silver_reward_id: payload.silver_reward_id,
    amount: payload.amount,
    language: 'en',
    otpToken: payload.otp_token_enc,
    pinSupplier: 'molap',
  };

  console.log(`${tag} POST https://gold.razer.com/api/pincodes/redeemOS`);
  console.log(`${tag} body:`, JSON.stringify(body));

  const response = await fetch('https://gold.razer.com/api/pincodes/redeemOS', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const responseText = await response.text().catch(() => '(could not read body)');

  if (!response.ok) {
    console.error(`${tag} ERROR ${response.status}:`, responseText);
    throw { status: response.status, message: `Silver redeem API returned ${response.status}: ${responseText}` };
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { raw: responseText };
  }
}

module.exports = { fetchSilverCatalogs, fetchSilverCatalogByPermalink, redeemSilver };
