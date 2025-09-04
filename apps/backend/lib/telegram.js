// apps/backend/lib/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from './supabase.js';

const TOKEN   = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const BUCKET  = process.env.SUPABASE_BUCKET || '';

/** HTML-эскейп для безопасной разметки в Telegram */
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getBot() {
  if (!TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN/TELEGRAM_TOKEN или TELEGRAM_CHAT_ID не заданы — алерты отключены');
    return null;
  }
  return new TelegramBot(TOKEN, { polling: false });
}

/** Пытаемся получить signed URL; если не вышло — публичный URL (если бакет публичный) */
async function getAudioUrl(audioPath) {
  if (!audioPath || !BUCKET) return null;

  // 1) пробуем signed URL (если есть supabaseAdmin)
  if (supabaseAdmin?.storage) {
    try {
      const { data: s, error: se } = await supabaseAdmin
        .storage.from(BUCKET)
        .createSignedUrl(audioPath, 60);
      if (!se && s?.signedUrl) return s.signedUrl;
    } catch (e) {
      console.warn('⚠️ createSignedUrl error:', e?.message || e);
    }
  }

  // 2) fallback на public URL
  try {
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(audioPath);
    if (data?.publicUrl) return data.publicUrl;
  } catch (e) {
    console.warn('⚠️ getPublicUrl error:', e?.message || e);
  }
  return null;
}

/** Аккуратно вытаскиваем storage path из возможного «полного» URL */
function extractAudioPath(maybeUrl) {
  if (!maybeUrl) return null;

  // если уже выглядит как путь в бакете — возвращаем как есть
  if (!/^https?:\/\//i.test(maybeUrl)) return maybeUrl;

  // типичные варианты публичных/подписанных ссылок Supabase
  // …/storage/v1/object/(sign|public)/<bucket>/<path>
  const m = maybeUrl.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/);
  if (m) {
    const [, bucket, path] = m;
    if (!BUCKET || BUCKET === bucket) return path;
  }
  return null;
}

export async function sendAlert(feedback) {
  const bot = getBot();
  if (!bot) return;

  try {
    // --- аудио-ссылка ---
    let audioPath = feedback.audio_path
      || extractAudioPath(feedback.audio_url)
      || null;

    let audioUrl = await getAudioUrl(audioPath);
    if (!audioUrl) audioUrl = 'https://example.com'; // безопасный заглушечный URL

    // --- превью транскрипта (макс 4 строки / 500 символов) ---
    let transcriptText = '';
    if (feedback.transcript) {
      const raw = String(feedback.transcript).trim();
      const fourLines = raw.split('\n').slice(0, 4).join('\n');
      const cut = fourLines.length > 500 ? `${fourLines.slice(0, 500)}…` : fourLines;
      transcriptText = `\n🗣 <b>Расшифровка:</b>\n${esc(cut)}`;
    }

    const baseApi = process.env.FEEDBACK_API_URL || '';
    const fullTranscriptUrl = baseApi
      ? `${baseApi.replace(/\/+$/, '')}/feedback/full/${encodeURIComponent(feedback.id)}`
      : null;

    const msgParts = [
      '🚨 <b>Негативный отзыв!</b>',
      `<b>Магазин:</b> ${esc(feedback.shop_id)}`,
      `<b>Устройство:</b> ${esc(feedback.device_id || 'неизвестно')}`,
      `<b>Анонимно:</b> ${feedback.is_anonymous ? 'Да' : 'Нет'}`,
      `<b>Оценка эмоций:</b> ${feedback.emotion_score ?? '—'}`,
      `<b>Теги:</b> ${esc(Array.isArray(feedback.tags) ? feedback.tags.join(', ') : (feedback.tags || 'нет'))}`,
      `<b>Краткое содержание:</b> ${esc(feedback.summary || 'нет')}`,
      transcriptText,
      `\n🎧 <a href="${esc(audioUrl)}">Слушать аудио</a>`
    ];

    const msg = msgParts.filter(Boolean).join('\n');

    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: 'HTML',
      reply_markup: fullTranscriptUrl
        ? { inline_keyboard: [[{ text: '📄 Полная расшифровка', url: fullTranscriptUrl }]] }
        : undefined,
      disable_web_page_preview: true,
    });

    console.log('✅ Telegram alert отправлен');
  } catch (err) {
    console.error('❌ Ошибка при отправке Telegram alert:', err?.message || err);
  }
}
