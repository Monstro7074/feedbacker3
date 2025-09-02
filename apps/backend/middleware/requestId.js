// apps/backend/middleware/requestId.js
import { randomUUID } from 'node:crypto';

export function requestIdMiddleware(req, res, next) {
  const incoming =
    req.header('X-Request-ID') ||
    req.header('x-request-id') ||
    req.header('CF-Ray') ||
    req.header('cf-ray');

  const reqId = (incoming && String(incoming).trim()) || randomUUID();
  req.id = reqId;
  res.locals.requestId = reqId;
  res.setHeader('X-Request-ID', reqId);
  next();
}
