const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const WEBSHARE_USER = process.env.WEBSHARE_USER || '';
const WEBSHARE_PASS = process.env.WEBSHARE_PASS || '';

// Webshare static proxies — update label/country from your Webshare dashboard
const PROXY_LIST = [
  { id: 1,  label: 'Proxy 1',  country: 'United Kingdom', ip: '31.59.20.176',     port: '6754' },
  { id: 2,  label: 'Proxy 2',  country: 'United States', ip: '198.23.239.134',   port: '6540', disabled: true },
  { id: 3,  label: 'Proxy 3',  country: 'United Kingdom', ip: '45.38.107.97',     port: '6014' },
  { id: 4,  label: 'Proxy 4',  country: 'United States', ip: '107.172.163.27',   port: '6543' },
  { id: 5,  label: 'Proxy 5',  country: 'United Kingdom', ip: '198.105.121.200',  port: '6462' },
  { id: 6,  label: 'Proxy 6',  country: 'United States', ip: '216.10.27.159',    port: '6837' },
  { id: 7,  label: 'Proxy 7',  country: 'Japan', ip: '142.111.67.146',   port: '5611' },
  { id: 8,  label: 'Proxy 8',  country: 'United States', ip: '191.96.254.138',   port: '6185' },
  { id: 9,  label: 'Proxy 9',  country: 'Germany', ip: '31.58.9.4',        port: '6077' },
  { id: 10, label: 'Proxy 10', country: 'United States', ip: '23.26.71.145',     port: '5628' },
];

const DEFAULT_PROXY_ID = 1;

function buildAxiosWithProxy(proxyId) {
  const proxy = PROXY_LIST.find((p) => p.id === proxyId) || PROXY_LIST.find((p) => p.id === DEFAULT_PROXY_ID);

  if (!proxy || !WEBSHARE_USER || !WEBSHARE_PASS) {
    return axios;
  }

  const proxyUrl = `http://${WEBSHARE_USER}:${WEBSHARE_PASS}@${proxy.ip}:${proxy.port}`;
  const agent = new HttpsProxyAgent(proxyUrl);

  return axios.create({
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 15000,
  });
}

async function getAxiosForUser(userId) {
  const mongoose = require('mongoose');
  const User = mongoose.model('RegisteredUser');
  const user = await User.findById(userId).select('proxyId').lean();
  return buildAxiosWithProxy(user?.proxyId ?? DEFAULT_PROXY_ID);
}

module.exports = { getAxiosForUser, PROXY_LIST, DEFAULT_PROXY_ID };
