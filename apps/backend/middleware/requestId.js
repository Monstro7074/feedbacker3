// apps/backend/middleware/requestId.js
import { randomUUID } from 'crypto';

/**
 * Простая обвязка request-id:
 * - учитывает входящий X-Request-Id / X-Correlation-Id (если есть)
 * - генерирует UUID при отсутствии
 * - прокидывает в res header X-Request-Id
 * - сохраняет в req.id и req.requestId (совместимо с текущим логгером)
 */
export default function requestId() {
  return function requestIdMiddleware(req, res, next) {
    const inbound =
      req.headers['x-request-id'] ||
      req.headers['x-correlation-id'];

    const id = String(inbound || randomUUID());

    // совместимость
    req.id = id;
    req.requestId = id;
    res.locals.requestId = id;

    // для клиентов/прокси
    res.setHeader('X-Request-Id', id);

    next();
  };
}
