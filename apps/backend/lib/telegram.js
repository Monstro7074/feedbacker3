// apps/backend/lib/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from './supabase.js';

const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BUCKET = process.env.SUPABASE_BUCKET;

// желаемые значения
const FOURTEEN_DAYS = 14 * 24 * 60 * 60;     // 1209600 сек
const SEVEN_DAYS    = 7  * 24 * 60 * 60;     // 604800 сек

function getBot() {
  if (!TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_TOKEN или TELEGRAM_CHAT_ID не заданы — алерты отключены');
    return null;
  }
  return new TelegramBot(TOKEN, { polling: false });
}

function pickTitle(sentiment, summary = '') {
  const s = String(sentiment || '').toLowerCase();
  if (s.includes('негатив') || s.includes('negative')) return '🚨 Критичный отзыв!';
  if (s.includes('полож')   || s.includes('positive')) return '💚 Положительный отзыв';
  return '😐 Нейтральный отзыв';
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    // Путь к файлу в бакете
    let audioPath = feedback.audio_path;
    if (!audioPath && feedback.audio_url) {
      audioPath = feedback.audio_url.replace(
        /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\//,
        ''
      );
    }

    const base = process.env.FEEDBACK_API_URL || 'https://example.com';

    // По умолчанию используем «вечную» ссылку через редирект-эндпоинт
    let audioUrl = `${base}/feedback/redirect-audio/${feedback.id}`;

    // Пытаемся дать прямую ссылку на 14 дней (если провайдер разрешит)
    if (audioPath) {
      // сначала пробуем 14 дней
      let res = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(audioPath, FOURTEEN_DAYS);
      if (res.error) {
        // часто у Supabase лимит 7 дней — пробуем 7 дней
        console.warn('⚠️ createSignedUrl(14d) error:', res.error.message);
        res = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(audioPath, SEVEN_DAYS);
      }
      if (!res.error && res.data?.signedUrl) {
        audioUrl = res.data.signedUrl;
      } else {
        // оставляем редирект — он на каждый клик создаст свежий URL
        console.warn('⚠️ Переходим на redirect-audio ссылку (будет генерить on-demand)');
      }
    }

    // короткая расшифровка (до 4 строк)
    let transcriptText = '';
    if (feedback.transcript) {
      const lines = String(feedback.transcript).split('\n');
      transcriptText =
        '\n🗣 *Расшифровка:*\n' +
        (lines.length > 4 ? `${lines.slice(0, 4).join('\n')}…` : lines.join('\n'));
    }

    const fullTranscriptUrl = `${base}/feedback/full/${feedback.id}`;
    const title = pickTitle(feedback.sentiment, feedback.summary);

    const msg =
`${title}
*Магазин:* ${feedback.shop_id}
*Устройство:* ${feedback.device_id || 'неизвестно'}
*Анонимно:* ${feedback.is_anonymous ? 'Да' : 'Нет'}
*Оценка эмоций:* ${feedback.emotion_score ?? '—'}
*Теги:* ${feedback.tags?.join(', ') || 'нет'}
*Краткое содержание:* ${feedback.summary || 'нет'}${transcriptText}

🎧 [Слушать аудио](${audioUrl})`;

    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '📄 Полная расшифровка', url: fullTranscriptUrl }]]
      }
    });

    console.log('✅ Telegram alert отправлен');
  } catch (err) {
    console.error('❌ Ошибка при отправке Telegram alert:', err.message);
  }
}
