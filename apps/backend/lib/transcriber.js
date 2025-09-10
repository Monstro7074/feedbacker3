// apps/backend/lib/transcriber.js
import { redactUrl, redactAny } from '../utils/logSafe.js';

/** простая эвристика для ru */
function heuristicRU(text) {
  const t = (text || '').toLowerCase();
  const pos = ['отлично','супер','нравится','класс','хорошо','удобно','спасибо','люблю','рекомендую','понравилось','идеально','быстро'];
  const neg = ['плохо','ужасно','ненавижу','не нравится','дорого','долго','грубо','проблема','не работает','ужас','кошмар','разочарование','возврат','брак','грязно'];
  let p = 0, n = 0;
  for (const w of pos) if (t.includes(w)) p++;
  for (const w of neg) if (t.includes(w)) n++;
  // 0..1, базово 0.5
  let score = 0.5;
  if (p || n) score = Math.min(1, Math.max(0, 0.5 + (p - n) * 0.15));
  const sentiment = score > 0.6 ? 'positive' : score < 0.4 ? 'negative' : 'neutral';

  // теги — топ-3 часто встречаемых слов длиной 5+, очень грубо
  const words = t.replace(/[^\p{L}\s]+/gu, ' ').split(/\s+/).filter(x => x.length >= 5);
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const tags = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);

  const summary = t.replace(/\s+/g, ' ').slice(0, 300);
  return { sentiment, emotion_score: Number(score.toFixed(2)), tags, summary };
}

// Оставляем mapAAI на всякий случай (на будущее), но больше не используем AAI-анализ.
function mapAAI(result) {
  return heuristicRU(result?.text || '');
}

async function createTranscript(payload) {
  // ВАЖНО: оставляем те же endpoint'ы, которые у тебя уже работают в проде
  const res = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * ТОЛЬКО транскрипт (без AAI sentiment/entity), анализ — нашей эвристикой.
 * Возвращает { text, analysis, raw }
 */
export async function transcribeAudio(
  audioUrl,
  { pollIntervalMs = 3000, maxWaitMs = 180000 } = {}
) {
  try {
    if (!process.env.ASSEMBLYAI_API_KEY) throw new Error('ASSEMBLYAI_API_KEY не задан');
    if (!audioUrl) throw new Error('audioUrl не указан');

    // ⛔️ Маскируем возможный token= в URL перед логом
    console.log('🎯 URL для AssemblyAI:', redactUrl(audioUrl));

    // Создаём задание БЕЗ sentiment_analysis / entity_detection — чтобы не ловить варнинг и ошибки
    const payload = {
      audio_url: audioUrl,
      language_code: 'ru',
      punctuate: true,
      format_text: true
    };

    const { ok, data } = await createTranscript(payload);
    if (!ok) throw new Error(`Ошибка создания транскрипта: ${data?.error || 'unknown'}`);

    const transcriptId = data.id;
    if (!transcriptId) throw new Error('Не получен transcript_id');
    console.log(`📡 AssemblyAI transcript_id: ${transcriptId}`);

    // Ожидание завершения
    const started = Date.now();
    let last = '';
    while (true) {
      if (Date.now() - started > maxWaitMs) throw new Error('Таймаут ожидания транскрибации');

      await new Promise(r => setTimeout(r, pollIntervalMs));

      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY || '' },
      });
      const js = await pollRes.json().catch(() => ({}));

      if (js.status !== last) { last = js.status; console.log('⌛ Статус транскрипции:', last); }

      if (js.status === 'completed') {
        const text = String(js.text || '');
        const analysis = heuristicRU(text); // базовый анализ — как и раньше
        console.log('📝 Расшифровка получена (120симв):', text.replace(/\s+/g,' ').slice(0,120), '...');
        return { text, analysis, raw: js };
      }
      if (js.status === 'error') throw new Error(`Ошибка транскрипции: ${js.error || 'unknown'}`);
    }
  } catch (err) {
    // ⛔️ Маскируем любые возможные URL/токены в сообщениях об ошибках
    console.error('❌ Ошибка в transcribeAudio:', redactAny(err?.message || err));
    return { text: '', analysis: heuristicRU(''), raw: null };
  }
}
