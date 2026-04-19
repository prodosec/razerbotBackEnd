const axios = require('axios');
const CryptoJS = require('crypto-js');
const { default: wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const log = require('./logStore');

const CLIENT_ID = process.env.RAZER_CLIENT_ID || '63c74d17e027dc11f642146bfeeaee09c3ce23d8';
const SSO_CLIENT_ID = process.env.LAST_CLIENT_ID_PASSED || '63c74d17e027dc11f642146bfeeaee09c3ce23d8';
const GOLD_URL = process.env.RAZER_GOLD_URL || 'https://gold.razer.com/global/en';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

const BASE_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'x-client-v': '20251106',
  'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

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

function buildClient(proxy = null) {
  const jar = new CookieJar();
  // Set JS-only cookies that Razer's browser JS would normally inject
  jar.setCookieSync(`lastClientIdPassed=${CLIENT_ID}; Domain=razerid.razer.com; Path=/`, 'https://razerid.razer.com');
  jar.setCookieSync('RazerIDLanguage=en; Domain=razerid.razer.com; Path=/', 'https://razerid.razer.com');
  jar.setCookieSync('RazerClientSignature=cb6d61dba17d1ee488a11e9b179f867dd41adb4e7bec5ebeae78f281d5f37a5197febf6d16f184319d7b73ce0fbd1f53e6ec8fc9440aa862058047817bcd1e386c9bdfeebcd1003640799427ea0c475e28ce6226947051b2b834970c75b3916a536f0e8a072d22849371f76534b046b5cbeb2c4333c897b7ddf1f0307766e1aff2fba035edc3e0c2e1ff7256581e4054f54da26d7e75d443; Domain=razerid.razer.com; Path=/', 'https://razerid.razer.com');
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const config = { jar, withCredentials: true, timeout: 10000, headers: { 'user-agent': ua } };

  if (proxy) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const WEBSHARE_USER = process.env.WEBSHARE_USER || '';
    const WEBSHARE_PASS = process.env.WEBSHARE_PASS || '';
    if (WEBSHARE_USER && WEBSHARE_PASS) {
      const agent = new HttpsProxyAgent(`http://${WEBSHARE_USER}:${WEBSHARE_PASS}@${proxy.ip}:${proxy.port}`);
      config.httpAgent = agent;
      config.httpsAgent = agent;
    }
  }

  return wrapper(axios.create(config));
}

async function loginOneAccount({ email, password, serviceCode = '0060', proxy = null }) {
  let client = buildClient(proxy);
  const referer = `https://razerid.razer.com/?client_id=${SSO_CLIENT_ID}&redirect=${encodeURIComponent(GOLD_URL)}`;

  // Step 1 — Init session
  try {
    await client.get(`https://razerid.razer.com/api/?ping=${Date.now()}`, {
      headers: { ...BASE_HEADERS, Referer: referer },
    });
  } catch (e) {
    throw new Error(`[step1-ping] ${e.response?.status || ''} ${e.message}`);
  }

  // Step 2 — Login
  const encryptedPw = encryptPassword(password, email, serviceCode);
  const xmlData = `<COP><User><email>${email}</email><password>${encryptedPw}</password></User><ServiceCode>${serviceCode}</ServiceCode></COP>`;

  let loginRes;
  try {
    loginRes = await client.post(
      'https://razerid.razer.com/api/emily/7/login/get',
      { data: xmlData, encryptedPw: 'rev2', clientId: CLIENT_ID },
      { headers: { ...BASE_HEADERS, 'content-type': 'application/json', Referer: referer } }
    );
  } catch (e) {
    const status = e.response?.status;
    const body = e.response?.data;

    // 403 Consent required — accept consent then retry once
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || '');
    log.error('razerLogin', `step2-login ${status}`, { email, status, body: bodyStr.substring(0, 500) });
    return { email, success: false, error: `[step2-login] ${status} ${bodyStr.substring(0, 300)}` };
  }

  let xmlStr = typeof loginRes.data === 'string' ? loginRes.data : JSON.stringify(loginRes.data);
  let errno = parseInt(xmlTag(xmlStr, 'Errno') || '0', 10);

  // ErrorCode 4598 = GDPR consent required — accept scope and retry once
  if (errno < 0) {
    const errorCode = xmlTag(xmlStr, 'ErrorCode');
    const scope = xmlTag(xmlStr, 'scope');

    let consentRaw = '';
    if (errorCode === '4598' && scope) {
      // Try POST endpoints first, then GET acceptconsent
      // Step A — GET TOS content (browser uses GET, not POST)
      try {
        await client.get(
          `https://razerid.razer.com/api/tos/tos?minimal=1&links=0&lang=en`,
          { headers: { ...BASE_HEADERS, Referer: referer }, validateStatus: () => true }
        );
      } catch {}

      // Step B — POST TOS acceptance (same session, scope in body)
      const uniqueToken = require('crypto').randomBytes(16).toString('hex');
      try {
        const tosAcceptRes = await client.post(
          'https://razerid.razer.com/api/tos/tos',
          { data: { scope, service_code: '0770', unique_token: uniqueToken, tos_content_type: 'text/html' } },
          { headers: { ...BASE_HEADERS, 'content-type': 'application/json', Referer: referer }, validateStatus: () => true }
        );
        const resStr = typeof tosAcceptRes.data === 'string' ? tosAcceptRes.data : JSON.stringify(tosAcceptRes.data || '');
        consentRaw = `[POST tos] status=${tosAcceptRes.status} ${resStr.substring(0, 200)}`;
        log.info('razerLogin', 'tos-accept', { email, status: tosAcceptRes.status });
      } catch (ce) {
        consentRaw = `[POST tos] ${ce.message}`;
      }

      // Step C — Ping (browser does this after TOS acceptance, before retry)
      try {
        await client.get(`https://razerid.razer.com/api/?ping=${Date.now()}`, {
          headers: { ...BASE_HEADERS, Referer: referer },
        });
      } catch {}

      // Retry login with same session (consent recorded in same session cookies)
      try {
        const retryPw = encryptPassword(password, email, serviceCode);
        const retryXml = `<COP><User><email>${email}</email><password>${retryPw}</password></User><ServiceCode>${serviceCode}</ServiceCode></COP>`;
        loginRes = await client.post(
          'https://razerid.razer.com/api/emily/7/login/get',
          { data: retryXml, encryptedPw: 'rev2', clientId: CLIENT_ID },
          { headers: { ...BASE_HEADERS, 'content-type': 'application/json', Referer: referer } }
        );
        xmlStr = typeof loginRes.data === 'string' ? loginRes.data : JSON.stringify(loginRes.data);
        errno = parseInt(xmlTag(xmlStr, 'Errno') || '0', 10);
      } catch (re) {
        const retryBody = re.response?.data ? JSON.stringify(re.response.data) : re.message;
        return { email, success: false, error: `[login-retry] ${retryBody.substring(0, 300)}`, raw: retryBody };
      }
    }

    if (errno < 0) {
      log.error('razerLogin', 'step2-login errno<0', { email, errno, xml: xmlStr.substring(0, 800) });
      return { email, success: false, error: `[step2-login] ${xmlTag(xmlStr, 'Message') || 'Login failed'}`, raw: xmlStr.substring(0, 800), consentResponse: consentRaw.substring(0, 500) };
    }
  }

  const token = xmlTag(xmlStr, 'Token');
  const userId = xmlTag(xmlStr, 'ID');
  if (!token) {
    return { email, success: false, error: '[step2-login] No token in response', raw: xmlStr.substring(0, 300) };
  }

  // Step 3 — SSO exchange
  try {
    await client.post(
      'https://oauth2.razer.com/services/login_sso',
      new URLSearchParams({ grant_type: 'password', client_id: SSO_CLIENT_ID, scope: 'sso', uuid: userId || '', token }).toString(),
      { headers: { ...BASE_HEADERS, 'content-type': 'application/x-www-form-urlencoded', Referer: 'https://razerid.razer.com/' } }
    );
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data).substring(0, 200) : e.message;
    throw new Error(`[step3-sso] ${e.response?.status || ''} ${detail}`);
  }

  // Step 4 — Extract oauth2.razer.com session cookies from jar
  const oauthCookies = await client.defaults.jar.getCookies('https://oauth2.razer.com');
  const rzrsess = oauthCookies.find(c => c.key === '_rzrsess')?.value || '';
  const rzru = oauthCookies.find(c => c.key === '_rzru')?.value || '';
  const oauthCookieHeader = oauthCookies.map(c => `${c.key}=${c.value}`).join('; ');

  // Step 5 — Exchange SSO session for access_token (xRazerAccessToken)
  let xRazerAccessToken = '';
  try {
    const ssoRes = await client.post(
      'https://oauth2.razer.com/services/sso',
      new URLSearchParams({ client_id: SSO_CLIENT_ID, client_key: 'enZhdWx0', scope: 'sso cop' }).toString(),
      {
        headers: {
          ...BASE_HEADERS,
          'content-type': 'application/x-www-form-urlencoded',
          'cookie': oauthCookieHeader,
          'Origin': 'https://gold.razer.com',
          'Referer': 'https://gold.razer.com/global/en',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }
    );
    xRazerAccessToken = ssoRes.data?.access_token || '';
  } catch {}

  const cookieHeader = oauthCookieHeader;

  return {
    email,
    success: true,
    cookieHeader,
    oauthCookieHeader,
    rzrsess,
    rzru,
    xRazerAccessToken,
    xRazerFpid: '',
    xRazerRazerid: userId || '',
    ssoData: null,
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
