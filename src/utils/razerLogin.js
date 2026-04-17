const axios = require('axios');
const CryptoJS = require('crypto-js');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const CLIENT_ID = process.env.RAZER_CLIENT_ID || '63c74d17e027dc11f642146bfeeaee09c3ce23d8';
const GOLD_URL = process.env.RAZER_GOLD_URL || 'https://gold.razer.com/global/en';

function deriveKey(jsonKey) {
  return jsonKey.length > 32
    ? jsonKey.substring(0, 32)
    : jsonKey + 'G6jptXCj9kSP2Wu4TCF1HmEZSUmSeGvV'.slice(jsonKey.length);
}

function generateIvHex() {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 16; i++) result += chars.charAt(Math.floor(16 * Math.random()));
  return result;
}

function encryptPassword(password, email, serviceCode) {
  const timestamp = Math.round(Date.now() / 1000);
  const message = `${password}|rzrpw_u4dNqrv|${timestamp}`;
  const jsonKey = JSON.stringify({ COP: { User: { email }, ServiceCode: serviceCode } });
  const keyStr = deriveKey(jsonKey);
  const ivHex = generateIvHex();
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Hex.parse(ivHex);
  const encrypted = CryptoJS.AES.encrypt(message, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return ivHex + encrypted.ciphertext.toString();
}

function buildClient() {
  const jar = new CookieJar();
  return wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout: 15000,
  }));
}

const BASE_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'x-client-v': '20251106',
};

async function loginOneAccount({ email, password, serviceCode = '0060' }) {
  const client = buildClient();
  const referer = `https://razerid.razer.com/?client_id=${CLIENT_ID}&redirect=${encodeURIComponent(GOLD_URL)}`;

  // Step 1 — Init session (get PHPSESSID + RazerClientSignature)
  await client.get(`https://razerid.razer.com/api/?ping=${Date.now()}`, {
    headers: { ...BASE_HEADERS, Referer: referer },
  });

  // Step 2 — Login with AES encrypted password
  const encryptedPw = encryptPassword(password, email, serviceCode);
  const xmlData = `<COP><User><email>${email}</email><password>${encryptedPw}</password></User><ServiceCode>${serviceCode}</ServiceCode></COP>`;

  const loginRes = await client.post(
    'https://razerid.razer.com/api/emily/7/login/get',
    { data: xmlData, encryptedPw: 'rev2', clientId: CLIENT_ID },
    { headers: { ...BASE_HEADERS, 'content-type': 'application/json', Referer: referer } }
  );

  // Parse response — check for errors
  const loginData = loginRes.data;
  if (loginData?.COP?.Status?.Errno?._text < 0 || loginData?.error) {
    const errMsg = loginData?.COP?.Status?.Message?._text || loginData?.error || 'Login failed';
    return { email, success: false, error: errMsg };
  }

  const token = loginData?.COP?.User?.token?._text
    || loginData?.COP?.User?.['razer-id']?._text
    || loginData?.token;

  if (!token) {
    return { email, success: false, error: 'No token in response', raw: JSON.stringify(loginData).substring(0, 200) };
  }

  // Step 3 — SSO token exchange
  const uuid = `RZR_0770${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
  const ssoRes = await client.post(
    'https://oauth2.razer.com/services/login_sso',
    new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      scope: 'sso cop',
      uuid,
      token,
    }).toString(),
    {
      headers: {
        ...BASE_HEADERS,
        'content-type': 'application/x-www-form-urlencoded',
        Referer: 'https://razerid.razer.com/',
      },
    }
  );

  // Step 4 — Hit gold.razer.com to get x-razer-accesstoken
  let xRazerAccessToken = '';
  let xRazerFpid = '';
  let xRazerRazerid = '';
  let cookieHeader = '';

  try {
    const goldRes = await client.get(GOLD_URL, {
      headers: { ...BASE_HEADERS, Referer: 'https://oauth2.razer.com/' },
    });
    xRazerAccessToken = goldRes.config?.headers?.['x-razer-accesstoken'] || '';
    xRazerFpid = goldRes.config?.headers?.['x-razer-fpid'] || '';
    xRazerRazerid = goldRes.config?.headers?.['x-razer-razerid'] || '';
  } catch (e) {
    // gold.razer.com may redirect — cookies still captured
  }

  // Extract cookies
  const jar = client.defaults.jar;
  const cookies = await jar.getCookies('https://gold.razer.com');
  cookieHeader = cookies.map(c => `${c.key}=${c.value}`).join('; ');

  return {
    email,
    success: true,
    cookieHeader,
    xRazerAccessToken,
    xRazerFpid,
    xRazerRazerid,
    ssoData: ssoRes.data,
  };
}

async function loginBatch(accounts, { batchSize = 20, onProgress } = {}) {
  const results = [];
  const start = Date.now();

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(loginOneAccount));

    batchResults.forEach((r, idx) => {
      const result = r.status === 'fulfilled'
        ? r.value
        : { email: batch[idx].email, success: false, error: r.reason?.message };
      results.push(result);
      if (onProgress) onProgress(result, results.length, accounts.length);
    });

    console.log(`Batch ${Math.floor(i / batchSize) + 1}: ${results.filter(r => r.success).length}/${results.length} success`);
  }

  console.log(`Total: ${results.filter(r => r.success).length}/${accounts.length} in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return results;
}

module.exports = { loginOneAccount, loginBatch, encryptPassword };
