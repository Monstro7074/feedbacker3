// apps/backend/lib/analysis.js
// Простая эвристика по русскому тексту: извлекаем теги и краткое резюме.

const TAG_DICTIONARY = [
  { tag: 'качество', patterns: ['качест', 'плохая ткан', 'тонкая ткан', 'шерст', 'синтет', 'шов', 'нитк', 'брак', 'разлез', 'рвётс', 'пил', 'комка'] },
  { tag: 'размер',   patterns: ['размер', 'великоват', 'маловат', 'сидит', 'посадк', 'узк', 'широк', 'длинн', 'коротк'] },
  { tag: 'материал', patterns: ['ткан', 'материал', 'хлопок', 'лен', 'лён', 'шерст', 'полиэстер', 'натурал', 'состав'] },
  { tag: 'цвет',     patterns: ['цвет', 'оттенок', 'выцвет', 'пятн'] },
  { tag: 'цена',     patterns: ['цена', 'дорог', 'дешев', 'стоимос', 'переплат'] },
  { tag: 'доставка', patterns: ['доставк', 'курьер', 'пункт выдач', 'самовывоз', 'привез', 'задерж', 'срок'] },
  { tag: 'сервис',   patterns: ['продавц', 'консультант', 'сотрудник', 'обслужив', 'поддержк', 'менеджер'] },
  { tag: 'возврат',  patterns: ['возврат', 'вернул', 'обмен', 'гарант'] },
  { tag: 'посадка',  patterns: ['сидит', 'посадк', 'облега', 'свободн', 'фасон', 'кро'] }
];

function detectTags(text) {
  const t = (text || '').toLowerCase();
  const tags = [];
  for (const entry of TAG_DICTIONARY) {
    if (entry.patterns.some(p => t.includes(p))) {
      tags.push(entry.tag);
    }
  }
  // Уберём дубликаты и ограничим 3–5 релевантными
  return Array.from(new Set(tags)).slice(0, 5);
}

// Простейший саммари: берём первое информативное предложение и чуть чистим
function summarize(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  // Разобьём на предложения
  const sentences = clean.split(/(?<=[\.\!\?])\s+/).filter(Boolean);
  // Выберем самое «насыщенное» (по длине и наличию ключевых слов)
  let best = sentences[0] || clean;
  let bestScore = 0;

  const keywords = ['ткан', 'сидит', 'размер', 'качест', 'цвет', 'дорог', 'достав', 'возврат'];
  sentences.forEach(s => {
    const sNorm = s.toLowerCase();
    const score = Math.min(s.length, 180) + keywords.reduce((acc, k) => acc + (sNorm.includes(k) ? 40 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  });

  // Ограничим длину, но оставим законченность
  let out = best.trim();
  if (out.length > 140) {
    out = out.slice(0, 137).trimEnd() + '…';
  }
  return out;
}

// Объединяющая функция, чтобы удобнее дергать из роутера
export function buildAnalysisFromTranscript(transcript) {
  const tags = detectTags(transcript);
  const summary = summarize(transcript);
  return { tags, summary };
}
