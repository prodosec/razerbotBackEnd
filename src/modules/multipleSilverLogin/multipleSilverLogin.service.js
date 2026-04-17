const { loginOneAccount } = require('../../utils/razerLogin');
const { saveRazerPayloadData, registerRazerBrowserLogin } = require('../auth/auth.service');

async function loadAccounts(accounts, { batchSize = 20, onProgress } = {}) {
  const results = [];
  const start = Date.now();

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(account => loginAndSave(account))
    );

    batchResults.forEach((r, idx) => {
      const result = r.status === 'fulfilled'
        ? r.value
        : { email: batch[idx].email, success: false, error: r.reason?.message || 'Unknown error' };
      results.push(result);
      if (onProgress) onProgress(result, results.length, accounts.length);
    });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const successCount = results.filter(r => r.success).length;

  return {
    total: accounts.length,
    success: successCount,
    failed: accounts.length - successCount,
    elapsed: `${elapsed}s`,
    results,
  };
}

async function loginAndSave(account) {
  const { email, password, serviceCode = '0060' } = account;

  const loginResult = await loginOneAccount({ email, password, serviceCode });

  if (!loginResult.success) {
    return { email, success: false, error: loginResult.error };
  }

  // Register or update user in DB
  const authResult = await registerRazerBrowserLogin({ name: email, email, password });

  // Save tokens to DB
  await saveRazerPayloadData({
    userId: authResult.user.id,
    email,
    username: email,
    payload: {
      cookieHeader: loginResult.cookieHeader,
      cookies: [],
      xRazerAccessToken: loginResult.xRazerAccessToken,
      xRazerFpid: loginResult.xRazerFpid,
      xRazerRazerid: loginResult.xRazerRazerid,
      razerIdAuthToken: '',
      rawHeaders: {},
      referer: process.env.RAZER_GOLD_URL || 'https://gold.razer.com/global/en',
      currentUrl: process.env.RAZER_GOLD_URL || 'https://gold.razer.com/global/en',
    },
  });

  return {
    email,
    success: true,
    userId: authResult.user.id,
    hasAccessToken: !!loginResult.xRazerAccessToken,
  };
}

module.exports = { loadAccounts };
