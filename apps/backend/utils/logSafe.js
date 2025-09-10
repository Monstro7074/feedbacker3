// apps/backend/utils/logSafe.js
export function redactUrl(str) {
  return String(str || '')
    // query-параметры вида ?token=... или &token=...
    .replace(/([?&]token=)[^&#]+/gi, '$1[REDACTED]')
    // подстрахуем типичные ключи
    .replace(/([?&](api_key|apikey|key)=)[^&#]+/gi, '$1[REDACTED]');
}

export function redactAny(v) {
  if (typeof v === 'string') return redactUrl(v);
  if (v && typeof v === 'object') {
    try {
      return JSON.parse(
        JSON.stringify(v, (_, val) => (typeof val === 'string' ? redactUrl(val) : val))
      );
    } catch {
      return v;
    }
  }
  return v;
}
