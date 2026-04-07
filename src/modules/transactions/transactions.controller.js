const transactionsService = require('./transactions.service');
const speakeasy = require('speakeasy');
const RazerPayloadData = require('../auth/razerPayloadData.model');

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
    console.log('Generated OTP token:', token);

    // Send to Razer API with exact headers from browser
    const response = await fetch('https://razer-otptoken-service.razer.com/totp/post', {
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
      body: JSON.stringify({
        client_id: process.env.LAST_CLIENT_ID_PASSED || '63c74d17e027dc11f642146bfeeaee09c3ce23d8',
        token: token,
      }),
    });


    // Extract _rzrotptoken from set-cookie header
    const setCookieHeader = response.headers.get('set-cookie') || '';
    const otpTokenMatch = setCookieHeader.match(/_rzrotptoken=([^;]+)/);
    const otpToken = otpTokenMatch ? otpTokenMatch[1] : null;


    return res.json({
      success: true,
      message: 'OTP generated successfully',
      data: { otpToken },
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

    const requiredFields = ['productId', 'regionId', 'paymentChannelId', 'permalink', 'otpToken'];
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

module.exports = {
  generateOTP,
  startBatch,
  getBatchStatus,
  pauseBatch,
  resumeBatch,
  stopBatch,
};
