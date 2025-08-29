// apps/backend/lib/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from './supabase.js';

const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BUCKET = process.env.SUPABASE_BUCKET;

function getBot() {
  if (!TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_TOKEN или TELEGRAM_CHAT_ID не заданы — алерты отключены');
    return null;
  }
  return new TelegramBot(TOKEN, { polling: false });
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    // находим путь к файлу в бакете
    let audioPath = feedback.audio_path;
    if (!audioPath && feedback.audio_url) {
      audioPath = feedback.audio_url.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\//, '');
    }

    let audioUrl = 'Нет ссылки';
    if (audioPath) {
      const { data: s, error: se } = await supabaseAdmin
        .storage.from(BUCKET)
        .createSignedUrl(audioPath, 60);
      if (!se && s?.signedUrl) audioUrl = s.signedUrl;
    }

    // короткая расшифровка (не более 4 строк)
    let transcriptText = '';
    if (feedback.transcript) {
      const lines = String(feedback.transcript).split('\n');
      transcriptText = `\n🗣 *Расшифровка:*\n` +
        (lines.length > 4 ? `${lines.slice(0, 4).join('\n')}…` : lines.join('\n'));
    }

    const base = process.env.FEEDBACK_API_URL || 'https://example.com';
    const fullTranscriptUrl = `${base}/feedback/full/${feedback.id}`;

    const msg =
`🚨 *Негативный отзыв!*
*Магазин:* ${feedback.shop_id}
*Устройство:* ${feedback.device_id || 'неизвестно'}
*Анонимно:* ${feedback.is_anonymous ? 'Да' : 'Нет'}
*Оценка эмоций:* ${feedback.emotion_score}
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
