// apps/backend/utils/logger.js
function base(level, requestId, msg, extra) {
  const time = new Date().toISOString();
  const line = {
    t: time,
    level,
    requestId,
    msg,
    ...(extra && typeof extra === 'object' ? extra : {})
  };
  console.log(JSON.stringify(line));
}

export const logger = {
  info: (requestId, msg, extra) => base('INFO', requestId, msg, extra),
  warn: (requestId, msg, extra) => base('WARN', requestId, msg, extra),
  error: (requestId, msg, extra) => base('ERROR', requestId, msg, extra)
};
