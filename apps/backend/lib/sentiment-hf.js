// apps/backend/lib/sentiment-hf.js
// Стабильный вызов Hugging Face Inference API с приоритетом рабочей модели,
// кэшированием удачной, нормализацией меток и быстрой деградацией.

const API_BASE = 'https://api-inference.huggingface.co/models/';
let lastGoodModel = null; // кэшируем удачную модель в памяти

function parseEnvList(name) {
  const v = (process.env[name] || '').trim();
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function getModelList() {
  // Позволяем задавать явный список через ENV (в приоритете)
  const explicit = parseEnvList('HF_MODEL_IDS');
  if (explicit.length) return explicit;

  // Ранее ты пробовал модели, что дают 404. Уберём их из дефолта.
  // Приоритет — стабильная многоязычная:
  return [
    'cardiffnlp/twitter-xlm-roberta-base-sentiment',      // multilingual, OK в логах
    'nlptown/bert-base-multilingual-uncased-sentiment'    // 1..5 stars → маппим в 3 класса
  ];
}

// Приводим разные схемы меток к RU: положительный / нейтральный / негатив
function normalizeLabel(raw) {
  const l = String(raw || '').toLowerCase();

  if (/(^|\W)pos(itive)?(\W|$)/.test(l) || l.includes('полож')) return 'положительный';
  if (/(^|\W)neu(tral)?(\W|$)/.test(l) || l.includes('нейтр'))  return 'нейтральный';
  if (/(^|\W)neg(ative)?(\W|$)/.test(l) || l.includes('нег'))   return 'негатив';

  // nlptown: "1 star"..."5 stars"
  const m = l.match(/([1-5])\s*star/);
  if (m) {
    const s = +m[1];
    if (s <= 2) return 'негатив';
    if (s === 3) return 'нейтральный';
    return 'положительный';
  }

  return 'нейтральный';
}

// Сводим к 0..1 (на графики и для совместимости с телегой)
function toEmotionScore(label, score) {
  const conf = typeof score === 'number' ? Math.min(1, Math.max(0, score)) : 0.8;
  if (label.startsWith('полож')) return +(0.5 + 0.5 * conf).toFixed(2);
  if (label.startsWith('нег'))   return +(0.5 - 0.5 * conf).toFixed(2);
  return 0.50;
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
  const timeout = Number(process.env.HF_TIMEOUT_MS || 6000);

  // Если уже знаем «хорошую» модель — пробуем её первой
  const baseList = getModelList();
  const models = lastGoodModel
    ? [lastGoodModel, ...baseList.filter(m => m !== lastGoodModel)]
    : baseList;

  let lastErr;
  for (const model of models) {
    try {
      const { label, emotion_score } = await callModel(model, text, timeout);
      lastGoodModel = model; // кэшируем удачную
      console.log(`✅ HF sentiment ok via model: ${model} -> ${label} (${emotion_score})`);
      return { sentiment: label, emotion_score };
    } catch (e) {
      lastErr = e;
      // тихо перескакиваем дальше на 404/503/аборт
      const code = e?.status;
      if (code) {
        console.warn(`⚠️ HF model ${model} responded ${code}. Trying next…`);
      } else {
        console.warn(`⚠️ HF model ${model} error: ${e.message || e}. Trying next…`);
      }
    }
  }
  throw lastErr || new Error('HF sentiment failed for all models');
}
