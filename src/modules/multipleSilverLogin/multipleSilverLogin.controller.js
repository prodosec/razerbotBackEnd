const { loadAccounts } = require('./multipleSilverLogin.service');

const MAX_ACCOUNTS = 200;

function getAutoBatchSize(count) {
  if (count <= 30)  return 10;
  if (count <= 60)  return 15;
  if (count <= 100) return 20;
  if (count <= 200) return 25;
  return 25;
}

function validateAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0)
    return 'accounts array is required';
  if (accounts.length > MAX_ACCOUNTS)
    return `Maximum ${MAX_ACCOUNTS} accounts allowed per request`;
  const invalid = accounts.filter(a => !a.email || !a.password);
  if (invalid.length > 0)
    return `${invalid.length} accounts missing email or password`;
  return null;
}

async function bulkLoad(req, res, next) {
  try {
    const { accounts, batchSize } = req.body;

    const error = validateAccounts(accounts);
    if (error) return res.status(400).json({ success: false, message: error });

    const resolvedBatchSize = batchSize || getAutoBatchSize(accounts.length);

    const result = await loadAccounts(accounts, { batchSize: resolvedBatchSize });

    res.json({
      success: true,
      total: result.total,
      loaded: result.success,
      failed: result.failed,
      elapsed: result.elapsed,
      batchSize: resolvedBatchSize,
      results: result.results,
    });
  } catch (err) {
    next(err);
  }
}

// SSE version — streams live progress to frontend
async function bulkLoadStream(req, res, next) {
  try {
    const { accounts, batchSize } = req.body;

    const error = validateAccounts(accounts);
    if (error) return res.status(400).json({ success: false, message: error });

    const resolvedBatchSize = batchSize || getAutoBatchSize(accounts.length);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('start', { total: accounts.length, batchSize: resolvedBatchSize });

    const result = await loadAccounts(accounts, {
      batchSize: resolvedBatchSize,
      onProgress: (account, done, total) => {
        send('progress', { done, total, account });
      },
    });

    send('done', {
      total: result.total,
      loaded: result.success,
      failed: result.failed,
      elapsed: result.elapsed,
    });

    res.end();
  } catch (err) {
    next(err);
  }
}

module.exports = { bulkLoad, bulkLoadStream };
