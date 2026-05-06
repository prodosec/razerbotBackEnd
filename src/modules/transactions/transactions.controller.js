const transactionsService = require('./transactions.service');
const speakeasy = require('speakeasy');
const RazerPayloadData = require('../auth/razerPayloadData.model');
const CompletedBatch = require('./completedBatch.model');
const GoldMultipleAccountBatch = require('./goldMultipleAccountBatch.model');
const { getAxiosForUser, PROXY_LIST } = require('../../utils/proxyAxios');

function normalizeProxyPool(rawPool) {
  if (rawPool === undefined || rawPool === null) {
    return { ok: true, pool: null };
  }
  if (!Array.isArray(rawPool)) {
    return { ok: false, message: 'proxyPool must be an array' };
  }
  if (rawPool.length === 0) {
    return { ok: true, pool: null };
  }

  const validIds = new Set(PROXY_LIST.filter((p) => !p.disabled).map((p) => p.id));
  const seen = new Set();
  const pool = [];

  for (let i = 0; i < rawPool.length; i += 1) {
    const entry = rawPool[i];
    if (entry === null || entry === undefined) {
      const key = 'null';
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(null);
      continue;
    }
    const numeric = Number(entry);
    if (!Number.isInteger(numeric)) {
      return { ok: false, message: `proxyPool[${i}] must be a proxy id (integer) or null` };
    }
    if (!validIds.has(numeric)) {
      return { ok: false, message: `proxyPool[${i}] references unknown or disabled proxy id ${numeric}` };
    }
    const key = `id:${numeric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(numeric);
  }

  return { ok: true, pool };
}

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

async function generateOTP(req, res, next) {
  try {
    const secret = req.body.secret;
    if (typeof secret !== 'string' || secret.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'secret must be a non-empty string',
      });
    }

    // Get saved Razer payload data for this user
    const razerPayload = await RazerPayloadData.findOne({ userId: req.userId });
    if (!razerPayload || !razerPayload.xRazerAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Razer access token not found. Please log in with Razer first.',
      });
    }

    // Generate OTP
    const token = speakeasy.totp({
      secret: secret,
      encoding: 'base32',
    });

    const clientId = process.env.LAST_CLIENT_ID_PASSED || '63c74d17e027dc11f642146bfeeaee09c3ce23d8';

    const axiosInstance = await getAxiosForUser(req.userId);

    // Send to Razer API with exact headers from browser
    let response;
    try {
      response = await axiosInstance.post('https://razer-otptoken-service.razer.com/totp/post', { client_id: clientId, token }, {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          'access-control-allow-origin': '*',
          'authorization': `Bearer ${razerPayload.xRazerAccessToken}`,
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'pragma': 'no-cache',
          'cookie': razerPayload.cookieHeader,
          'Referer': 'https://razerid.razer.com/',
        },
        validateStatus: () => true,
      });
    } catch (fetchErr) {
      console.error('[generateOTP] ERROR: request to OTP endpoint failed (network/DNS):', fetchErr.message);
      throw fetchErr;
    }

    if (response.status < 200 || response.status >= 300) {
      console.error(`[generateOTP] ERROR: OTP endpoint returned ${response.status}:`, response.data);
      return res.status(400).json({
        success: false,
        message: `Razer OTP service rejected the token (status ${response.status}): ${JSON.stringify(response.data)}`,
      });
    }

    // Extract _rzrotptoken and _rzrotptokents from set-cookie
    const rawSetCookie = response.headers['set-cookie'];
    const setCookieHeader = Array.isArray(rawSetCookie) ? rawSetCookie.join('; ') : (rawSetCookie || '');

    const rzrotptokenMatch = setCookieHeader.match(/_rzrotptoken=([^;]+)/);
    const rzrotptoken = rzrotptokenMatch ? rzrotptokenMatch[1] : null;

    const rzrotptokenTsMatch = setCookieHeader.match(/_rzrotptokents=([^;]+)/);
    const rzrotptokenTs = rzrotptokenTsMatch ? rzrotptokenTsMatch[1] : null;

    if (!rzrotptoken) {
      console.error('[generateOTP] ERROR: _rzrotptoken not found in set-cookie. Full set-cookie:', setCookieHeader);
      return res.status(400).json({
        success: false,
        message: 'Razer OTP service did not return _rzrotptoken cookie.',
      });
    }

    // Parse response body
    const responseBody = response.data || {};
    const otp_token_enc = responseBody.otp_token_enc || null;
    const otp_token = responseBody.otp_token || null;
    const create_ts = responseBody.create_ts || null;

    console.log('[generateOTP] rzrotptoken (first 20):', rzrotptoken.slice(0, 20) + '...');
    console.log('[generateOTP] rzrotptokenTs:', rzrotptokenTs);
    console.log('[generateOTP] otp_token_enc (first 20):', otp_token_enc ? otp_token_enc.slice(0, 20) + '...' : 'NOT FOUND');
    console.log('[generateOTP] otp_token (first 20):', otp_token ? otp_token.slice(0, 20) + '...' : 'NOT FOUND');
    return res.json({
      success: true,
      message: 'OTP generated successfully',
      data: { rzrotptoken, rzrotptokenTs, otp_token_enc, otp_token, create_ts },
    });
  } catch (err) {
    next(err);
  }
}


async function startBatch(req, res, next) {
  try {
    const { transaction, count, concurrency, mode } = req.body || {};

    if (!transaction || typeof transaction !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'transaction must be a non-empty object',
      });
    }

    const requiredFields = ['productId', 'regionId', 'paymentChannelId', 'permalink', 'rzrotptoken', 'rzrotptokenTs', 'otp_token_enc', 'otp_token'];
    const missingFields = requiredFields.filter((f) => transaction[f] === undefined || transaction[f] === null || transaction[f] === '');
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required transaction fields: ${missingFields.join(', ')}`,
      });
    }

    const parsedCount = Number(count);
    if (!Number.isInteger(parsedCount) || parsedCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'count must be a positive integer',
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

    // Expand single transaction template into array of count items
    const transactions = Array.from({ length: parsedCount }, () => ({ ...transaction }));

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

const MAX_MULTI_ACCOUNTS = 5;
const PER_ACCOUNT_CONCURRENCY = 8;

async function startMultiBatch(req, res, next) {
  try {
    const { transactions, mode } = req.body || {};

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transactions must be a non-empty array',
      });
    }

    if (transactions.length > MAX_MULTI_ACCOUNTS) {
      return res.status(400).json({
        success: false,
        message: `A maximum of ${MAX_MULTI_ACCOUNTS} accounts is allowed per multi-account batch`,
      });
    }

    const requiredFields = ['email', 'productId', 'regionId', 'paymentChannelId', 'permalink', 'rzrotptoken', 'rzrotptokenTs', 'otp_token_enc', 'otp_token'];

    const seenEmails = new Set();
    const accounts = [];

    for (let i = 0; i < transactions.length; i += 1) {
      const tx = transactions[i];
      if (!tx || typeof tx !== 'object') {
        return res.status(400).json({
          success: false,
          message: `transactions[${i}] must be an object`,
        });
      }

      const missing = requiredFields.filter((f) => tx[f] === undefined || tx[f] === null || tx[f] === '');
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          message: `transactions[${i}] is missing required fields: ${missing.join(', ')}`,
        });
      }

      const email = String(tx.email).trim().toLowerCase();
      if (seenEmails.has(email)) {
        return res.status(400).json({
          success: false,
          message: `Duplicate email in transactions: ${email}`,
        });
      }
      seenEmails.add(email);

      const parsedCount = Number(tx.count);
      if (!Number.isInteger(parsedCount) || parsedCount < 1) {
        return res.status(400).json({
          success: false,
          message: `transactions[${i}].count must be a positive integer`,
        });
      }

      const { count, ...template } = tx;
      const expanded = Array.from({ length: parsedCount }, () => ({ ...template }));

      accounts.push({ email, transactions: expanded });
    }

    const normalizedMode = normalizeMode(mode);
    if (!transactionsService.ALLOWED_MODES.has(normalizedMode)) {
      return res.status(400).json({
        success: false,
        message: `mode must be one of: ${Array.from(transactionsService.ALLOWED_MODES).join(', ')}`,
      });
    }

    // Build the proxy rotation cycle server-side. Up to two accounts run in parallel:
    // slot 0 on the server IP (null), slot 1 on the first proxy. If no proxies are
    // configured, only one slot exists and accounts run one-at-a-time on the server IP.
    // Each account uses ONE IP for its full run; when it finishes the next account takes
    // the next IP in the cycle (wrapping around if accounts > IPs).
    // Cycle order: server IP first (null), then enabled proxies sorted by id.
    const enabledProxyIds = PROXY_LIST
      .filter((p) => !p.disabled)
      .sort((a, b) => a.id - b.id)
      .map((p) => p.id);
    const proxyPool = [null, ...enabledProxyIds];

    const data = transactionsService.startMultiBatch({
      userId: req.userId,
      accounts,
      mode: normalizedMode,
      proxyPool,
    });

    return res.status(202).json({
      success: true,
      message: 'Multi-account batch started successfully',
      data: {
        ...data,
        perAccountConcurrency: PER_ACCOUNT_CONCURRENCY,
        maxAccounts: MAX_MULTI_ACCOUNTS,
      },
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

function handleAccountControlResult(res, data, successMessage) {
  if (!data) {
    return res.status(404).json({
      success: false,
      message: 'Multi-account batch job not found',
    });
  }
  if (data.error === 'ACCOUNT_NOT_IN_BATCH') {
    return res.status(400).json({
      success: false,
      message: 'Account is not part of this batch',
    });
  }
  if (data.error === 'ACCOUNT_ALREADY_STOPPED') {
    return res.status(400).json({
      success: false,
      message: 'Account is already stopped; resume is not allowed',
    });
  }
  return res.json({
    success: true,
    message: successMessage,
    data,
  });
}

function readAccountEmail(req) {
  const raw = req.params && req.params.email;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  return decodeURIComponent(raw).trim().toLowerCase();
}

async function pauseAccountInBatch(req, res, next) {
  try {
    const email = readAccountEmail(req);
    if (!email) {
      return res.status(400).json({ success: false, message: 'email path param is required' });
    }
    const data = transactionsService.pauseAccount(req.params.jobId, req.userId, email);
    return handleAccountControlResult(res, data, `Account ${email} paused`);
  } catch (err) {
    next(err);
  }
}

async function resumeAccountInBatch(req, res, next) {
  try {
    const email = readAccountEmail(req);
    if (!email) {
      return res.status(400).json({ success: false, message: 'email path param is required' });
    }
    const data = transactionsService.resumeAccount(req.params.jobId, req.userId, email);
    return handleAccountControlResult(res, data, `Account ${email} resumed`);
  } catch (err) {
    next(err);
  }
}

async function stopAccountInBatch(req, res, next) {
  try {
    const email = readAccountEmail(req);
    if (!email) {
      return res.status(400).json({ success: false, message: 'email path param is required' });
    }
    const data = transactionsService.stopAccount(req.params.jobId, req.userId, email);
    return handleAccountControlResult(res, data, `Account ${email} stopped`);
  } catch (err) {
    next(err);
  }
}

async function getTransactionHistory(req, res, next) {
  try {
    const razerPayload = await RazerPayloadData.findOne({ userId: req.userId });
    if (!razerPayload || !razerPayload.xRazerAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Razer session not found. Please log in with Razer first.',
      });
    }

    const response = await fetch('https://gold.razer.com/api/transactions/history', {
      method: 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'x-razer-accesstoken': razerPayload.xRazerAccessToken,
        'x-razer-fpid': razerPayload.xRazerFpid,
        'x-razer-razerid': razerPayload.xRazerRazerid,
        'cookie': razerPayload.cookieHeader,
        'Referer': 'https://gold.razer.com/global/en/transactions',
      },
    });

    const data = await response.json();

    return res.json({
      success: true,
      message: 'Transaction history fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function getPinHistory(req, res, next) {
  try {
    const { transactionNumbers } = req.body || {};

    if (!Array.isArray(transactionNumbers) || transactionNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transactionNumbers must be a non-empty array',
      });
    }

    const razerPayload = await RazerPayloadData.findOne({ userId: req.userId });
    if (!razerPayload || !razerPayload.xRazerAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Razer session not found. Please log in with Razer first.',
      });
    }

    const limit = 5;

    const results = [];

    for (let i = 0; i < transactionNumbers.length; i += limit) {
      const batch = transactionNumbers.slice(i, i + limit);

      const batchResults = await Promise.all(
        batch.map(async (txNumber) => {
          try {
            const response = await fetch(`https://gold.razer.com/api/webshopv2/${txNumber}`, {
              method: 'GET',
              headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'x-razer-accesstoken': razerPayload.xRazerAccessToken,
                'x-razer-fpid': razerPayload.xRazerFpid,
                'x-razer-razerid': razerPayload.xRazerRazerid,
                'cookie': razerPayload.cookieHeader,
                'Referer': `https://gold.razer.com/globalzh/en/transaction/purchase/${txNumber}`,
              },
            });

            const data = await response.json();
            const pins = data.fullfillment?.pins ?? [];
            if (pins.length === 0) {
              return [{ productId: data.productId ?? null, productName: data.productName ?? null, pin: null }];
            }
            return pins.map((p) => ({
              productId: data.productId ?? null,
              productName: data.productName ?? null,
              pin: p.pinCode1 ?? null,
            }));
          } catch (err) {
            return { transactionNumber: txNumber, success: false, error: err.message };
          }
        })
      );

      results.push(...batchResults.flat());
    }

    return res.json({
      success: true,
      message: 'Pin history fetched successfully',
      data: results,
    });
  } catch (err) {
    next(err);
  }
}

async function getProgress(req, res, next) {
  try {
    const data = await CompletedBatch.findOne({ userId: req.userId });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'No progress found. Start a batch first.',
      });
    }

    return res.json({
      success: true,
      message: 'Progress fetched successfully',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteProgress(req, res, next) {
  try {
    const deleted = await CompletedBatch.findOneAndDelete({ userId: req.userId });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'No completed batch found to delete.',
      });
    }

    return res.json({
      success: true,
      message: 'Completed batch deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
}

async function getMultiProgress(req, res, next) {
  try {
    const data = await GoldMultipleAccountBatch.findOne({ userId: req.userId });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'No multi-account batch found. Start a multi-account batch first.',
      });
    }

    const { transactions, ...rest } = data.toObject();
    const summaryPerAccount = {};
    for (const email of rest.accounts || []) {
      summaryPerAccount[email] = { total: 0, success: 0, reviewing: 0, failed: 0 };
    }
    for (const tx of transactions || []) {
      const email = tx.accountEmail;
      if (!email || !summaryPerAccount[email]) continue;
      summaryPerAccount[email].total += 1;
      if (tx.status === 'success') summaryPerAccount[email].success += 1;
      else if (tx.status === 'reviewing') summaryPerAccount[email].reviewing += 1;
      else if (tx.status === 'failed') summaryPerAccount[email].failed += 1;
    }

    return res.json({
      success: true,
      message: 'Multi-account batch fetched successfully',
      data: { ...rest, summaryPerAccount, transactions },
    });
  } catch (err) {
    next(err);
  }
}

async function deleteMultiProgress(req, res, next) {
  try {
    const deleted = await GoldMultipleAccountBatch.findOneAndDelete({ userId: req.userId });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'No multi-account batch found to delete.',
      });
    }

    return res.json({
      success: true,
      message: 'Multi-account batch deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateOTP,
  getTransactionHistory,
  getPinHistory,
  getProgress,
  deleteProgress,
  getMultiProgress,
  deleteMultiProgress,
  startBatch,
  startMultiBatch,
  getBatchStatus,
  pauseBatch,
  resumeBatch,
  stopBatch,
  pauseAccountInBatch,
  resumeAccountInBatch,
  stopAccountInBatch,
};
