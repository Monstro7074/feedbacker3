// apps/backend/routes/feedback.js
import { logger } from '../utils/logger.js';
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

import { transcribeAudio } from "../lib/transcriber.js";
// mockClaude оставляем на будущее, но не используем для тегов/резюме
import { mockClaude } from "../mock/claude.js";
import { supabase } from "../lib/supabase.js";
import { sendAlert } from "../lib/telegram.js";
import { uploadAudioToSupabase } from "../lib/storage.js";
import { hfAnalyzeSentiment } from "../lib/sentiment-hf.js";

const router = express.Router();

/** ---------- ensure uploads dir exists ---------- */
const UPLOAD_DIR = "uploads";
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* no-op */ }

/** ---------- Multer: storage + limits + fileFilter ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    cb(null, `audio-${Date.now()}${ext}`);
  },
});

const ALLOWED_MIME = new Set([
  "audio/mpeg", "audio/mp3",
  "audio/wav", "audio/x-wav",
  "audio/webm", "audio/ogg",
  "audio/mp4", "audio/x-m4a",
]);

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Недопустимый тип файла: ${file.mimetype}`));
  },
});

// Обёртка, чтобы ловить ошибки Multer красиво
const uploadAudio = (req, res, next) => {
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const map = {
        LIMIT_FILE_SIZE: "Файл слишком большой. Максимум 20MB.",
        LIMIT_FILE_COUNT: "Слишком много файлов. Разрешён 1.",
      };
      return res.status(400).json({ error: map[err.code] || err.message });
    }
    return res.status(400).json({ error: err.message });
  });
};

/* ---------------------- helpers: теги/саммари/красные флаги/эвристика ---------------------- */

// безопасное уникальное объединение
function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const k = String(x || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// «Юникодные границы слова»: вместо \b
function hasAnyWord(text, terms) {
  const t = String(text || '');
  for (const term of terms) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // (^|не-буква)(терм)(не-буква|$)
    const re = new RegExp(`(?:^|[^\\p{L}])(${esc})(?=$|[^\\p{L}])`, 'iu');
    if (re.test(t)) return true;
  }
  return false;
}

// краткая выжимка (1–2 предложения, ≤ 200 символов)
function buildSummary(text) {
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = original.split(/[.!?…]+/).map(s => s.trim()).filter(Boolean);
  const s = (parts.slice(0, 2).join('. ') || original).slice(0, 200);
  return s;
}

function extractTagsAndSummary(text) {
  const t = String(text || '').toLowerCase();
  const summary = buildSummary(text);

  // 1) канонические теги по домену + синонимы
  const rules = [
    { terms: ['сидит', 'сидят', 'посадка', 'садится', 'посадку', 'посадке'], tag: 'посадка' },
    { terms: ['размер', 'маломер', 'большемер'], tag: 'размер' },
    { terms: ['качество', 'брак', 'шов', 'швы', 'нитки', 'рвется', 'порвался', 'распоролось'], tag: 'качество' },
    { terms: ['цена', 'стоимость', 'дорого', 'дешево'], tag: 'цена' },
    { terms: ['доставка', 'курьер', 'срок', 'опоздал', 'опоздание'], tag: 'доставка' },
    { terms: ['персонал', 'сотрудник', 'продавец', 'консультант', 'грубо', 'хамство'], tag: 'персонал' },
    { terms: ['возврат', 'обмен'], tag: 'возврат/обмен' },
    { terms: ['материал', 'ткань', 'состав'], tag: 'материал' },
    { terms: ['цвет'], tag: 'цвет' },
    { terms: ['ассортимент', 'наличие'], tag: 'ассортимент' },
    { terms: ['удобно', 'удобный', 'комфорт'], tag: 'удобство' },
  ];

  const canonical = [];
  for (const r of rules) {
    if (hasAnyWord(t, r.terms)) canonical.push(r.tag);
  }

  // 2) частоты (фоллбек)
  const stop = new Set([
    'которые','который','которое','только','просто','можно','нужно','сильно','очень','сегодня','вчера',
    'буду','если','потому','вообще','конечно','давайте','бывает','были','будет','это','всё','все',
    'реально','правда','прям','ещё','там','здесь','вот','сами','само','сама','сам',
    'сидят','сидит','хорошо','плохо','совсем','слишком','такое','такой','так','же','как',
    'брюки','платье','джинсы','вещь','вещи','магазин','магазине','товар','покупка','клиент','покупатель',
  ]);

  const tokens = t
    .replace(/[^\p{L}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 5 && !stop.has(w));

  const freq = new Map();
  for (const w of tokens) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 5)
    .map(x => x[0]);

  let tags = uniq([...canonical, ...top]).slice(0, 3);

  // 3) гарантия непустых тегов: умные подстановки
  if (!tags.length) {
    if (hasAnyWord(t, ['сидит','сидят','посадка','садится'])) tags.push('посадка');
    if (hasAnyWord(t, ['размер','маломер','большемер'])) tags.push('размер');
    if (hasAnyWord(t, ['качество','брак','шов','швы','нитки'])) tags.push('качество');
  }
  tags = uniq(tags).slice(0, 3);

  return { tags, summary };
}

function detectRedFlags(text) {
  const t = String(text || '').toLowerCase();
  const patterns = [
    /не\s+очень/iu,
    /плохо\s+сидит/iu,
    /ужасн\w*/iu,
    /кошмар\w*/iu,
    /брак\w*/iu,
    /возврат\w*/iu,
    /обмен\w*/iu,
    /не\s*работа\w*/iu,
    /сломал\w*/iu,
    /грязн\w*/iu,
    /воня\w*|запах/iu,
    /обман\w*/iu,
    /груб\w*|хам\w*/iu,
    /очень\s+дорог/iu,
    /очень\s+долго/iu,
    /разочарован\w*/iu,
  ];

  let hits = 0;
  for (const r of patterns) if (r.test(t)) hits++;

  const addTags = [];
  if (/(возврат\w*|обмен\w*)/iu.test(t)) addTags.push('возврат/обмен');
  if (/(брак\w*|качест\w*)/iu.test(t)) addTags.push('качество');
  if (/(не\s*работа\w*|сломал\w*)/iu.test(t)) addTags.push('качество');
  if (/(груб\w*|хам\w*)/iu.test(t)) addTags.push('персонал');

  const isCritical = hits >= 1;
  return { isCritical, addTags: uniq(addTags) };
}

// простая эвристика сентимента для RU (без HF)
function heuristicSentimentRU(text) {
  const t = String(text || '').toLowerCase();

  const pos = ['отлично','супер','нравится','класс','хорошо','удобно','спасибо','люблю','рекомендую','понравилось','идеально','быстро'];
  const neg = ['плохо','ужасно','ненавижу','не нравится','дорого','долго','грубо','проблема','не работает','ужас','кошмар','разочарован','возврат','брак','грязно','воняет','запах','не очень','плохо сидит'];

  let p = 0, n = 0;
  for (const w of pos) if (t.includes(w)) p++;
  for (const w of neg) if (t.includes(w)) n++;

  let score = 0.5;
  if (p || n) score = Math.min(1, Math.max(0, 0.5 + (p - n) * 0.15));
  let sentiment = score > 0.6 ? 'позитив' : score < 0.4 ? 'негатив' : 'нейтральный';

  return { sentiment, emotion_score: Number(score.toFixed(2)) };
}

/** -------------------- ROUTES (порядок важен) -------------------- */

// 🆕 GET /feedback/full/:id
router.get("/full/:id", async (req, res) => {
  console.log("📌 [GET /feedback/full/:id]", req.params.id);
  try {
    const { data, error } = await supabase
      .from("feedbacks")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      console.error("❌ Отзыв не найден");
      return res.status(404).json({ error: "Отзыв не найден" });
    }
    console.log("✅ Отзыв найден:", data.id);
    return res.json({ status: "ok", feedback: data });
  } catch (err) {
    console.error("❌ Ошибка в GET /feedback/full/:id:", err.message);
    return res.status(500).json({ error: "Ошибка при получении фидбэка" });
  }
});

// 🎯 GET /feedback/get-audio/:id?ttl=1209600
router.get("/get-audio/:id", async (req, res) => {
  console.log("📌 [GET /feedback/get-audio/:id] ID:", req.params.id);
  try {
    const { data, error } = await supabase
      .from("feedbacks")
      .select("audio_path")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      console.error("❌ Фидбэк не найден:", error);
      return res.status(404).json({ error: "Фидбэк не найден" });
    }

    const requestedTtl = Number.parseInt(req.query.ttl || process.env.SIGNED_URL_TTL || "1209600", 10);
    // безопасные рамки: от 60 сек до 14 дней
    const ttl = Math.min(Math.max(requestedTtl || 60, 60), 1209600);

    const { data: s, error: se } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .createSignedUrl(data.audio_path, ttl);

    if (se) {
      console.error("❌ Ошибка создания signed URL:", se.message);
      return res.status(500).json({ error: "Не удалось создать signed URL" });
    }

    console.log(`🔐 Signed URL (${ttl} сек):`, s.signedUrl);
    return res.json({ signedUrl: s.signedUrl, ttl });
  } catch (err) {
    console.error("❌ Ошибка в GET /feedback/get-audio/:id:", err.message);
    return res.status(500).json({ error: "Ошибка при получении аудио" });
  }
});

// 🔁 GET /feedback/redirect-audio/:id — всегда работает, т.к. генерит URL на каждый клик
router.get("/redirect-audio/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("feedbacks")
      .select("audio_path")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).send("Not found");
    }

    // короткий TTL, т.к. редирект прямо сейчас
    const { data: s, error: se } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .createSignedUrl(data.audio_path, 300); // 5 минут

    if (se || !s?.signedUrl) {
      return res.status(500).send("Failed to sign");
    }

    return res.redirect(302, s.signedUrl);
  } catch (e) {
    return res.status(500).send("Internal error");
  }
});

// 📥 POST /feedback
router.post("/", uploadAudio, async (req, res) => {
  console.log("📌 [POST /feedback] Получен запрос");
  console.log("📦 req.body:", req.body);
  console.log("📦 req.file:", req.file);

  const tmpPath = req.file?.path;

  try {
    const { shop_id, device_id, is_anonymous } = req.body;

    if (!shop_id) {
      return res.status(400).json({ error: "shop_id обязателен" });
    }
    if (!tmpPath) {
      console.error("❌ Файл не загружен");
      return res.status(400).json({ error: "Аудио-файл не загружен" });
    }

    // 1️⃣ Загрузка в Supabase Storage
    console.log("⬆️ Загружаем файл в Supabase...");
    const uploaded = await uploadAudioToSupabase(tmpPath);
    if (!uploaded) {
      console.error("❌ Ошибка загрузки в Supabase");
      return res.status(500).json({ error: "Ошибка загрузки в Supabase Storage" });
    }
    console.log("✅ Загружено. storagePath:", uploaded.storagePath);
    console.log("🔐 Signed URL для AssemblyAI:", uploaded.signedUrl);

    // 2️⃣ Транскрибация
    console.log("📝 Отправляем в AssemblyAI на транскрипцию...");
    const raw = await transcribeAudio(uploaded.signedUrl);
    const transcript =
      typeof raw === "string" ? raw : (raw && typeof raw.text === "string" ? raw.text : "");

    const preview = (transcript || "").replace(/\s+/g, " ").slice(0, 80) + (transcript && transcript.length > 80 ? "…" : "");
    console.log("📝 Результат транскрипции (превью)", preview);

    if (!transcript || !transcript.trim()) {
      console.warn("⚠️ Пустая транскрипция");
      return res.status(400).json({ error: "Аудио не содержит речи или не распознано" });
    }

    // 3️⃣ Сентимент: HF (если есть ключ) → иначе локальная эвристика
    const hasHF = !!process.env.HUGGINGFACE_API_KEY;
    let analysisBase;
    if (hasHF) {
      try {
        analysisBase = await hfAnalyzeSentiment(transcript); // { sentiment: 'позитив|нейтральный|негатив', emotion_score: 0..1 }
      } catch (e) {
        console.warn("⚠️ HF sentiment failed, fallback to heuristic:", e.message);
        analysisBase = heuristicSentimentRU(transcript);
      }
    } else {
      console.warn("ℹ️ HF disabled (no HUGGINGFACE_API_KEY). Using heuristic sentiment.");
      analysisBase = heuristicSentimentRU(transcript);
    }

    // 4️⃣ Теги/саммари + эскалация критичных кейсов
    const { tags: tags0, summary } = extractTagsAndSummary(transcript);
    const flags = detectRedFlags(transcript);

    let sentiment = analysisBase.sentiment;
    let emotion_score = Number(analysisBase.emotion_score);

    if (flags.isCritical) {
      sentiment = 'негатив';
      emotion_score = Math.min(isFinite(emotion_score) ? emotion_score : 1, 0.35);
    }

    // итоговые теги: канонические + дополнения от флагов, максимум 3
    let tags = uniq([...tags0, ...flags.addTags]).slice(0, 3);
    // если вдруг пусто — жёсткий фоллбек
    if (!tags.length) {
      if (/размер/iu.test(transcript)) tags.push('размер');
      if (/сидит|сидят|посадк/iu.test(transcript)) tags.push('посадка');
      if (/качест|брак/iu.test(transcript)) tags.push('качество');
      if (!tags.length) tags = ['общее'];
    }

    const analysis = { sentiment, emotion_score, tags, summary };

    console.log("📊 Анализ (HF/heuristic + rules):", analysis);

    // 5️⃣ Сохраняем в БД
    const feedback = {
      id: uuidv4(),
      shop_id,
      device_id: device_id || null,
      is_anonymous: String(is_anonymous).toLowerCase() === "true",
      audio_path: uploaded.storagePath,
      transcript,
      timestamp: new Date().toISOString(),
      ...analysis,
    };

    feedback.emotion_score = Number.parseFloat(feedback.emotion_score);
    if (Number.isNaN(feedback.emotion_score)) feedback.emotion_score = null;

    console.log("💾 Сохраняем фидбэк в Supabase...");
    const { error: insertError } = await supabase.from("feedbacks").insert([feedback]);
    if (insertError) {
      console.error("❌ Ошибка записи в БД:", insertError);
      return res.status(500).json({ error: "Ошибка сохранения в базу" });
    }
    console.log("✅ Фидбэк сохранён:", feedback.id);

    // 6️⃣ Telegram Alert — ВСЕГДА отправляем (без порогов/условий)
    // sendAlert уже использует .tags/.summary/.sentiment из feedback
    console.log("🚨 Отправляем Telegram Alert (без условий)...");
    sendAlert(feedback).catch((e) => console.warn("⚠️ Telegram alert error:", e.message));

    return res.json({ status: "ok", feedback_id: feedback.id });
  } catch (err) {
    console.error("❌ Ошибка в POST /feedback:", err);
    return res.status(500).json({ error: "Ошибка при обработке фидбэка" });
  } finally {
    // 7️⃣ Чистим временный файл всегда
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
        console.log("🗑 Временный файл удалён");
      } catch (e) {
        console.warn("⚠️ Не удалось удалить временный файл:", e.message);
      }
    }
  }
});

// 🔎 GET /feedback/:shop_id?since=ISO&limit=50
router.get("/:shop_id", async (req, res) => {
  const shopId = req.params.shop_id;
  const since = req.query.since || "1970-01-01T00:00:00Z";
  const limit = Math.min(Number.parseInt(req.query.limit || "50", 10), 100);

  console.log("📌 [GET /feedback/:shop_id]", { shopId, since, limit });

  try {
    const { data, error } = await supabase
      .from("feedbacks")
      .select("id,timestamp,sentiment,emotion_score")
      .eq("shop_id", shopId)
      .gte("timestamp", since)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("❌ Ошибка выборки из БД:", error);
      return res.status(500).json({ error: "Ошибка выборки" });
    }
    console.log("Найдено отзывов:", data?.length || 0);
    return res.json(data || []);
  } catch (err) {
    console.error("❌ Ошибка в GET /feedback/:shop_id:", err.message);
    return res.status(500).json({ error: "Ошибка при получении ленты" });
  }
});

/** ================== DEBUG ROUTES ================== */

// GET /feedback/debug/list?shop_id=shop_001&limit=20&offset=0
router.get("/debug/list", async (req, res) => {
  try {
    const { shop_id, limit = 20, offset = 0 } = req.query;

    let q = supabase
      .from("feedbacks")
      .select("id,shop_id,device_id,timestamp,sentiment,emotion_score,audio_path")
      .order("timestamp", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (shop_id) q = q.eq("shop_id", shop_id);

    const { data, error } = await q;
    if (error) {
      console.error("❌ [debug/list] Supabase error:", error);
      return res.status(500).json({ error: "Ошибка выборки" });
    }

    return res.json({ status: "ok", count: data?.length || 0, items: data || [] });
  } catch (e) {
    console.error("❌ [debug/list] Error:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

// GET /feedback/debug/audit/:id
router.get("/debug/audit/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("feedbacks")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error("❌ [debug/audit] not found:", error);
      return res.status(404).json({ error: "Фидбэк не найден" });
    }

    let signedUrl = null;
    if (data.audio_path) {
      const { data: s, error: se } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .createSignedUrl(data.audio_path, 60);
      if (!se) signedUrl = s?.signedUrl || null;
      else console.warn("⚠️ [debug/audit] signed url error:", se.message);
    }

    const transcriptPreview = (data.transcript || "").replace(/\s+/g, " ").slice(0, 120);

    return res.json({
      status: "ok",
      id: data.id,
      shop_id: data.shop_id,
      device_id: data.device_id,
      timestamp: data.timestamp,
      sentiment: data.sentiment,
      emotion_score: data.emotion_score,
      tags: data.tags,
      summary: data.summary,
      audio_path: data.audio_path,
      transcript_preview: transcriptPreview,
      signed_url_60s: signedUrl,
    });
  } catch (e) {
    console.error("❌ [debug/audit] Error:", e);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
