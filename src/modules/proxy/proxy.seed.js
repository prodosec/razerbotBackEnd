const Proxy = require('./proxy.model');

const SEED_PROXIES = [
  { id: 1, label: 'Proxy 1 (Dedicated US)', country: 'United States', ip: '23.27.60.35',   port: '8115', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 2, label: 'Proxy 2 (Dedicated US)', country: 'United States', ip: '107.173.5.3',   port: '5064', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 3, label: 'Proxy 3 (Dedicated US)', country: 'United States', ip: '45.249.57.48',  port: '5440', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 4, label: 'Proxy 4 (Dedicated US)', country: 'United States', ip: '104.252.57.110',port: '8032', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
  { id: 5, label: 'Proxy 5 (Dedicated US)', country: 'United States', ip: '154.29.68.118', port: '5159', username: 'gnizsxfb', password: 'hp8b1lsc34s9', dedicated: true },
];

async function seedProxiesIfEmpty() {
  const count = await Proxy.estimatedDocumentCount();
  if (count > 0) return { seeded: false, count };

  await Proxy.insertMany(SEED_PROXIES);
  console.log(`[proxy] Seeded ${SEED_PROXIES.length} proxies into DB`);
  return { seeded: true, count: SEED_PROXIES.length };
}

module.exports = { seedProxiesIfEmpty, SEED_PROXIES };
