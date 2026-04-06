const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let ioInstance = null;

function parseCookieHeader(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) {
        return acc;
      }

      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function resolveToken(handshake) {
  const authToken = handshake.auth && typeof handshake.auth.token === 'string'
    ? handshake.auth.token
    : null;

  if (authToken) {
    return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken;
  }

  const authorization = handshake.headers && handshake.headers.authorization
    ? handshake.headers.authorization
    : '';

  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  const cookies = parseCookieHeader(handshake.headers && handshake.headers.cookie ? handshake.headers.cookie : '');
  return cookies['auth-token'] || null;
}

async function configureRedisAdapter(io) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return;
  }

  try {
    // Lazy import so Redis is optional in local/testing mode.
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');

    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter connected');
  } catch (err) {
    console.error('Socket.IO Redis adapter setup failed:', err.message);
  }
}

function initializeSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = resolveToken(socket.handshake);
      if (!token) {
        return next(new Error('Unauthorized'));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      socket.userId = decoded.sub;
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userRoom = `user:${socket.userId}`;
    socket.join(userRoom);

    socket.on('transactions:join-job', (payload) => {
      if (!payload || typeof payload.jobId !== 'string') {
        return;
      }
      socket.join(`job:${payload.jobId}`);
    });

    socket.on('transactions:leave-job', (payload) => {
      if (!payload || typeof payload.jobId !== 'string') {
        return;
      }
      socket.leave(`job:${payload.jobId}`);
    });
  });

  ioInstance = io;
  configureRedisAdapter(io).catch((err) => {
    console.error('Unexpected Redis adapter setup error:', err.message);
  });

  return io;
}

function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.IO is not initialized');
  }
  return ioInstance;
}

module.exports = {
  initializeSocket,
  getIO,
};
