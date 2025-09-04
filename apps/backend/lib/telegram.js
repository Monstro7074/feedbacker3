// apps/backend/lib/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from './supabase.js';

const TOKEN  = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BUCKET  = process.env.SUPABASE_BUCKET;

// Пороговые только для классификации, но не для блокировки отправки
const NEG_THRESHOLD = Number.parseFloat(String(process.env.TELEGRAM_ALERT_THRESHOLD ?? '0.4').replace(',', '.'));
const POS_THRESHOLD = Number.parseFloat(String(process.env.TELEGRAM_POSITIVE_THRESHOLD ?? '0.7').replace(',', '.'));

function getBot() {
  if (!TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_TOKEN/TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы — алерты отключены');
    return null;
  }
  return new TelegramBot(TOKEN, { polling: false });
}

function escapeHTML(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pickCategory(sentiment, score) {
  const s = (sentiment || '').toLowerCase();

  if (s.includes('негатив') || s.includes('negative')) return 'negative';
  if (s.includes('позитив') || s.includes('положит') || s.includes('positive')) return 'positive';
  if (s.includes('нейтр') || s.includes('neutral')) return 'neutral';

  if (typeof score === 'number' && !Number.isNaN(score)) {
    if (score < NEG_THRESHOLD) return 'negative';
    if (score >= POS_THRESHOLD) return 'positive';
  }
  return 'neutral';
}

function titleByCategory(cat) {
  switch (cat) {
    case 'negative': return '🚨 Критичный отзыв!';
    case 'positive': return 'Положительный отзыв';
    default:         return 'Нейтральный отзыв';
  }
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    // 1) Готовим ссылку на аудио (signed URL)
    let audioPath = feedback.audio_path;
    if (!audioPath && feedback.audio_url) {
      // если вдруг прислали публичный URL — пытаемся вытащить относительный путь
      audioPath = feedback.audio_url.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\//, '');
    }

    let audioUrl = null;
    if (audioPath) {
      const { data: s, error: se } = await supabaseAdmin
        .storage.from(BUCKET)
        .createSignedUrl(audioPath, 60);
      if (!se && s?.signedUrl) audioUrl = s.signedUrl;
    }

    // 2) Короткая расшифровка (макс. 4 строки / ~300 симв.)
    let transcriptBlock = '';
    if (feedback.transcript) {
      const raw = String(feedback.transcript);
      const short = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
      const lines = short.split('\n').slice(0, 4).join('\n');
      transcriptBlock = `\n\n🗣 <b>Расшифровка:</b>\n${escapeHTML(lines)}`;
    }

    // 3) Категория для заголовка
    const score = (typeof feedback.emotion_score === 'number')
      ? feedback.emotion_score
      : Number.parseFloat(feedback.emotion_score);

    const category = pickCategory(feedback.sentiment, score);
    const title = titleByCategory(category);

    // 4) Кнопки
    const base = process.env.FEEDBACK_API_URL
      || process.env.RENDER_EXTERNAL_URL
      || 'http://localhost:3000';
    const fullTranscriptUrl = `${base}/feedback/full/${feedback.id}`;

    const buttons = [
      [{ text: '📄 Полная расшифровка', url: fullTranscriptUrl }],
    ];
    if (audioUrl) {
      buttons[0].push({ text: '🎧 Слушать аудио', url: audioUrl });
    }

    // 5) Тело сообщения (HTML)
    const msg =
      `<b>${title}</b>\n` +
      `<b>Магазин:</b> ${escapeHTML(feedback.shop_id || '—')}\n` +
      `<b>Устройство:</b> ${escapeHTML(feedback.device_id || 'неизвестно')}\n` +
      `<b>Анонимно:</b> ${feedback.is_anonymous ? 'Да' : 'Нет'}\n` +
      `<b>Оценка эмоций:</b> ${Number.isFinite(score) ? score : '—'}\n` +
      `<b>Теги:</b> ${escapeHTML((feedback.tags || []).join(', ') || 'нет')}\n` +
      `<b>Краткое содержание:</b> ${escapeHTML(feedback.summary || 'нет')}` +
      `${transcriptBlock}`;

    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
      disable_web_page_preview: true,
    });

    console.log('✅ Telegram alert отправлен');
  } catch (err) {
    console.error('❌ Ошибка при отправке Telegram alert:', err?.response?.body |
