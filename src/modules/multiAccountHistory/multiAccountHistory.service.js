const RazerPayloadData = require('../auth/razerPayloadData.model');
const { getAxiosForUser } = require('../../utils/proxyAxios');

const HISTORY_BATCH_SIZE = 10;
const PIN_BATCH_SIZE = 5;
const HISTORY_URL = 'https://gold.razer.com/api/transactions/history';
const TXN_DETAIL_URL = (txn) => `https://gold.razer.com/api/webshopv2/${txn}`;

function buildHeaders(payload) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'x-razer-accesstoken': payload.xRazerAccessToken || '',
    'x-razer-fpid': payload.xRazerFpid || '',
    'x-razer-razerid': payload.xRazerRazerid || '',
    cookie: payload.cookieHeader || '',
    Referer: 'https://gold.razer.com/global/en/transactions',
  };
}

function parseBoundary(value, endOfDay) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}

function inDateRange(txnDate, from, to) {
  if (!txnDate) return false;
  const t = new Date(txnDate);
  if (Number.isNaN(t.getTime())) return false;
  if (from && t < from) return false;
  if (to && t > to) return false;
  return true;
}

function mapTransaction(raw) {
  // Razer's /api/transactions/history returns these field names directly.
  return {
    txnNum: raw?.txnNum ?? raw?.transactionNumber ?? raw?.transactionId ?? null,
    txnDate: raw?.txnDate ?? raw?.transactionDate ?? raw?.createdAt ?? null,
    description: raw?.description ?? raw?.productName ?? '',
    isReceiptAvailable: Boolean(raw?.isReceiptAvailable),
  };
}

async function fetchHistoryForOneAccount({ email, fromDate, toDate }) {
  if (!email) {
    return { email: email || null, success: false, error: 'email is required', transactions: [] };
  }

  const payload = await RazerPayloadData.findOne({ email }).sort({ capturedAt: -1 });
  if (!payload || !payload.xRazerAccessToken) {
    return { email, success: false, error: 'Account not loaded — run /load first', transactions: [] };
  }

  const from = parseBoundary(fromDate, false);
  const to = parseBoundary(toDate, true);

  const axiosInstance = await getAxiosForUser(payload.userId);

  let res;
  try {
    res = await axiosInstance.get(HISTORY_URL, {
      headers: buildHeaders(payload),
      validateStatus: () => true,
    });
  } catch (err) {
    return { email, success: false, error: `Network error: ${err.message}`, transactions: [] };
  }

  if (res.status !== 200) {
    const body = typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data || {}).slice(0, 200);
    return { email, success: false, error: `Razer history API ${res.status}: ${body}`, transactions: [] };
  }

  const list = Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.Transactions)
      ? res.data.Transactions
      : Array.isArray(res.data?.transactions)
        ? res.data.transactions
        : Array.isArray(res.data?.data)
          ? res.data.data
          : [];

  const transactions = list
    .map(mapTransaction)
    .filter((t) => t.txnNum && inDateRange(t.txnDate, from, to));

  return { email, success: true, transactions };
}

async function fetchPinsForOneAccount({ email, transactionNumbers }) {
  if (!email) {
    return { email: email || null, success: false, error: 'email is required', pins: [] };
  }
  if (!Array.isArray(transactionNumbers) || transactionNumbers.length === 0) {
    return { email, success: false, error: 'transactionNumbers must be a non-empty array', pins: [] };
  }

  const payload = await RazerPayloadData.findOne({ email }).sort({ capturedAt: -1 });
  if (!payload || !payload.xRazerAccessToken) {
    return { email, success: false, error: 'Account not loaded — run /load first', pins: [] };
  }

  const axiosInstance = await getAxiosForUser(payload.userId);
  const headers = buildHeaders(payload);
  const pins = [];

  for (let i = 0; i < transactionNumbers.length; i += PIN_BATCH_SIZE) {
    const batch = transactionNumbers.slice(i, i + PIN_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (txnNum) => {
        const res = await axiosInstance.get(TXN_DETAIL_URL(txnNum), {
          headers,
          validateStatus: () => true,
        });
        if (res.status !== 200) {
          throw new Error(`status ${res.status}`);
        }
        const data = res.data || {};
        const productName = data.productName || data.description || null;
        const fulfillmentPins = Array.isArray(data.fullfillment?.pins) ? data.fullfillment.pins : [];
        if (fulfillmentPins.length === 0) {
          return [{ productName, pin: null, txnNum }];
        }
        return fulfillmentPins.map((p) => ({
          productName,
          pin: p?.pinCode1 ?? null,
          txnNum,
        }));
      })
    );
    batchResults.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        pins.push(...r.value);
      } else {
        pins.push({
          productName: null,
          pin: null,
          txnNum: batch[idx],
          error: r.reason?.message || 'Unknown error',
        });
      }
    });
  }

  return { email, success: true, pins };
}

async function runInBatches(items, fn, batchSize) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fn));
    settled.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({
          email: batch[idx]?.email || null,
          success: false,
          error: r.reason?.message || 'Unknown error',
          transactions: [],
          pins: [],
        });
      }
    });
  }
  return results;
}

async function fetchTransactionsHistoryForAccounts(accounts) {
  return runInBatches(accounts, fetchHistoryForOneAccount, HISTORY_BATCH_SIZE);
}

async function fetchPinHistoryForAccounts(accounts) {
  return runInBatches(accounts, fetchPinsForOneAccount, PIN_BATCH_SIZE);
}

module.exports = {
  fetchTransactionsHistoryForAccounts,
  fetchPinHistoryForAccounts,
};
