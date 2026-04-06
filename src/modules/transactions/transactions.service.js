const TransactionBatchTest = require('./transactionTest.model');
const { TransactionsManager, MAX_CONCURRENCY, ALLOWED_MODES } = require('./transactions.manager');

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

async function processTransaction({ mode, jobId, userId, itemIndex, payload }) {
  if (mode === 'mongodb') {
    return processWithMongoMode({ jobId, userId, itemIndex, payload });
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
