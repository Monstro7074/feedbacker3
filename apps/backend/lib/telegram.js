// apps/backend/lib/telegram.js

/**
 * Надёжная отправка Телеграм-алертов с поддержкой нескольких chat_id и безопасным форматированием.
 * Не кидает исключения при частичных фейлах — логирует и возвращает true, если отправлено хотя бы в один чат.
 */

const TG_API = 'https://api.telegram.org';

function htmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtPercent01(x) {
  const n = Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5;
  return (n * 100).toFixed(0) + '%';
}

function sentimentIcon(sentiment) {
  const s = (sentiment || '').toLowerCase();
  if (s.startsWith('негатив')) return '🔴';
  if (s.startsWith('позитив')) return '🟢';
  return '🟡';
}

function isCritical(sentiment, score) {
  const s = (sentiment || '').toLowerCase();
  const v = Number(score);
  return s.startsWith('негатив') && Number.isFinite(v) && v <= 0.4;
}

/**
 * Готовит текст сообщения (HTML)
 */
function buildMessage(feedback) {
  const {
    id,
    shop_id,
    device_id,
    timestamp,
    sentiment,
    emotion_score,
    tags = [],
    summary = '',
    transcript = '',
  } = feedback || {};

  const icon = sentimentIcon(sentiment);
  const critical = isCritical(sentiment, emotion_score) ? ' — <b>КРИТИЧНО</b>' : '';
  const scoreStr = fmtPercent01(emotion_score);

  const safeSummary = htmlEscape(summary || '').trim();
  const safeTranscript = htmlEscape((transcript || '').replace(/\s+/g, ' ').slice(0, 240)).trim();
  const safeTags = tags && tags.length ? htmlEscape(tags.join(', ')) : '—';

  const base = process.env.PUBLIC_BASE_URL || 'https://feedbacker3.onrender.com';
  const linkAudio = `${base}/feedback/get-audio/${id}`;
  const linkFull = `${base}/feedback/full/${id}`;

  const header =
    `${icon} <b>Новый отзыв</b>${critical}\n` +
    `Магазин: <b>${htmlEscape(shop_id || '—')}</b> · Устройство: <b>${htmlEscape(device_id || '—')}</b>\n` +
    `Время: <i>${htmlEscape(timestamp || new Date().toISOString())}</i>\n`;

  const analytics =
    `Оценка эмоций: <b>${htmlEscape(sentiment || '—')}</b> (${scoreStr})\n` +
    `Теги: <b>${safeTags}</b>\n` +
    (safeSummary ? `Кратко: “${safeSummary}”\n` : '');

  const links =
    `<a href="${linkFull}">Детали</a> · <a href="${linkAudio}">Аудио</a>`;

  const tail = safeTranscript ? `\n<i>${safeTranscript}</i>` : '';

  return `${header}\n${analytics}${links}${tail}`;
}

/**
 * Отправка одного сообщения
 */
async function sendToChat({ token, chatId, text, parseMode = 'HTML', timeoutMs = 8000 }) {
  const url = `${TG_API}/bot${token}/sendMessage`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    clearTimeout(to);

    let data = null;
    try { data = await resp.json(); } catch { /* ignore */ }

    if (!resp.ok || data?.ok === false) {
      const errMsg = data?.description || `HTTP ${resp.status}`;
      console.warn(`⚠️ Telegram sendMessage failed for chat ${chatId}: ${errMsg}`);
      return false;
    }
    return true;
  } catch (e) {
    clearTimeout(to);
    console.warn(`⚠️ Telegram request error for chat ${chatId}: ${e?.message || e}`);
    return false;
  }
}

/**
 * Публичная функция
 * @param {object} feedback — объект, который вы сохраняете в БД (id, shop_id, sentiment, emotion_score, tags, summary, …)
 * @returns {Promise<boolean>} true — если отправлено хотя бы в один чат
 */
export async function sendAlert(feedback) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN;
  const idsRaw =
    process.env.TELEGRAM_CHAT_IDS ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.TG_CHAT_IDS ||
    process.env.TG_CHAT_ID;

  if (!token) {
    console.warn('⚠️ Telegram: TELEGRAM_BOT_TOKEN не задан — алерт пропущен');
    return false;
  }
  if (!idsRaw) {
    console.warn('⚠️ Telegram: TELEGRAM_CHAT_IDS/ID не задан — алерт пропущен');
    return false;
  }

  const chatIds = String(idsRaw)
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (chatIds.length === 0) {
    console.warn('⚠️ Telegram: не найдено валидных chat_id — алерт пропущен');
    return false;
  }

  const text = buildMessage(feedback);

  let success = 0;
  for (const id of chatIds) {
    const ok = await sendToChat({ token, chatId: id, text });
    if (ok) success++;
  }

  if (success > 0) {
    console.log(`✅ Telegram alert отправлен (${success}/${chatIds.length})`);
    return true;
  } else {
    // Не бросаем AggregateError — просто фиксируем факт неуспеха
    console.warn('❌ Telegram alert не удалось отправить ни в один чат');
    return false;
  }
}

export default { sendAlert };
