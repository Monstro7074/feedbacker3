// apps/backend/lib/sentiment-hf.js
// Надежный вызов Hugging Face Inference API с рабочими fallback-моделями и нормализацией меток.

const API_BASE = 'https://api-inference.huggingface.co/models/';

function getModelList() {
  const envModel = (process.env.HF_MODEL_ID || '').trim();
  const list = [];
  if (envModel) list.push(envModel);

  // Живые публичные модели (по приоритету):
  list.push('cointegrated/rubert-tiny2-russian-sentiment');   // RU sentiment
  list.push('cardiffnlp/twitter-xlm-roberta-base-sentiment'); // multilingual (Negative/Neutral/Positive)
  list.push('nlptown/bert-base-multilingual-uncased-sentiment'); // multilingual (1-5 stars)

  return Array.from(new Set(list.filter(Boolean)));
}

// Унификация разных схем меток в RU: положительный / нейтральный / негатив
function normalizeLabel(raw) {
  const l = String(raw || '').toLowerCase().trim();

  // cardiffnlp: "positive"/"neutral"/"negative"
  if (/(^|\W)pos(itive)?(\W|$)/.test(l)) return 'положительный';
  if (/(^|\W)neu(tral)?(\W|$)/.test(l))  return 'нейтральный';
  if (/(^|\W)neg(ative)?(\W|$)/.test(l)) return 'негатив';

  // nlptown: "1 star"..."5 stars"
  const m = l.match(/([1-5])\s*star/);
  if (m) {
    const stars = Number(m[1]);
    if (stars <= 2) return 'негатив';
    if (stars === 3) return 'нейтральный';
    return 'положительный';
  }

  // некоторые RU модели отдают "neutral", "positive", "negative" или на русском
  if (l.includes('полож')) return 'положительный';
  if (l.includes('нег'))   return 'негатив';
  if (l.includes('нейтр')) return 'нейтральный';

  // запасной вариант
  return 'нейтральный';
}

// Сведение к 0..1 (не критично для тебя, но оставим для графиков/порогов)
function toEmotionScore(label, score) {
  const conf = typeof score === 'number' ? Math.min(1, Math.max(0, score)) : 0.8;
  if (label.startsWith('полож')) return +(0.5 + 0.5 * conf).toFixed(2); // 0.5..1.0
  if (label.startsWith('нег'))   return +(0.5 - 0.5 * conf).toFixed(2); // 0.0..0.5
  return 0.50; // нейтральный
}

async function callModel(model, text, timeoutMs) {
  const token = process.env.HF_API_TOKEN;
  if (!token) throw new Error('HF_API_TOKEN is missing');

  const url = API_BASE + encodeURIComponent(model);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const tm = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Wait-For-Model': 'true'
      },
      body: JSON.stringify({
        inputs: String(text || '').slice(0, 4000),
        options: { wait_for_model: true }
      }),
      signal: controller?.signal
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`HF ${res.status}: ${txt || res.statusText}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    // Варианты: [ {label, score} ] или [ [ {label, score}, ... ] ]
    const arr = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : [];
    if (!arr.length) throw new Error('HF empty response');

    const top = arr.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const label = normalizeLabel(top?.label);
    const emotion_score = toEmotionScore(label, top?.score);

    return { label, emotion_score };
  } finally {
    if (tm) clearTimeout(tm);
  }
}

export async function hfAnalyzeSentiment(text) {
  const models = getModelList();
  const timeout = Number(process.env.HF_TIMEOUT_MS || 12000);

  let lastErr;
  for (const model of models) {
    try {
      const { label, emotion_score } = await callModel(model, text, timeout);
      console.log(`✅ HF sentiment ok via model: ${model} -> ${label} (${emotion_score})`);
      return { sentiment: label, emotion_score };
    } catch (e) {
      lastErr = e;
      if (e?.status === 404 || e?.status === 503) {
        console.warn(`⚠️ HF model ${model} responded ${e.status}. Trying next…`);
        continue;
      }
      console.warn(`⚠️ HF model ${model} error: ${e.message}. Trying next…`);
    }
  }
  throw lastErr || new Error('HF sentiment failed for all models');
}
