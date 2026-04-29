require('dotenv').config({ path: '.env' });
const http = require('http');
const app = require('./app');
const connectDB = require('./db');
const { initializeSocket } = require('./socket');
const { loadProxies } = require('./utils/proxyAxios');
const { seedProxiesIfEmpty } = require('./modules/proxy/proxy.seed');

const PORT = process.env.PORT || 4000;

connectDB()
  .then(async () => {
    await seedProxiesIfEmpty();
    await loadProxies();

    const server = http.createServer(app);
    initializeSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });
