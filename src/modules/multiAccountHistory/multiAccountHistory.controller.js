const {
  fetchTransactionsHistoryForAccounts,
  fetchPinHistoryForAccounts,
} = require('./multiAccountHistory.service');

const MAX_ACCOUNTS = 200;

function validateAccountsArray(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return 'accounts must be a non-empty array';
  }
  if (accounts.length > MAX_ACCOUNTS) {
    return `Maximum ${MAX_ACCOUNTS} accounts allowed per request`;
  }
  return null;
}

async function transactionsHistory(req, res, next) {
  try {
    const { accounts } = req.body || {};

    const error = validateAccountsArray(accounts);
    if (error) return res.status(400).json({ success: false, message: error });

    const normalized = accounts.map((a) => ({
      email: typeof a?.email === 'string' ? a.email.trim().toLowerCase() : '',
      fromDate: a?.fromDate || null,
      toDate: a?.toDate || null,
    }));

    const results = await fetchTransactionsHistoryForAccounts(normalized);

    return res.json({ results });
  } catch (err) {
    next(err);
  }
}

async function pinHistory(req, res, next) {
  try {
    const { accounts } = req.body || {};

    const error = validateAccountsArray(accounts);
    if (error) return res.status(400).json({ success: false, message: error });

    const normalized = accounts.map((a) => ({
      email: typeof a?.email === 'string' ? a.email.trim().toLowerCase() : '',
      transactionNumbers: Array.isArray(a?.transactionNumbers) ? a.transactionNumbers : [],
    }));

    const results = await fetchPinHistoryForAccounts(normalized);

    return res.json({ results });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  transactionsHistory,
  pinHistory,
};
