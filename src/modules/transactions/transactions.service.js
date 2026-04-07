const TransactionBatchTest = require('./transactionTest.model');
const { TransactionsManager, MAX_CONCURRENCY, ALLOWED_MODES } = require('./transactions.manager');
const RazerPayloadData = require('../auth/razerPayloadData.model');

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
  // Load saved Razer headers for this user
  const razerPayload = await RazerPayloadData.findOne({ userId });
  if (!razerPayload) {
    throw new Error(`No Razer session found for user ${userId}. Please log in again.`);
  }

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
    'cookie': razerPayload.cookieHeader,
    'Referer': `https://gold.razer.com/global/en/gold/catalog/${payload.permalink}`,
  };

  // Step 1: POST checkout — stop redirect, grab location header
  const checkoutRes = await fetch('https://gold.razer.com/api/webshop/checkout/gold', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'manual',
  });

  console.log(`[item ${itemIndex}] Checkout status:`, checkoutRes.status);

  const location = checkoutRes.headers.get('location');
  if (!location) {
    throw new Error(`Checkout did not return a redirect location. Status: ${checkoutRes.status}`);
  }

  console.log(`[item ${itemIndex}] Redirect location:`, location);

  // Extract transaction ID from the end of the location URL
  const transactionId = location.split('/').pop();
  if (!transactionId) {
    throw new Error(`Could not extract transaction ID from location: ${location}`);
  }

  console.log(`[item ${itemIndex}] Transaction ID:`, transactionId);

  // Step 2: GET transaction result
  const resultRes = await fetch(`https://gold.razer.com/api/webshopv2/${transactionId}`, {
    method: 'GET',
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
  });

  const resultData = await resultRes.json();
  console.log(`[item ${itemIndex}] Transaction result:`, resultData);

  return {
    transactionId,
    result: resultData,
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

function startBatch({ userId, transactions, concurrency, mode }) {
  const selectedMode = ALLOWED_MODES.has(mode) ? mode : 'fake';

  return manager.createJob({
    userId,
    transactions,
    concurrency,
    mode: selectedMode,
    processFn: ({ jobId, userId: ownerId, itemIndex, payload }) =>
      processTransaction({ mode: selectedMode, jobId, userId: ownerId, itemIndex, payload }),
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
