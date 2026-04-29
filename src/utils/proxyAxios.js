const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const WEBSHARE_USER = process.env.WEBSHARE_USER || '';
const WEBSHARE_PASS = process.env.WEBSHARE_PASS || '';

// In-memory cache populated from MongoDB at startup via loadProxies().
// Mutated in place so existing destructured references stay valid after reloadProxies().
const PROXY_LIST = [];

const DEFAULT_PROXY_ID = 1;

async function loadProxies() {
  const Proxy = require('../modules/proxy/proxy.model');
  const docs = await Proxy.find({}).sort({ id: 1 }).lean();
  PROXY_LIST.splice(0, PROXY_LIST.length, ...docs);
  console.log(`[proxy] Loaded ${PROXY_LIST.length} proxies from DB`);
  return PROXY_LIST;
}

const reloadProxies = loadProxies;

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

function getAxiosForProxyId(proxyId) {
  if (proxyId === null || proxyId === undefined) {
    console.log('[proxy] getAxiosForProxyId proxyId=null — using server IP');
    return axios;
  }
  return buildAxiosWithProxy(proxyId);
}

function getProxyMeta(proxyId) {
  if (proxyId === null || proxyId === undefined) {
    return { id: null, label: 'Server IP', country: null };
  }
  const proxy = PROXY_LIST.find((p) => p.id === proxyId);
  if (!proxy) {
    return { id: proxyId, label: `Proxy ${proxyId}`, country: null };
  }
  return { id: proxy.id, label: proxy.label, country: proxy.country };
}

module.exports = {
  getAxiosForUser,
  getAxiosForProxyId,
  buildAxiosWithProxy,
  getProxyMeta,
  loadProxies,
  reloadProxies,
  PROXY_LIST,
  DEFAULT_PROXY_ID,
};
