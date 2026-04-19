const { loadAccounts, authenticateAccounts, transactAccounts, getProductBalance, getSilverBalances } = require('./multipleSilverLogin.service');
const RazerPayloadData = require('../auth/razerPayloadData.model');
const logStore = require('../../utils/logStore');

async function debugPayload(req, res) {
  const doc = await RazerPayloadData.findOne({ email: req.params.email });
  if (!doc) return res.json({ found: false });
  res.json({
    found: true,
    email: doc.email,
    hasAccessToken: !!doc.xRazerAccessToken,
    xRazerAccessToken: doc.xRazerAccessToken?.substring(0, 20) + '...',
    hasCookieHeader: !!doc.cookieHeader,
    hasRazerIdAuthToken: !!doc.razerIdAuthToken,
    capturedAt: doc.capturedAt,
  });
}

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

async function bulkAuthenticate(req, res, next) {
  try {
    const { accounts } = req.body;
    if (!Array.isArray(accounts) || accounts.length === 0)
      return res.status(400).json({ success: false, message: 'accounts array is required' });

    const result = await authenticateAccounts(accounts);

    res.json({
      success: true,
      total: result.total,
      authenticated: result.success,
      failed: result.failed,
      elapsed: result.elapsed,
      results: result.results,
    });
  } catch (err) {
    next(err);
  }
}

async function bulkTransact(req, res, next) {
  try {
    const { accounts, product, batchSize } = req.body;

    if (!Array.isArray(accounts) || accounts.length === 0)
      return res.status(400).json({ success: false, message: 'accounts array is required' });

    const invalid = accounts.filter(a => !a.email || !a.authenticatorCode);
    if (invalid.length > 0)
      return res.status(400).json({ success: false, message: `${invalid.length} accounts missing email or authenticatorCode` });

    const requiredProduct = ['productId', 'regionId', 'paymentChannelId', 'permalink'];
    const missingProduct = requiredProduct.filter(f => !product?.[f]);
    if (missingProduct.length > 0)
      return res.status(400).json({ success: false, message: `product missing: ${missingProduct.join(', ')}` });

    const result = await transactAccounts(accounts, product, { batchSize: batchSize || 10 });

    res.json({
      success: true,
      total: result.total,
      succeeded: result.success,
      failed: result.failed,
      elapsed: result.elapsed,
      results: result.results,
    });
  } catch (err) {
    next(err);
  }
}


async function productBalance(req, res, next) {
  try {
    const { permalink } = req.params;
    if (!permalink)
      return res.status(400).json({ success: false, message: 'permalink is required' });

    const razerPayload = await RazerPayloadData.findOne({ userId: req.userId });
    if (!razerPayload || !razerPayload.xRazerAccessToken)
      return res.status(400).json({ success: false, message: 'No Razer session found. Please log in first.' });

    const data = await getProductBalance({ permalink, razerPayload });

    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
}

async function bulkSilverBalance(req, res, next) {
  try {
    const { accounts, emails } = req.body;
    const emailList = accounts?.length
      ? accounts.map(a => a.email)
      : (emails || []);
    const result = await getSilverBalances(emailList);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getLogs(req, res) {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ logs: logStore.getLogs(limit) });
}

async function clearLogs(req, res) {
  logStore.clear();
  res.json({ success: true, message: 'Logs cleared' });
}

module.exports = { bulkLoad, bulkLoadStream, bulkAuthenticate, debugPayload, bulkTransact, productBalance, bulkSilverBalance, getLogs, clearLogs };
