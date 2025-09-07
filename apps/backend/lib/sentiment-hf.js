// apps/backend/lib/sentiment-hf.js (ESM, Node 22+)
const API_BASE = 'https://api-inference.huggingface.co/models/';

function normalizeToEmotionScore(label, score) {
  // label -> 'положительный' | 'нейтральный' | 'негатив'
  // score — уверенность модели (0..1) по выбранному классу
  if (label.startsWith('полож')) return +(0.5 + 0.5 * (score ?? 0.9)).toFixed(2); // 0.5..1
  if (label.startsWith('нег'))  return +(0.5 - 0.5 * (score ?? 0.9)).toFixed(2); // 0..0.5
  return 0.50; // нейтраль
}

function mapRawLabelToRu(labelRaw) {
  const l = String(labelRaw || '').toLowerCase();
  if (l.includes('pos')) return 'положительный';
  if (l.includes('neg')) return 'негатив';
  return 'нейтральный';
}

export async function hfAnalyzeSentiment(text) {
  const token = process.env.HF_API_TOKEN;
  if (!token) throw new Error('HF_API_TOKEN is missing');

  const model = process.env.HF_MODEL_ID || 'blanchefort/rubert-base-cased-sentiment';
  const url = API_BASE + encodeURIComponent(model);

  const body = {
    inputs: String(text || '').slice(0, 4000), // лёгкая защита от очень длинных строк
    options: { wait_for_model: true }
  };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = Number(process.env.HF_TIMEOUT_MS || 10000);
  const tm = controller ? setTimeout(() => controller.abort(), t) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller?.signal
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HF ${res.status}: ${txt}`);
    }

    const data = await res.json();
    // Ответ может быть [ {label, score} ] или [ [ {label, score}, ... ] ]
    const arr = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : [];
    if (!arr.length) throw new Error('HF empty response');

    const top = arr.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const label = mapRawLabelToRu(top?.label);
    const emotion_score = normalizeToEmotionScore(label, top?.score);

    return { sentiment: label, emotion_score };
  } finally {
    if (tm) clearTimeout(tm);
  }
}
