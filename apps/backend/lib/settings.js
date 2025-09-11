// apps/backend/lib/settings.js
import { supabaseAdmin } from './supabase.js';

const SETTINGS_TABLE = 'settings';

// Простой кэш в памяти: key -> { value, ts }
const cache = new Map();
const now = () => Date.now();

/**
 * Получить настройку из таблицы settings с кэшем.
 * @param {string} key
 * @param {*} defaultValue - что вернуть, если записи нет/ошибка
 * @param {{ttlMs?: number}} [opts] - время жизни кэша (по умолчанию 60 сек)
 * @returns {*} value (как строка, если хранишь text)
 */
export async function getSetting(key, defaultValue = null, opts = {}) {
  const { ttlMs = 60_000 } = opts;

  const c = cache.get(key);
  if (c && now() - c.ts < ttlMs) return c.value;

  const { data, error } = await supabaseAdmin
    .from(SETTINGS_TABLE)
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) {
    cache.set(key, { value: defaultValue, ts: now() });
    return defaultValue;
  }

  cache.set(key, { value: data.value, ts: now() });
  return data.value ?? defaultValue;
}

/**
 * Установить настройку (upsert) и обновить кэш.
 * @param {string} key
 * @param {*} valueObj - любое значение; приведём к строке для text-колонки
 */
export async function setSetting(key, valueObj) {
  const value = String(valueObj);
  const payload = { key, value, updated_at: new Date().toISOString() };

  const { error } = await supabaseAdmin
    .from(SETTINGS_TABLE)
    .upsert(payload, { onConflict: 'key' });

  if (error) throw new Error(error.message);

  cache.set(key, { value, ts: now() });
  return true;
}

/**
 * Удобный хелпер для числовых настроек.
 * Возвращает число или fallback, если не парсится.
 */
export async function getSettingNumber(key, fallbackNumber, opts) {
  const v = await getSetting(key, String(fallbackNumber), opts);
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallbackNumber;
}
