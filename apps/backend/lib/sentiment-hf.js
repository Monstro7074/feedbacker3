// apps/backend/lib/sentiment-hf.js
// Надёжный вызов Hugging Face Inference API с fallback-моделями и понятным логированием.

const API_BASE = 'https://api-inference.huggingface.co/models/';

// Модели по приоритету: сначала из ENV, затем хорошие публичные RU-модели
function getModelList() {
  const envModel = (process.env.HF_MODEL_ID || '').trim();
  const list = [];
  if (envModel) list.push(envModel);

  // Резерв 1: классическая трёхклассовая
  list.push('blanchefort/rubert-base-cased-sentiment');
  // Резерв 2: ещё одна популярная RU sentiment модель
  list.push('sismetanin/ru-sentiment-bert');
  // Можно добавить свои опции ниже при необходимости

  // Убираем дубликаты, пустые
  return Array.from(new Set(list.filter(Boolean)));
}

// EN/RU -> RU метка
function mapLabelToRu(labelRaw) {
  const l = String(labelRaw || '').toLowerCase();
  if (l.includes('pos') || l.includes('полож')) return 'положительный';
  if (l.includes('neg') || l.includes('нег'))   return 'негатив';
  return 'нейтральный';
}

// Нормализация в emotion_score 0..1
function toEmotionScore(label, score) {
  const s = typeof score === 'number' ? Math.min(1, Math.max(0, score)) : 0.9;
  if (label.startsWith('полож')) return +(0.5 + 0.5 * s).toFixed(2); // 0.5..1
  if (label.startsWith('нег'))   return +(0.5 - 0.5 * s).toFixed(2); // 0..0.5
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
        // Дополнительно даём хедер «ждать подгрузку модели»
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
      // Пробрасываем статус и часть текста, чтобы верхний уровень понял тип ошибки
      const err = new Error(`HF ${res.status}: ${txt || res.statusText}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    // Ответ бывает в двух форматах: [ {label, score} ] или [ [ {label, score}, ... ] ]
    const arr = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : [];
    if (!arr.length) throw new Error('HF empty response');

    // берём самую уверенную
    const top = arr.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const label = mapLabelToRu(top?.label);
    const emotion_score = toEmotionScore(label, top?.score);

    return { label, emotion_score };
  } finally {
    if (tm) clearTimeout(tm);
  }
}

export async function hfAnalyzeSentiment(text) {
  const models = getModelList();
  const timeout = Number(process.env.HF_TIMEOUT_MS || 10000);

  let lastErr;
  for (const model of models) {
    try {
      const { label, emotion_score } = await callModel(model, text, timeout);
      // полезный лог для диагностики — какую модель реально использовали
      console.log(`✅ HF sentiment ok via model: ${model} -> ${label} (${emotion_score})`);
      return { sentiment: label, emotion_score };
    } catch (e) {
      lastErr = e;
      // Если типичная история: 404 (модель не найдена/приватна) или 503 (прогрев)
      if (e?.status === 404 || e?.status === 503) {
        console.warn(`⚠️ HF model ${model} responded ${e.status}. Trying next…`);
        continue; // пробуем следующую модель
      }
      // Прочие ошибки тоже пробуем перебороть следующей моделью
      console.warn(`⚠️ HF model ${model} error: ${e.message}. Trying next…`);
    }
  }

  // Если все варианты не сработали — отдаём контроль наверх
  throw lastErr || new Error('HF sentiment failed for all models');
}
