// apps/backend/middleware/rateLimit.js

/**
 * Простой in-memory rate limit без внешних зависимостей.
 * Поддерживает квоты per-IP и per-device за окно времени.
 * Используем скользящее окно на массиве отметок времени.
 */

const WINDOW_MS = Number(process.env.RL_WINDOW_MS || 60_000);       // 60с окно
const MAX_PER_IP = Number(process.env.RL_MAX_PER_IP || 12);         // 12/мин на IP
const MAX_PER_DEVICE = Number(process.env.RL_MAX_PER_DEVICE || 4);  // 4/мин на устройство
const MIN_INTERVAL_DEVICE_MS = Number(process.env.RL_MIN_INTERVAL_DEVICE_MS || 3_000); // не чаще 1 запроса в 3с

const bucketsIP = new Map();      // ip -> number[] timestamps
const bucketsDevice = new Map();  // device_id -> number[] timestamps
const lastHitDevice = new Map();  // device_id -> last ts

function purge(arr, now) {
  const start = now - WINDOW_MS;
  while (arr.length && arr[0] < start) arr.shift();
}

function note(map, key, now) {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(now);
  return arr;
}

function humanWindow(ms) {
  if (ms < 60_000) return `${Math.ceil(ms/1000)} сек`;
  return `${Math.ceil(ms/60_000)} мин`;
}

export function rateLimitFeedback(req, res, next) {
  try {
    const now = Date.now();
    const ip = (req.ip || req.headers['x-forwarded-for'] || '').toString();
    const device = (req.body?.device_id || 'unknown_device').toString();

    // --- per IP ---
    const arrIP = note(bucketsIP, ip, now);
    purge(arrIP, now);
    if (arrIP.length > MAX_PER_IP) {
      return res.status(429).json({
        error: `Слишком много запросов с вашего IP. Попробуйте снова через ${humanWindow(WINDOW_MS)}.`,
        code: 'RATE_LIMIT_IP'
      });
    }

    // --- per device (требует multer, чтобы распарсить поля) ---
    const last = lastHitDevice.get(device) || 0;
    if (now - last < MIN_INTERVAL_DEVICE_MS) {
      const waitMs = MIN_INTERVAL_DEVICE_MS - (now - last);
      return res.status(429).json({
        error: `Слишком часто с устройства. Подождите ${Math.ceil(waitMs/1000)} сек и попробуйте снова.`,
        code: 'RATE_LIMIT_DEVICE_INTERVAL'
      });
    }

    const arrDev = note(bucketsDevice, device, now);
    purge(arrDev, now);
    if (arrDev.length > MAX_PER_DEVICE) {
      return res.status(429).json({
        error: `Лимит загрузок для устройства превышен. Дождитесь ${humanWindow(WINDOW_MS)}.`,
        code: 'RATE_LIMIT_DEVICE'
      });
    }

    lastHitDevice.set(device, now);
    return next();
  } catch (e) {
    // не роняем пайплайн, если что-то пошло не так — просто пропускаем
    console.warn('⚠️ rateLimitFeedback error:', e.message);
    return next();
  }
}
