const transactionsService = require('./transactions.service');

function normalizeMode(mode) {
  if (typeof mode !== 'string') {
    return 'fake';
  }

  return mode.trim().toLowerCase();
}

function normalizeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

async function startBatch(req, res, next) {
  try {
    const { transactions, concurrency, mode } = req.body || {};

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transactions must be a non-empty array',
      });
    }

    const normalizedConcurrency = normalizeConcurrency(concurrency);
    if (!normalizedConcurrency || normalizedConcurrency < 1 || normalizedConcurrency > transactionsService.MAX_CONCURRENCY) {
      return res.status(400).json({
        success: false,
        message: `concurrency must be an integer between 1 and ${transactionsService.MAX_CONCURRENCY}`,
      });
    }

    const normalizedMode = normalizeMode(mode);
    if (!transactionsService.ALLOWED_MODES.has(normalizedMode)) {
      return res.status(400).json({
        success: false,
        message: `mode must be one of: ${Array.from(transactionsService.ALLOWED_MODES).join(', ')}`,
      });
    }

    const data = transactionsService.startBatch({
      userId: req.userId,
      transactions,
      concurrency: normalizedConcurrency,
      mode: normalizedMode,
    });

    return res.status(202).json({
      success: true,
      message: 'Batch started successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getBatchStatus(req, res, next) {
  try {
    const data = transactionsService.getBatch(req.params.jobId, req.userId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Batch job not found',
      });
    }

    return res.json({
      success: true,
      message: 'Batch status fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function pauseBatch(req, res, next) {
  try {
    const data = transactionsService.pauseBatch(req.params.jobId, req.userId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Batch job not found',
      });
    }

    return res.json({
      success: true,
      message: 'Batch pause requested successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function resumeBatch(req, res, next) {
  try {
    const data = transactionsService.resumeBatch(req.params.jobId, req.userId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Batch job not found',
      });
    }

    return res.json({
      success: true,
      message: 'Batch resume requested successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function stopBatch(req, res, next) {
  try {
    const data = transactionsService.stopBatch(req.params.jobId, req.userId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Batch job not found',
      });
    }

    return res.json({
      success: true,
      message: 'Batch stop requested successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  startBatch,
  getBatchStatus,
  pauseBatch,
  resumeBatch,
  stopBatch,
};
