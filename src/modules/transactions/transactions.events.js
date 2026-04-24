const { getIO } = require('../../socket');

function emitTransactionEvent(userId, jobId, eventName, payload) {
  try {
    const io = getIO();
    const userRoom = `user:${userId}`;
    const jobRoom = `job:${jobId}`;

    const userClients = io.sockets.adapter.rooms.get(userRoom)?.size ?? 0;
    const jobClients  = io.sockets.adapter.rooms.get(jobRoom)?.size ?? 0;
    console.log(`[socket] emit ${eventName} → user:${userId} (${userClients} clients) + job:${jobId.slice(0, 8)} (${jobClients} clients)`);

    io.to(userRoom).emit(eventName, payload);
    io.to(jobRoom).emit(eventName, payload);
  } catch (err) {
    console.error('[socket] emit failed:', err.message);
  }
}

module.exports = {
  emitTransactionEvent,
};
