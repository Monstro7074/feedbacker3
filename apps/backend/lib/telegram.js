// apps/backend/lib/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from './supabase.js';

const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BUCKET = process.env.SUPABASE_BUCKET;

function getBot() {
  if (!TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_TOKEN/TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы — отправка невозможна');
    return null;
  }
  return new TelegramBot(TOKEN, { polling: false });
}

/**
 * Выбор заголовка по эмоции/контенту
 * - sentiment: 'негатив' | 'позитив' | 'нейтральный' (или отсутствует)
 * - emotion_score: [0..1] (чем ниже — тем хуже)
 * - дополнительно ищем «красные» слова в summary/transcript
 */
function chooseTitle(feedback) {
  const s = String(feedback.sentiment || '').toLowerCase();
  const score = typeof feedback.emotion_score === 'number' ? feedback.emotion_score : null;
  const text = `${feedback.summary || ''} ${feedback.transcript || ''}`.toLowerCase();

  const RED_FLAGS = [
    'плохо', 'ужас', 'возврат', 'вернуть', 'жалоб', 'скандал', 'разочар', 'ненрав',
    'не нравится', 'слом', 'брак', 'качество', 'длинн', 'коротк', 'мал', 'велика'
  ];
  const hasRed = RED_FLAGS.some(w => text.includes(w));

  // Жёсткие правила по sentiment
  if (s.includes('негатив')) return '🚨 *Критичный отзыв!*';
  if (s.includes('позитив')) return '💚 *Положительный отзыв*';
  if (s.includes('нейтрал')) return '😐 *Нейтральный отзыв*';

  // Если sentiment не задан – fallback по score/контенту
  if (score !== null) {
    if (score < 0.45 || hasRed) return '🚨 *Критичный отзыв!*';
    if (score >= 0.7) return '💚 *Положительный отзыв*';
    return '😐 *Нейтральный отзыв*';
  }
  return hasRed ? '🚨 *Критичный отзыв!*' : '😐 *Нейтральный отзыв*';
}

function fmtScore(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toFixed(2);
}

/**
 * Примитивное экранирование Markdown (под формат parse_mode: 'Markdown')
 * Достаточно убрать символы, которые чаще всего ломают разметку.
 */
function md(s = '') {
  return String(s).replace(/(\*|_|\[|\]|\(|\)|`|>)/g, '\\$1');
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    // 1) Получаем одноразовую ссылку на аудио
    let audioPath = feedback.audio_path;
    if (!audioPath && feedback.audio_url) {
      // если кто-то сохранил публикуемую ссылку — вырежем путь внутри бакета
      audioPath = feedback.audio_url.replace(
        /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\//,
        ''
      );
    }

    let audioUrl = 'Нет ссылки';
    if (audioPath) {
      const { data: s, error: se } = await supabaseAdmin
        .storage.from(BUCKET)
        .createSignedUrl(audioPath, 60);
      if (!se && s?.signedUrl) audioUrl = s.signedUrl;
    }

    // 2) Короткая расшифровка (макс 4 строки)
    let transcriptBlock = '';
    if (feedback.transcript) {
      const lines = String(feedback.transcript).split('\n').map(l => l.trim()).filter(Boolean);
      const trimmed = lines.length > 4 ? [...lines.slice(0, 4), '…'] : lines;
      transcriptBlock = `\n🗣 *Расшифровка:*\n${md(trimmed.join('\n'))}`;
    }

    // 3) Заголовок
    const title = chooseTitle(feedback);

    // 4) Ссылка на полную карточку
    const base = process.env.FEEDBACK_API_URL || 'https://example.com';
    const fullTranscriptUrl = `${base}/feedback/full/${feedback.id}`;

    // 5) Тело сообщения (Markdown)
    const msg =
`${title}
*Магазин:* ${md(feedback.shop_id)}
*Устройство:* ${md(feedback.device_id || 'неизвестно')}
*Анонимно:* ${feedback.is_anonymous ? 'Да' : 'Нет'}
*Оценка эмоций:* ${fmtScore(feedback.emotion_score)}
*Теги:* ${md((feedback.tags || []).join(', ') || 'нет')}
*Краткое содержание:* ${md(feedback.summary || 'нет')}${transcriptBlock}

🎧 [Слушать аудио](${audioUrl})`;

    // 6) Отправляем ВСЕГДА (без порогов/условий)
    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: '📄 Полная расшифровка', url: fullTranscriptUrl }]]
      }
    });

    console.log('✅ Telegram alert отправлен');
  } catch (err) {
    console.error('❌ Ошибка при отправке Telegram alert:', err?.message || err);
  }
}
