// apps/backend/middleware/abuse/limiter.js
import fs from "fs";
import { parseFile } from "music-metadata";

/** простая память с очисткой по TTL */
class WindowCounter {
  constructor() { this.buckets = new Map(); }
  _now() { return Date.now(); }
  _prune(key, windowMs) {
    const arr = this.buckets.get(key);
    if (!arr) return;
    const since = this._now() - windowMs;
    while (arr.length && arr[0] < since) arr.shift();
    if (!arr.length) this.buckets.delete(key);
  }
  incr(key, windowMs) {
    const now = this._now();
    const arr = this.buckets.get(key) || [];
    arr.push(now);
    this.buckets.set(key, arr);
    this._prune(key, windowMs);
    return arr.length;
  }
  count(key, windowMs) {
    this._prune(key, windowMs);
    const arr = this.buckets.get(key);
    return arr ? arr.length : 0;
  }
  lastAt(key) {
    const arr = this.buckets.get(key);
    return arr && arr.length ? arr[arr.length - 1] : 0;
  }
}
const ipCounter = new WindowCounter();
const deviceCounter = new WindowCounter();

/** безопасный IP с учётом прокси */
export function getClientIp(req) {
  const xf = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return xf || req.ip || req.connection?.remoteAddress || "unknown";
}

/** middleware: базовый анти-спам */
export function spamShield(options = {}) {
  const {
    ipWindowSec     = Number(process.env.FEEDBACK_IP_WINDOW_SEC || 60),   // окно
    ipMax           = Number(process.env.FEEDBACK_IP_MAX || 10),          // макс в окне
    deviceWindowSec = Number(process.env.FEEDBACK_DEVICE_WINDOW_SEC || 300),
    deviceMax       = Number(process.env.FEEDBACK_DEVICE_MAX || 12),
    minIntervalMs   = Number(process.env.FEEDBACK_MIN_INTERVAL_MS || 1500),
  } = options;

  const ipWindowMs = ipWindowSec * 1000;
  const devWindowMs = deviceWindowSec * 1000;

  return (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const device = (req.body?.device_id || "unknown").toString();

      // минимальный интервал между запросами для одного устройства
      const last = deviceCounter.lastAt(device);
      if (last && Date.now() - last < minIntervalMs) {
        return res.status(429).json({
          error: `Слишком часто: подождите ${Math.ceil((minIntervalMs - (Date.now() - last)) / 1000)} сек.`,
          reason: "rate_min_interval",
        });
      }

      // учёт обращений
      const ipCount = ipCounter.incr(ip, ipWindowMs);
      if (ipCount > ipMax) {
        return res.status(429).json({
          error: `Лимит обращений по IP. Попробуйте позже.`,
          reason: "rate_ip_window",
          window_sec: ipWindowSec,
          limit: ipMax,
        });
      }

      const devCount = deviceCounter.incr(device, devWindowMs);
      if (devCount > deviceMax) {
        return res.status(429).json({
          error: `Лимит обращений с устройства. Попробуйте позже.`,
          reason: "rate_device_window",
          window_sec: deviceWindowSec,
          limit: deviceMax,
        });
      }

      next();
    } catch (e) {
      return res.status(500).json({ error: "Внутренняя ошибка анти-спама" });
    }
  };
}

/** middleware: проверка длительности аудио (после multer) */
export function validateAudioDuration(options = {}) {
  const minSec = Number(process.env.FEEDBACK_MIN_AUDIO_SEC || options.minSec || 2);   // отсечь <1–2 сек
  const maxMin = Number(process.env.FEEDBACK_MAX_AUDIO_MIN || options.maxMin || 5);   // отсечь >N минут
  const maxSec = Math.max(1, maxMin * 60);

  return async (req, res, next) => {
    const tmpPath = req.file?.path;
    if (!tmpPath || !fs.existsSync(tmpPath)) {
      return res.status(400).json({ error: "Аудио-файл не загружен" });
    }
    try {
      const meta = await parseFile(tmpPath).catch(() => null);
      const durSec = Math.round((meta?.format?.duration || 0) * 1000) / 1000;

      if (!durSec || Number.isNaN(durSec)) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(400).json({ error: "Не удалось определить длительность аудио" });
      }
      if (durSec < minSec) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(400).json({ error: `Аудио слишком короткое (< ${minSec} сек)` });
      }
      if (durSec > maxSec) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(400).json({ error: `Аудио слишком длинное (> ${maxMin} мин)` });
      }

      // пробрасываем длительность дальше — может пригодиться
      req.audioDurationSec = durSec;
      return next();
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch {}
      return res.status(400).json({ error: "Ошибка проверки длительности аудио" });
    }
  };
}
