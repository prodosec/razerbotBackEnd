const TransactionBatchTest = require('./transactionTest.model');
const CompletedBatch = require('./completedBatch.model');
const { TransactionsManager, MAX_CONCURRENCY, ALLOWED_MODES } = require('./transactions.manager');
const RazerPayloadData = require('../auth/razerPayloadData.model');
const { getAxiosForUser } = require('../../utils/proxyAxios');

const manager = new TransactionsManager();

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function processWithFakeMode({ itemIndex, payload }) {
  const latency = 200 + Math.floor(Math.random() * 900);
  await wait(latency);

  const forceFail = Boolean(payload && payload.forceFail);
  const randomFail = Math.random() < 0.1;

  if (forceFail || randomFail) {
    throw new Error(`Fake transaction failed at index ${itemIndex}`);
  }

  return {
    simulated: true,
    latency,
    echo: payload,
  };
}

async function processWithMongoMode({ jobId, userId, itemIndex, payload }) {
  const startTime = Date.now();

  try {
    const responsePayload = {
      simulated: true,
      storage: 'mongodb',
      accepted: true,
      receivedAt: new Date(),
    };

    await TransactionBatchTest.create({
      userId,
      jobId,
      itemIndex,
      status: 'success',
      requestPayload: payload,
      responsePayload,
      processingMs: Date.now() - startTime,
      processedAt: new Date(),
    });

    return responsePayload;
  } catch (err) {
    await TransactionBatchTest.create({
      userId,
      jobId,
      itemIndex,
      status: 'failed',
      requestPayload: payload,
      responsePayload: {},
      errorMessage: err.message,
      processingMs: Date.now() - startTime,
      processedAt: new Date(),
    });

    throw err;
  }
}

async function processWithRazerMode({ userId, itemIndex, payload }) {
  const tag = `[razer][item ${itemIndex}]`;

  console.log(`${tag} ── START ──────────────────────────────`);
  console.log(`${tag} userId:`, userId);
  console.log(`${tag} payload:`, JSON.stringify(payload, null, 2));

  const missingOtpFields = ['otp_token', 'rzrotptoken', 'rzrotptokenTs', 'otp_token_enc'].filter(
    (f) => !payload[f] || String(payload[f]).trim() === ''
  );
  if (missingOtpFields.length > 0) {
    const msg = `Missing or empty OTP fields: ${missingOtpFields.join(', ')}. Please generate OTP first.`;
    console.error(`${tag} ERROR:`, msg);
    throw new Error(msg);
  }

  // Load saved Razer headers for this user
  let razerPayload;
  try {
    razerPayload = await RazerPayloadData.findOne({ userId });
  } catch (dbErr) {
    console.error(`${tag} ERROR: DB lookup for RazerPayloadData failed:`, dbErr.message);
    throw dbErr;
  }

  if (!razerPayload) {
    console.error(`${tag} ERROR: No RazerPayloadData found for userId ${userId}`);
    throw new Error(`No Razer session found for user ${userId}. Please log in again.`);
  }

  console.log(`${tag} RazerPayload loaded — razerid: ${razerPayload.xRazerRazerid}, fpid: ${razerPayload.xRazerFpid}`);
  console.log(`${tag} accessToken (first 20): ${String(razerPayload.xRazerAccessToken).slice(0, 20)}...`);
  console.log(`${tag} cookie (first 60): ${String(razerPayload.cookieHeader).slice(0, 60)}...`);

  console.log(`${tag} otp_token (cookie, first 20): ${String(payload.otp_token).slice(0, 20)}...`);
  console.log(`${tag} rawToken (body, 6-digit): ${payload.rawToken}`);

  const axiosInstance = await getAxiosForUser(userId);

  // Exact headers matching browser request
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'pragma': 'no-cache',
    'x-razer-accesstoken': razerPayload.xRazerAccessToken,
    'x-razer-fpid': razerPayload.xRazerFpid,
    'x-razer-language': 'en',
    'x-razer-razerid': razerPayload.xRazerRazerid,
    // Cookie: _rzrotptoken + _rzrotptokents + otpToken (URL encoded otp_token) — exactly as browser sends
    'cookie': `${razerPayload.cookieHeader}; _rzrotptoken=${payload.rzrotptoken}; _rzrotptokents=${payload.rzrotptokenTs}; otpToken=${encodeURIComponent(payload.otp_token)}`,
    'Referer': `https://gold.razer.com/global/en/gold/catalog/${payload.permalink}`,
  };

  // Body otpToken = otp_token_enc (different from cookie otpToken)
  const checkoutBody = {
    productId: payload.productId,
    regionId: payload.regionId,
    paymentChannelId: payload.paymentChannelId,
    emailIsRequired: true,
    permalink: payload.permalink,
    otpToken: payload.otp_token_enc,
    savePurchaseDetails: true,
    personalizedInfo: [],
    ...(payload.email ? { email: payload.email } : {}),
  };

  console.log(`${tag} Step 1 — POST checkout to Razer API`);
  console.log(`${tag} Request body:`, JSON.stringify(checkoutBody));

  let checkoutRes;
  try {
    checkoutRes = await axiosInstance.post('https://gold.razer.com/api/webshop/checkout/gold', checkoutBody, {
      headers,
      validateStatus: () => true,
    });
  } catch (fetchErr) {
    console.error(`${tag} ERROR: request to checkout endpoint failed (network/DNS):`, fetchErr.message);
    throw fetchErr;
  }

  console.log(`${tag} Checkout response status:`, checkoutRes.status);
  console.log(`${tag} Checkout response headers:`, checkoutRes.headers);
  if (checkoutRes.status < 200 || checkoutRes.status >= 300) {
    console.error(`${tag} ERROR: Checkout failed with status ${checkoutRes.status}. Body:`, checkoutRes.data);
    throw new Error(`Checkout failed with status ${checkoutRes.status}. Body: ${JSON.stringify(checkoutRes.data)}`);
  }

  // Checkout returns 200 with JSON body containing transactionNumber and paymentUrl
  const checkoutResponse = checkoutRes.data;
  console.log(`${tag} Checkout response body:`, checkoutResponse);

  const transactionId = checkoutResponse.transactionNumber;
  const paymentUrl = checkoutResponse.paymentUrl;

  if (!transactionId) {
    throw new Error(`Checkout response missing transactionNumber. Body: ${JSON.stringify(checkoutResponse)}`);
  }

  console.log(`${tag} transactionNumber:`, transactionId);
  console.log(`${tag} paymentUrl:`, paymentUrl);

  // Step 2: GET transaction result
  console.log(`${tag} Step 2 — GET transaction result for ID: ${transactionId}`);

  let resultRes;
  try {
    resultRes = await axiosInstance.get(`https://gold.razer.com/api/webshopv2/${transactionId}`, {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'x-razer-accesstoken': razerPayload.xRazerAccessToken,
        'x-razer-fpid': razerPayload.xRazerFpid,
        'x-razer-language': 'en',
        'x-razer-razerid': razerPayload.xRazerRazerid,
        'cookie': razerPayload.cookieHeader,
        'Referer': `https://gold.razer.com/global/en/gold/purchase/transaction/${transactionId}`,
      },
      validateStatus: () => true,
    });
  } catch (fetchErr) {
    console.error(`${tag} ERROR: request to transaction result endpoint failed (network/DNS):`, fetchErr.message);
    throw fetchErr;
  }

  console.log(`${tag} Transaction result status:`, resultRes.status);

  const resultData = resultRes.data;

  console.log(`${tag} Transaction result data:`, JSON.stringify(resultData, null, 2));

  if (resultRes.status < 200 || resultRes.status >= 300) {
    console.error(`${tag} ERROR: Transaction result returned non-2xx status ${resultRes.status}:`, resultData);
    throw new Error(`Transaction result HTTP ${resultRes.status}: ${JSON.stringify(resultData)}`);
  }

  // Check pins to determine final status
  const pins = resultData?.fullfillment?.pins;
  const hasPins = Array.isArray(pins) && pins.length > 0;

  if (!hasPins) {
    console.warn(`${tag} REVIEWING — transaction ${transactionId} has no pins yet`);
    return {
      transactionId,
      paymentUrl,
      checkout: checkoutResponse,
      result: resultData,
      transactionStatus: 'reviewing',
    };
  }

  console.log(`${tag} ── SUCCESS — pins received (count: ${pins.length}) ─────────────────────────────`);

  return {
    transactionId,
    paymentUrl,
    checkout: checkoutResponse,
    result: resultData,
    transactionStatus: 'success',
  };
}

async function processTransaction({ mode, jobId, userId, itemIndex, payload }) {
  if (mode === 'mongodb') {
    return processWithMongoMode({ jobId, userId, itemIndex, payload });
  }

  if (mode === 'razer') {
    return processWithRazerMode({ userId, itemIndex, payload });
  }

  return processWithFakeMode({ itemIndex, payload });
}

async function saveCompletedBatch({ jobId, userId, mode, total, counts, completedAt, transactions }) {
  console.log(`[saveCompletedBatch] Saving completed batch — jobId: ${jobId}, userId: ${userId}, total: ${total}, counts:`, counts);
  try {
    await CompletedBatch.findOneAndUpdate(
      { userId },
      { jobId, mode, total, counts, completedAt, transactions },
      { upsert: true, new: true }
    );
    console.log(`[saveCompletedBatch] Saved successfully for userId: ${userId}`);
  } catch (err) {
    console.error(`[saveCompletedBatch] ERROR: Failed to save completed batch for userId ${userId}:`, err.message);
    throw err;
  }
}

function startBatch({ userId, transactions, concurrency, mode }) {
  const selectedMode = ALLOWED_MODES.has(mode) ? mode : 'fake';

  return manager.createJob({
    userId,
    transactions,
    concurrency,
    mode: selectedMode,
    processFn: ({ jobId, userId: ownerId, itemIndex, payload }) =>
      processTransaction({ mode: selectedMode, jobId, userId: ownerId, itemIndex, payload }),
    onCompletedFn: saveCompletedBatch,
  });
}

function getBatch(jobId, userId) {
  return manager.getJob(jobId, userId);
}

function pauseBatch(jobId, userId) {
  return manager.pauseJob(jobId, userId);
}

function resumeBatch(jobId, userId) {
  return manager.resumeJob(jobId, userId);
}

function stopBatch(jobId, userId) {
  return manager.stopJob(jobId, userId);
}

module.exports = {
  MAX_CONCURRENCY,
  ALLOWED_MODES,
  startBatch,
  getBatch,
  pauseBatch,
  resumeBatch,
  stopBatch,
};
