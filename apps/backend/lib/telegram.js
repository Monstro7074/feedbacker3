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

function parseNumber(str, def) {
  const n = Number((str ?? '').toString().replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

function classify(feedback) {
  const scoreRaw = feedback?.emotion_score;
  const score = typeof scoreRaw === 'number' ? scoreRaw : parseFloat(scoreRaw);
  const sentiment = String(feedback?.sentiment || '').toLowerCase();

  const crit = parseNumber(process.env.TELEGRAM_ALERT_THRESHOLD, 0.4);   // score < crit → Критичный
  const posT = parseNumber(process.env.TELEGRAM_POSITIVE_THRESHOLD, 0.7); // score >= posT → Положительный

  let title = 'Нейтральный отзыв';
  // Сначала по score, если есть:
  if (Number.isFinite(score)) {
    if (score < crit) title = '🚨 Критичный отзыв!';
    else if (score >= posT) title = 'Положительный отзыв';
    else title = 'Нейтральный отзыв';
  } else {
    // Фолбэк по текстовой тональности
    if (['negative', 'негатив'].includes(sentiment)) title = '🚨 Критичный отзыв!';
    else if (['positive', 'позитив'].includes(sentiment)) title = 'Положительный отзыв';
  }

  return {
    title,
    score: Number.isFinite(score) ? score : null,
    thresholds: { critical: crit, positive: posT },
  };
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    // 1) Найдём путь к файлу в бакете → сделаем signed URL
    let audioPath = feedback?.audio_path;
    if (!audioPath && feedback?.audio_url) {
      // вытащим относительный путь из публичного URL
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

    // 2) Заголовок и пороги
    const { title, score, thresholds } = classify(feedback);

    // 3) Короткая расшифровка (до 4 строк)
    let transcriptText = '';
    if (feedback?.transcript) {
      const lines = String(feedback.transcript).trim().split('\n');
      transcriptText =
        '\n🗣 *Расшифровка:*\n' +
        (lines.length > 4 ? `${lines.slice(0, 4).join('\n')}…` : lines.join('\n'));
    }

    // 4) Ссылка на полную расшифровку (через ваш backend)
    const base = process.env.FEEDBACK_API_URL || 'https://example.com';
    const fullTranscriptUrl = `${base}/feedback/full/${feedback.id}`;

    const tags = Array.isArray(feedback?.tags) ? feedback.tags.join(', ') : 'нет';
    const summary = feedback?.summary || 'нет';
    const device = feedback?.device_id || 'неизвестно';
    const shop = feedback?.shop_id || '—';

    const scoreLine = score === null
      ? '*Оценка эмоций:* нет'
      : `*Оценка эмоций:* ${score} (критич. < ${thresholds.critical}, полож. ≥ ${thresholds.positive})`;

    const msg =
`${title}
*Магазин:* ${shop}
*Устройство:* ${device}
*Анонимно:* ${feedback?.is_anonymous ? 'Да' : 'Нет'}
${scoreLine}
*Теги:* ${tags}
*Краткое содержание:* ${summary}${transcriptText}

🎧 [Слушать аудио](${audioUrl})`;

    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '📄 Полная расшифровка', url: fullTranscriptUrl }]],
      },
    });

    console.log('✅ Telegram alert отправлен');
  } catch (err) {
    console.error('❌ Ошибка при отправке Telegram alert:', err?.message || err);
  }
}
