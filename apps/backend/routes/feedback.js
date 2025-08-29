// apps/backend/routes/feedback.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

import { transcribeAudio } from "../lib/transcriber.js";
import { mockClaude } from "../mock/claude.js";
import { supabase } from "../lib/supabase.js";
import { sendAlert } from "../lib/telegram.js";
import { uploadAudioToSupabase } from "../lib/storage.js";

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

// 🎯 GET /feedback/get-audio/:id
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

    const { data: s, error: se } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .createSignedUrl(data.audio_path, 60);

    if (se) {
      console.error("❌ Ошибка создания signed URL:", se.message);
      return res.status(500).json({ error: "Не удалось создать signed URL" });
    }

    console.log("🔐 Signed URL (60 сек):", s.signedUrl);
    return res.json({ signedUrl: s.signedUrl });
  } catch (err) {
    console.error("❌ Ошибка в GET /feedback/get-audio/:id:", err.message);
    return res.status(500).json({ error: "Ошибка при получении аудио" });
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

    // 2️⃣ Транскрибация (нормализуем в строку)
   console.log("📝 Отправляем в AssemblyAI на транскрипцию+анализ...");
const raw = await transcribeAudio(uploaded.signedUrl);

// нормализуем в строку на все случаи (AAI может вернуть объект)
const transcript =
  typeof raw === 'string'
    ? raw
    : (raw && typeof raw.text === 'string' ? raw.text : '');

console.log("📝 Результат транскрипции:", (transcript || "").slice(0, 80) + "...");

if (!transcript || !transcript.trim()) {
  console.warn("⚠️ Пустая транскрипция");
  return res.status(400).json({ error: "Аудио не содержит речи или не распознано" });
}
    console.log("📝 Результат транскрипции:", transcript.replace(/\s+/g, " ").slice(0, 80) + "...");

    if (!transcript || !transcript.trim()) {
      console.warn("⚠️ Пустая транскрипция");
      return res.status(400).json({ error: "Аудио не содержит речи или не распознано" });
    }

    // 3️⃣ Анализ (пока mock — потом подключим боевой)
    const analysis = mockClaude(transcript);
    console.log("📊 Анализ:", analysis);

    // 4️⃣ Сохраняем в БД (spread кладём последним для надёжности)
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

    // 5️⃣ Telegram Alert (порог из ENV; поддержим и '0,6')
    const threshold = Number((process.env.TELEGRAM_ALERT_THRESHOLD || "0.4").toString().replace(",", "."));
    if (feedback.emotion_score !== null && feedback.emotion_score < threshold) {
      console.log("🚨 Отправляем Telegram Alert...");
      // не блокируем ответ
      sendAlert(feedback).catch((e) => console.warn("⚠️ Telegram alert error:", e.message));
    } else {
      console.log(`ℹ️ Alert не отправлен: emotion_score=${feedback.emotion_score}, threshold=${threshold}`);
    }

    return res.json({ status: "ok", feedback_id: feedback.id });
  } catch (err) {
    console.error("❌ Ошибка в POST /feedback:", err);
    return res.status(500).json({ error: "Ошибка при обработке фидбэка" });
  } finally {
    // 6️⃣ Чистим временный файл всегда
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

  console.log("📌 [GET /feedback/:shop_id]", shopId, "since=", since, "limit=", limit);

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
    console.log(`✅ Найдено отзывов: ${data?.length || 0}`);
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