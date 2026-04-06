const { getIO } = require('../../socket');

function emitTransactionEvent(userId, jobId, eventName, payload) {
  try {
    const io = getIO();
    const userRoom = `user:${userId}`;
    const jobRoom = `job:${jobId}`;

    io.to(userRoom).emit(eventName, payload);
    io.to(jobRoom).emit(eventName, payload);
  } catch (err) {
    // Socket server might not be initialized in unit tests.
  }
}

module.exports = {
  emitTransactionEvent,
};
