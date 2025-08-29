// aai_selftest.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { transcribeAudio } from './lib/transcriber.js';

const {
  ASSEMBLYAI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET
} = process.env;

if (!ASSEMBLYAI_API_KEY) {
  console.error('❌ ASSEMBLYAI_API_KEY не задан');
  process.exit(1);
}

const AUDIO_URL = process.env.AUDIO_URL || process.argv[2] || null;
const FEEDBACK_ID = process.env.FEEDBACK_ID || null;

const supa = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// попробуем сразу несколько бакетов
const BUCKET_CANDIDATES = Array.from(new Set(
  [SUPABASE_BUCKET, 'audio', 'feedback-audio'].filter(Boolean)
));

async function createSignedUrlAny(path) {
  let lastErr = null;
  for (const b of BUCKET_CANDIDATES) {
    try {
      const { data, error } = await supa.storage.from(b).createSignedUrl(path, 300);
      if (!error && data?.signedUrl) return data.signedUrl;
      lastErr = error?.message || 'unknown';
    } catch (e) {
      lastErr = e?.message || 'unknown';
    }
  }
  throw new Error(`Не удалось подписать файл в бакетах [${BUCKET_CANDIDATES.join(', ')}]: ${lastErr}`);
}

async function getSignedUrlFromDB() {
  if (!supa) return null;

  if (FEEDBACK_ID) {
    const { data, error } = await supa.from('feedbacks')
      .select('audio_path').eq('id', FEEDBACK_ID).single();
    if (!error && data?.audio_path) return await createSignedUrlAny(data.audio_path);
  }

  const { data: last, error: e1 } = await supa.from('feedbacks')
    .select('audio_path').not('audio_path','is',null)
    .order('timestamp',{ ascending: false }).limit(1).maybeSingle();
  if (!e1 && last?.audio_path) return await createSignedUrlAny(last.audio_path);

  return null;
}

async function getSignedUrlFromStorageList() {
  if (!supa) return null;
  for (const b of BUCKET_CANDIDATES) {
    try {
      const { data: list, error } = await supa.storage.from(b).list('uploads', {
        limit: 100, sortBy: { column: 'name', order: 'desc' }
      });
      if (!error && list?.length) {
        const first = list[0]?.name ? `uploads/${list[0].name}` : null;
        if (first) {
          const { data: s, error: se } = await supa.storage.from(b).createSignedUrl(first, 300);
          if (!se && s?.signedUrl) return s.signedUrl;
        }
      }
    } catch { /* пробуем следующий бакет */ }
  }
  return null;
}

(async () => {
  try {
    console.log('▶️ AAI self-test…');

    let url = AUDIO_URL;
    if (!url) {
      console.log('ℹ️ AUDIO_URL не задан — ищу аудио в Supabase…');
      url = await getSignedUrlFromDB() || await getSignedUrlFromStorageList();
    }
    if (!url) {
      console.error('❌ Не нашёл аудио. Залей отзыв через POST /feedback ИЛИ запусти так: AUDIO_URL="https://..." node aai_selftest.js');
      process.exit(2);
    }

    console.log('🔗 audio_url:', url);
    const res = await transcribeAudio(url, { pollIntervalMs: 3000, maxWaitMs: 180000 });

    const text = typeof res === 'string' ? res : res?.text || '';
    const analysis = typeof res === 'object' ? res.analysis : null;

    if (!text.trim()) {
      console.error('❌ Пустая расшифровка');
      process.exit(3);
    }

    console.log('📝 Текст (200):', text.replace(/\s+/g,' ').slice(0,200));
    if (analysis) {
      console.log('📊 Аналитика:', {
        sentiment: analysis.sentiment,
        emotion_score: analysis.emotion_score,
        tags: analysis.tags,
        summary: (analysis.summary || '').slice(0,120)
      });
    }
    console.log('✅ AAI self-test OK');
    process.exit(0);
  } catch (e) {
    console.error('🔥 Ошибка self-test:', e.message);
    process.exit(1);
  }
})();