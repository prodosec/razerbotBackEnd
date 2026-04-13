const transactionsService = require('./transactions.service');
const speakeasy = require('speakeasy');
const RazerPayloadData = require('../auth/razerPayloadData.model');
const CompletedBatch = require('./completedBatch.model');

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

    // Send to Razer API with exact headers from browser
    let response;
    try {
      response = await fetch('https://razer-otptoken-service.razer.com/totp/post', {
        method: 'POST',
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
        body: JSON.stringify({ client_id: clientId,  token }),
      });
    } catch (fetchErr) {
      console.error('[generateOTP] ERROR: fetch to OTP endpoint failed (network/DNS):', fetchErr.message);
      throw fetchErr;
    }


    // Read body for both debugging and extracting body otpToken
    const responseBodyText = await response.text().catch(() => '(could not read body)');

    if (!response.ok) {
      console.error(`[generateOTP] ERROR: OTP endpoint returned ${response.status}:`, responseBodyText);
      return res.status(400).json({
        success: false,
        message: `Razer OTP service rejected the token (status ${response.status}): ${responseBodyText}`,
      });
    }

    // Extract _rzrotptoken and _rzrotptokents from set-cookie
    const setCookieHeader = response.headers.get('set-cookie') || '';

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
    let otp_token_enc = null;
    let otp_token = null;
    let create_ts = null;
    try {
      const body = JSON.parse(responseBodyText);
      otp_token_enc = body.otp_token_enc || null;
      otp_token = body.otp_token || null;
      create_ts = body.create_ts || null;
    } catch {
      console.warn('[generateOTP] Could not parse response body as JSON');
    }

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

module.exports = {
  generateOTP,
  getTransactionHistory,
  getProgress,
  deleteProgress,
  startBatch,
  getBatchStatus,
  pauseBatch,
  resumeBatch,
  stopBatch,
};
