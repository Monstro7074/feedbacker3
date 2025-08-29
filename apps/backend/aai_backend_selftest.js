// aai_backend_selftest.js — self-test через твой backend
import 'dotenv/config';                  // <-- Главное: грузим .env
import fetch from 'node-fetch';
import { transcribeAudio } from './lib/transcriber.js';

const BASE = process.env.BASE || 'https://feedbacker-backend-34nw.onrender.com';
const SHOP = process.env.SHOP || 'shop_001';
const AUDIO_URL = process.env.AUDIO_URL || null;      // можно передать руками
const FEEDBACK_ID = process.env.FEEDBACK_ID || null;  // можно указать конкретный id

async function getSignedUrlById(id) {
  const r = await fetch(`${BASE}/feedback/get-audio/${id}`).catch(()=>null);
  if (!r || !r.ok) return null;
  const j = await r.json();
  return j?.signedUrl || null;
}

async function pickLatestSignedUrl() {
  if (FEEDBACK_ID) {
    const u = await getSignedUrlById(FEEDBACK_ID);
    if (u) return u;
  }
  // пробуем debug/list (быстро даёт id)
  let r = await fetch(`${BASE}/feedback/debug/list?shop_id=${encodeURIComponent(SHOP)}&limit=1`).catch(()=>null);
  if (r && r.ok) {
    const j = await r.json();
    const id = j?.items?.[0]?.id;
    if (id) {
      const u = await getSignedUrlById(id);
      if (u) return u;
    }
  }
  // fallback: «лёгкий» список
  r = await fetch(`${BASE}/feedback/${encodeURIComponent(SHOP)}?limit=1`).catch(()=>null);
  if (r && r.ok) {
    const arr = await r.json();
    const id = Array.isArray(arr) && arr[0]?.id;
    if (id) {
      const u = await getSignedUrlById(id);
      if (u) return u;
    }
  }
  return null;
}

(async () => {
  try {
    console.log('▶️ AAI backend self-test…');

    const ping = await fetch(`${BASE}/health`).catch(()=>null);
    if (!ping || !ping.ok) {
      console.error('❌ Backend недоступен:', BASE);
      process.exit(1);
    }

    let url = AUDIO_URL || await pickLatestSignedUrl();
    if (!url) {
      console.error('❌ Не нашёл аудио через backend. Сначала отправь отзыв (POST /feedback) или передай AUDIO_URL=...');
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
