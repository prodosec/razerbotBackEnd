const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const WEBSHARE_USER = process.env.WEBSHARE_USER || '';
const WEBSHARE_PASS = process.env.WEBSHARE_PASS || '';

// Webshare static proxies — update label/country from your Webshare dashboard
const PROXY_LIST = [
  // { id: 1,  label: 'Proxy 1',  country: 'United Kingdom', ip: '31.59.20.176',     port: '6754' },
  // { id: 2,  label: 'Proxy 2',  country: 'United States',  ip: '198.23.239.134',   port: '6540', disabled: true },
  // { id: 3,  label: 'Proxy 3',  country: 'United Kingdom', ip: '45.38.107.97',     port: '6014' },
  // { id: 4,  label: 'Proxy 4',  country: 'United States',  ip: '107.172.163.27',   port: '6543'},
  // { id: 5,  label: 'Proxy 5',  country: 'United Kingdom', ip: '198.105.121.200',  port: '6462' },
  // { id: 6,  label: 'Proxy 6',  country: 'United States',  ip: '216.10.27.159',    port: '6837'},
  // { id: 7,  label: 'Proxy 7',  country: 'Japan',          ip: '142.111.67.146',   port: '5611'},
  // { id: 8,  label: 'Proxy 8',  country: 'United States',  ip: '191.96.254.138',   port: '6185', disabled: true },
  // { id: 9,  label: 'Proxy 9',  country: 'Germany',        ip: '31.58.9.4',        port: '6077', disabled: true },
  // { id: 10, label: 'Proxy 10', country: 'United States',  ip: '23.26.71.145',     port: '5628' },
  // Dedicated proxies — own credentials
  { id: 1, label: 'Proxy 1 (Dedicated US)', country: 'United States', ip: '23.27.60.35',  port: '8115', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 2, label: 'Proxy 2 (Dedicated US)', country: 'United States', ip: '107.173.5.3', port: '5064', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 3, label: 'Proxy 3 (Dedicated US)', country: 'United States', ip: '45.249.57.48',    port: '5440', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 4, label: 'Proxy 4 (Dedicated US)', country: 'United States', ip: '104.252.57.110', port: '8032', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 5, label: 'Proxy 5 (Dedicated US)', country: 'United States', ip: '154.29.68.118',  port: '5159', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
];

const DEFAULT_PROXY_ID = 1;

function buildAxiosWithProxy(proxyId) {
  const proxy = PROXY_LIST.find((p) => p.id === proxyId) || PROXY_LIST.find((p) => p.id === DEFAULT_PROXY_ID);

  const user = proxy?.username || WEBSHARE_USER;
  const pass = proxy?.password || WEBSHARE_PASS;

  if (!proxy || !user || !pass) {
    console.warn(`[proxy] No proxy credentials found for proxyId ${proxyId} — using direct connection`);
    return axios;
  }

  const proxyUrl = `http://${user}:${pass}@${proxy.ip}:${proxy.port}`;
  console.log(`[proxy] Using proxy: ${proxy.label} | ${proxy.ip}:${proxy.port} | ${proxy.country}`);

  const agent = new HttpsProxyAgent(proxyUrl);

  const instance = axios.create({
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000,
  });

  instance.interceptors.response.use(
    (res) => {
      console.log(`[proxy] ${res.config.method?.toUpperCase()} ${res.config.url} → ${res.status} (via ${proxy.ip})`);
      return res;
    },
    (err) => {
      const url = err.config?.url || 'unknown';
      const code = err.code || 'unknown';
      console.error(`[proxy] ERROR ${url} via ${proxy.ip}:${proxy.port} — code: ${code} — ${err.message}`);
      return Promise.reject(err);
    }
  );

  return instance;
}

async function getAxiosForUser(userId) {
  const mongoose = require('mongoose');
  const User = mongoose.model('RegisteredUser');
  const user = await User.findById(userId).select('proxyId').lean();
  const proxyId = user?.proxyId ?? null;
  console.log(`[proxy] getAxiosForUser userId=${userId} proxyId=${proxyId}`);
  if (proxyId === null || proxyId === undefined) {
    console.log(`[proxy] No proxy assigned — using server's own IP`);
    return axios;
  }
  return buildAxiosWithProxy(proxyId);
}

module.exports = { getAxiosForUser, buildAxiosWithProxy, PROXY_LIST, DEFAULT_PROXY_ID };
