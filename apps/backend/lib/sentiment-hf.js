// apps/backend/lib/sentiment-hf.js
// Мини-клиент к Hugging Face Inference API с очередью моделей и нормализацией 0..1

const HF_URL = 'https://api-inference.huggingface.co/models';

const MODELS = [
  // СТАВИМ ПЕРВЫМ тот, что у тебя стабильно срабатывает
  { id: 'nlptown/bert-base-multilingual-uncased-sentiment', type: 'stars5' },
  // Потом — xlm-roberta (бывает абортится по таймауту)
  { id: 'cardiffnlp/twitter-xlm-roberta-base-sentiment', type: '3class' },
];

const DEFAULT_TIMEOUT_MS = 8000; // небольшой таймаут на модель, чтобы быстро переключаться

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return Promise.race([
    promise(ctrl.signal).finally(() => clearTimeout(t)),
    // на всякий: чтобы не висеть навсегда
  ]);
}

async function callHF(modelId, text, signal) {
  const key = process.env.HUGGINGFACE_API_KEY || '';
  if (!key) throw new Error('HUGGINGFACE_API_KEY не задан');

  const res = await fetch(`${HF_URL}/${encodeURIComponent(modelId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: text,
      options: {
        wait_for_model: true, // критично: грузим модель и ждём
        use_cache: true,
      },
    }),
    signal,
  });

  // HF иногда отдаёт 503/524 на тёплый старт — дадим модели секунду и повторим 1 раз
  if (res.status === 503 || res.status === 524) {
    await sleep(1000);
    return callHF(modelId, text, signal);
  }

  if (!res.ok) {
    const msg = await res.text().catch(() => `${res.statusText}`);
    throw new Error(`HF ${res.status}: ${msg}`);
  }
  return res.json();
}

function normalizeFromStars5(output) {
  // Формат: массив массивов с метками "1 star" .. "5 stars"
  // Возьмём взвешенное среднее и нормализуем к [0..1] как «позитивность».
  // Потом переведём в 3 класса.
  const arr = Array.isArray(output) ? output[0] : output;
  if (!Array.isArray(arr)) throw new Error('Unexpected HF output (stars5)');

  // {label: "5 stars", score: 0.72}, ...
  let sum = 0, weight = 0;
  for (const it of arr) {
    const m = String(it.label || '').match(/(\d)/);
    if (!m) continue;
    const stars = Number(m[1]);
    sum += stars * (it.score || 0);
    weight += (it.score || 0);
  }
  const avgStars = weight > 0 ? sum / weight : 3; // среднее по вероятностям
  const positivity = Math.max(0, Math.min(1, (avgStars - 1) / 4)); // 1..5 → 0..1

  const sentiment = positivity > 0.6 ? 'позитив' : positivity < 0.4 ? 'негатив' : 'нейтральный';
  // В твоей схеме emotion_score = 0..1 (оставим как «позитивность»)
  return { sentiment, emotion_score: Number(positivity.toFixed(2)) };
}

function normalizeFrom3class(output) {
  // Формат: [{label:"positive",score:..},{label:"neutral",...},{label:"negative",...}]
  const arr = Array.isArray(output) ? output[0] : output;
  if (!Array.isArray(arr)) throw new Error('Unexpected HF output (3class)');

  const by = {};
  for (const it of arr) by[String(it.label).toLowerCase()] = it.score || 0;

  const pos = by.positive || by.pos || 0;
  const neu = by.neutral || 0;
  const neg = by.negative || by.neg || 0;

  let sentiment = 'нейтральный';
  if (pos >= neg && pos >= neu) sentiment = 'позитив';
  else if (neg >= pos && neg >= neu) sentiment = 'негатив';

  // emotion_score — возьмём «позитивность» = pos (или 1-neg), усредним для устойчивости:
  const positivity = Math.max(0, Math.min(1, (pos + (1 - neg)) / 2));
  return { sentiment, emotion_score: Number(positivity.toFixed(2)) };
}

export async function hfAnalyzeSentiment(text) {
  if (!text || !text.trim()) return { sentiment: 'нейтральный', emotion_score: 0.5 };

  let lastErr;
  for (const m of MODELS) {
    try {
      const out = await withTimeout(
        (signal) => callHF(m.id, text, signal),
        DEFAULT_TIMEOUT_MS
      );
      if (m.type === 'stars5') return normalizeFromStars5(out);
      if (m.type === '3class') return normalizeFrom3class(out);
      throw new Error('Unknown model type');
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (/aborted/i.test(msg)) {
        console.warn(`⚠️ HF model ${m.id} aborted by timeout. Trying next…`);
      } else {
        console.warn(`⚠️ HF model ${m.id} error: ${msg}. Trying next…`);
      }
      continue;
    }
  }
  throw lastErr || new Error('HF: all models failed');
}
