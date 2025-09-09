// apps/backend/lib/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from './supabase.js';

const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_IDS_RAW =
  process.env.TELEGRAM_CHAT_IDS ||
  process.env.TELEGRAM_CHAT_ID ||          // поддержим один или несколько id
  process.env.TG_CHAT_IDS ||
  process.env.TG_CHAT_ID;

const BUCKET = process.env.SUPABASE_BUCKET;

// желаемые значения
const FOURTEEN_DAYS = 14 * 24 * 60 * 60;     // 1209600 сек
const SEVEN_DAYS    = 7  * 24 * 60 * 60;     // 604800 сек

function getBot() {
  if (!TOKEN || !CHAT_IDS_RAW) {
    console.warn('⚠️ TELEGRAM_TOKEN или TELEGRAM_CHAT_ID(S) не заданы — алерты отключены');
    return null;
  }
  return new TelegramBot(TOKEN, { polling: false });
}

function htmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtPercent01(x) {
  const n = Number.isFinite(Number(x)) ? Math.max(0, Math.min(1, Number(x))) : 0.5;
  return (n * 100).toFixed(0) + '%';
}

function isCritical(sentiment, score) {
  const s = String(sentiment || '').toLowerCase();
  const v = Number(score);
  // критично: явный негатив и низкий скор
  return (s.includes('негатив') || s.includes('negative')) && Number.isFinite(v) && v <= 0.4;
}

function pickTitle(sentiment, emotion_score) {
  const s = String(sentiment || '').toLowerCase();
  if (isCritical(s, emotion_score)) return '🚨 Критичный отзыв!';
  if (s.includes('полож') || s.includes('positive')) return '💚 Положительный отзыв';
  if (s.includes('негатив') || s.includes('negative')) return '🟥 Негативный отзыв';
  return '😐 Нейтральный отзыв';
}

async function makeAudioUrl(feedback) {
  // Путь к файлу в бакете
  let audioPath = feedback.audio_path;
  if (!audioPath && feedback.audio_url) {
    audioPath = feedback.audio_url.replace(
      /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\//,
      ''
    );
  }

  const base =
    process.env.PUBLIC_BASE_URL ||
    process.env.FEEDBACK_API_URL ||
    'https://feedbacker3.onrender.com';

  // По умолчанию используем «вечную» ссылку через редирект-эндпоинт
  let audioUrl = `${base}/feedback/redirect-audio/${feedback.id}`;

  // Пытаемся дать прямую ссылку (14д → 7д), если возможно
  if (audioPath && BUCKET) {
    let res = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(audioPath, FOURTEEN_DAYS);
    if (res.error) {
      console.warn('⚠️ createSignedUrl(14d) error:', res.error.message);
      res = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(audioPath, SEVEN_DAYS);
    }
    if (!res.error && res.data?.signedUrl) {
      audioUrl = res.data.signedUrl;
    } else {
      console.warn('⚠️ Переходим на redirect-audio ссылку (будет генерить on-demand)');
    }
  }

  return { audioUrl, base };
}

function buildHtmlMessage(feedback, { audioUrl, base }) {
  const {
    id,
    shop_id,
    device_id,
    is_anonymous,
    sentiment,
    emotion_score,
    tags = [],
    summary = '',
    transcript = '',
    timestamp,
  } = feedback || {};

  const title = pickTitle(sentiment, emotion_score);
  const critical = isCritical(sentiment, emotion_score) ? ' — <b>КРИТИЧНО</b>' : '';
  const scoreStr = fmtPercent01(emotion_score);

  const safeShop = htmlEscape(shop_id || '—');
  const safeDev  = htmlEscape(device_id || 'неизвестно');
  const safeAnon = is_anonymous ? 'Да' : 'Нет';
  const safeSent = htmlEscape(sentiment || '—');
  const safeTags = (Array.isArray(tags) && tags.length) ? htmlEscape(tags.join(', ')) : '—';
  const safeSum  = summary ? htmlEscape(summary) : '—';

  const fullUrl  = `${base}/feedback/full/${id}`;

  // короткая «превью»-расшифровка (до 240 символов, в одну строку)
  const preview = String(transcript || '').replace(/\s+/g, ' ').slice(0, 240);
  const safeTranscript = preview ? `\n<i>${htmlEscape(preview)}</i>` : '';

  return (
`<b>${htmlEscape(title)}</b>${critical}
Магазин: <b>${safeShop}</b>
Устройство: <b>${safeDev}</b>
Анонимно: <b>${safeAnon}</b>
Время: <i>${htmlEscape(timestamp || new Date().toISOString())}</i>

Оценка эмоций: <b>${safeSent}</b> (${scoreStr})
Теги: <b>${safeTags}</b>
Кратко: ${safeSum}

<a href="${htmlEscape(audioUrl)}">🎧 Слушать аудио</a> · <a href="${htmlEscape(fullUrl)}">📄 Детали/полная расшифровка</a>${safeTranscript}`
  );
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    const { audioUrl, base } = await makeAudioUrl(feedback);
    const msg = buildHtmlMessage(feedback, { audioUrl, base });

    // Поддержка нескольких chat_id через запятую/пробел
    const chatIds = String(CHAT_IDS_RAW)
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);

    let okCount = 0;
    for (const chatId of chatIds) {
      try {
        await bot.sendMessage(chatId, msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: '📄 Полная расшифровка', url: `${base}/feedback/full/${feedback.id}` }]]
          }
        });
        okCount++;
      } catch (e) {
        // Не валим весь алерт: логируем и идём дальше
        console.warn(`⚠️ Telegram sendMessage failed for chat ${chatId}:`, e?.message || e);
      }
    }

    if (okCount > 0) {
      console.log(`✅ Telegram alert отправлен (${okCount}/${chatIds.length})`);
    } else {
      console.warn('❌ Telegram alert не удалось отправить ни в один чат');
    }
  } catch (err) {
    // Больше никаких AggregateError — только понятное сообщение
    console.error('❌ Ошибка при отправке Telegram alert:', err?.message || err);
  }
}
