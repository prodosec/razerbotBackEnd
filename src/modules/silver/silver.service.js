const { getStoredRazerHeaders } = require('../wallet/wallet.service');
const { getAxiosForUser } = require('../../utils/proxyAxios');

const SILVER_CATALOGS_URL = 'https://gold.razer.com/api/content/silver/catalogs';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Razer returns error 70610 "transaction number is not unique" when concurrent redeems on
// the same session collide and Razer generates a duplicate transaction number. It is a
// transient race, safe to retry. Detect it across the shapes Razer may use.
function isTransactionNotUnique(body) {
  if (!body) return false;
  const code = body.code ?? body.errorCode ?? body.error_code ?? body.status;
  if (String(code) === '70610') return true;
  try {
    const s = JSON.stringify(body).toLowerCase();
    if (s.includes('70610')) return true;
    if (s.includes('not unique') && s.includes('transaction')) return true;
  } catch {}
  return false;
}

async function fetchSilverCatalogs(userId) {
  const [headers, axiosInstance] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId)]);

  const response = await axiosInstance.get(SILVER_CATALOGS_URL, {
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

  const data = response.data;
  if (Array.isArray(data.catalogs)) {
    data.catalogs = data.catalogs.map(({ imgName, ...item }) => item);
  }
  return data;
}

async function fetchSilverCatalogByPermalink(userId, permalink) {
  const [headers, axiosInstance] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId)]);

  const catalogResponse = await axiosInstance.get(`https://gold.razer.com/api/content/silver/catalogs/permalink/${permalink}`, {
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
  const product = catalogResponse.data;
  const regionId = product?.regions?.[0]?.id;

  let balance = null;
  if (regionId) {
    try {
      const balanceResponse = await axiosInstance.get(`https://gold.razer.com/api/pincodes/balancev2/${regionId}`, {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'x-razer-accesstoken': headers['x-razer-accesstoken'],
          'x-razer-fpid': headers['x-razer-fpid'],
          'x-razer-razerid': headers['x-razer-razerid'],
          'cookie': headers['cookie'],
          'Referer': `https://gold.razer.com/globalzh/en/silver/redeem/summary/${permalink}`,
        },
      });
      balance = balanceResponse.data;
    } catch {}
  }

  return { product, regionId, balance };
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

  const axiosInstance = await getAxiosForUser(userId);

  const reqHeaders = {
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

  // Retry on Razer error 70610 ("transaction number is not unique") — a race when concurrent
  // redeems on the same session collide. A fresh POST gets a fresh transaction number, so
  // retrying resolves it. A small jitter before each attempt de-syncs concurrent requests.
  const MAX_REDEEM_ATTEMPTS = 4;
  let redeemData;
  for (let attempt = 1; attempt <= MAX_REDEEM_ATTEMPTS; attempt++) {
    const jitter = 50 + Math.floor(Math.random() * 250);
    await wait(jitter);

    console.log(`${tag} POST https://gold.razer.com/api/pincodes/redeemOS (attempt ${attempt}/${MAX_REDEEM_ATTEMPTS}, jitter ${jitter}ms)`);
    console.log(`${tag} body:`, JSON.stringify(body));

    const response = await axiosInstance.post('https://gold.razer.com/api/pincodes/redeemOS', body, {
      headers: reqHeaders,
      validateStatus: () => true,
    });

    const respBody = response.data;

    if (isTransactionNotUnique(respBody)) {
      if (attempt < MAX_REDEEM_ATTEMPTS) {
        const backoff = 150 * attempt + Math.floor(Math.random() * 200);
        console.warn(`${tag} RETRY: Razer error 70610 (transaction number not unique) on attempt ${attempt}/${MAX_REDEEM_ATTEMPTS} — retrying after ${backoff}ms. Body:`, respBody);
        await wait(backoff);
        continue;
      }
      // All attempts collided — surface a stable, frontend-detectable marker.
      throw new Error(`TXN_NOT_UNIQUE_70610: transaction number not unique — failed after ${MAX_REDEEM_ATTEMPTS} attempts. Body: ${JSON.stringify(respBody)}`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Silver redeem failed with status ${response.status}. Body: ${JSON.stringify(respBody)}`);
    }

    redeemData = respBody;
    break;
  }

  // Auto-fetch receipt using transactionId from redeem response
  const transactionId = redeemData?.transactionNumber || redeemData?.transactionId || redeemData?.id;
  let receipt = null;
  if (transactionId) {
    try {
      const receiptRes = await axiosInstance.get(`https://gold.razer.com/api/receipts/${transactionId}/silver`, {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'x-razer-accesstoken': razerPayload.xRazerAccessToken,
          'x-razer-fpid': razerPayload.xRazerFpid || '',
          'x-razer-razerid': razerPayload.xRazerRazerid || '',
          'cookie': razerPayload.cookieHeader,
          'Referer': `https://gold.razer.com/global/en/transaction/zSilver/${transactionId}`,
        },
        validateStatus: () => true,
      });
      if (receiptRes.status === 200) receipt = receiptRes.data;
    } catch {}
  }

  return { ...redeemData, transactionId, receipt };
}

async function fetchSilverReceipt(userId, transactionId) {
  const [headers, axiosInstance] = await Promise.all([getStoredRazerHeaders(userId), getAxiosForUser(userId)]);

  const response = await axiosInstance.get(`https://gold.razer.com/api/receipts/${transactionId}/silver`, {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'x-razer-accesstoken': headers['x-razer-accesstoken'],
      'x-razer-fpid': headers['x-razer-fpid'] || '',
      'x-razer-razerid': headers['x-razer-razerid'] || '',
      'cookie': headers['cookie'],
      'Referer': `https://gold.razer.com/global/en/transaction/zSilver/${transactionId}`,
    },
    validateStatus: () => true,
  });

  if (response.status !== 200)
    throw { status: response.status, message: `Receipt API error (${response.status}): ${JSON.stringify(response.data)}` };

  return response.data;
}

module.exports = { fetchSilverCatalogs, fetchSilverCatalogByPermalink, redeemSilver, fetchSilverReceipt };
