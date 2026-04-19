const MAX_LOGS = 500;
const logs = [];

function addLog(level, tag, message, data = null) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    tag,
    message,
    ...(data !== null ? { data } : {}),
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

const log = {
  info: (tag, msg, data) => addLog('info', tag, msg, data),
  warn: (tag, msg, data) => addLog('warn', tag, msg, data),
  error: (tag, msg, data) => addLog('error', tag, msg, data),
  getLogs: (limit = 100) => logs.slice(-limit).reverse(),
  clear: () => { logs.splice(0, logs.length); },
};

module.exports = log;
