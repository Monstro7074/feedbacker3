// apps/backend/routes/admin.js
import express from 'express';
import path from 'path';
import { supabase, supabaseAdmin } from '../lib/supabase.js';
import { getSetting, setSetting } from '../lib/settings.js';

const router = express.Router();

/**
 * Абсолютный путь к папке админки.
 * Процесс запускается из apps/backend, поэтому public лежит рядом.
 */
const ADMIN_DIR = path.join(process.cwd(), 'public', 'admin');

/** -------------------- Статика и индекс -------------------- */

// Отдаём статику (admin.js, admin.css, картинки) по /admin/*
router.use(express.static(ADMIN_DIR));

// Главная страница админки (SPA на чистом HTML/JS)
router.get('/', (_req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'index.html'));
});

/** -------------------- Auth для API -------------------- */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'ADMIN_TOKEN';

function adminAuth(req, res, next) {
  const t = req.header('x-admin-token') || req.query.token || '';
  if (t && t === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

/** ============================================================
 *                      API (префикс /api)
 *  Все ниже лежащие маршруты соответствуют вызовам фронта:
 *  - GET    /admin/api/settings
 *  - PUT    /admin/api/settings
 *  - GET    /admin/api/feedbacks
 *  - GET    /admin/api/feedback/:id
 *  - POST   /admin/api/annotate
 *  - GET    /admin/api/export
 * ============================================================ */

/* -------------------- SETTINGS -------------------- */

// Читать настройки
router.get('/api/settings', adminAuth, async (_req, res) => {
  const fallback = String(Number.parseFloat(process.env.TELEGRAM_ALERT_THRESHOLD || '0.4'));
  const val = await getSetting('TELEGRAM_ALERT_THRESHOLD', fallback);
  res.json({ TELEGRAM_ALERT_THRESHOLD: val });
});

// Сохранить настройки (PUT, как в логах браузера)
router.put('/api/settings', adminAuth, express.json(), async (req, res) => {
  try {
    const { TELEGRAM_ALERT_THRESHOLD } = req.body || {};
    if (TELEGRAM_ALERT_THRESHOLD == null) {
      return res.status(400).json({ error: 'TELEGRAM_ALERT_THRESHOLD is required' });
    }
    await setSetting('TELEGRAM_ALERT_THRESHOLD', String(TELEGRAM_ALERT_THRESHOLD));
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'settings error' });
  }
});

/* -------------------- LIST / CARD -------------------- */

// Лента отзывов (для таблицы): GET /admin/api/feedbacks
router.get('/api/feedbacks', adminAuth, async (req, res) => {
  const {
    shop_id = '',
    sentiment = '',
    limit = '20',
    offset = '0',
  } = req.query;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  let q = supabase
    .from('feedbacks')
    .select('id,timestamp,shop_id,device_id,sentiment,emotion_score,tags,summary')
    .order('timestamp', { ascending: false })
    .range(off, off + lim - 1);

  if (shop_id) q = q.eq('shop_id', shop_id);
  if (sentiment) q = q.eq('sentiment', sentiment);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ items: data || [], nextOffset: (data?.length || 0) === lim ? off + lim : null });
});

// Карточка отзыва (для модалки): GET /admin/api/feedback/:id
router.get('/api/feedback/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('feedbacks')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'not found' });

  const annQ = await supabase
    .from('feedback_annotations')
    .select('*')
    .eq('feedback_id', req.params.id)
    .limit(1);

  const annotation = (annQ.data && annQ.data[0]) ? annQ.data[0] : null;
  res.json({ item: data, annotation });
});

/* -------------------- ANNOTATE (теги/заметка) -------------------- */

// POST /admin/api/annotate  { feedback_id, tags?, note? }
router.post('/api/annotate', adminAuth, express.json(), async (req, res) => {
  const { feedback_id, tags, note } = req.body || {};
  if (!feedback_id) return res.status(400).json({ error: 'feedback_id required' });

  const toSave = {
    feedback_id,
    updated_at: new Date().toISOString(),
    updated_by: 'admin',
  };
  if (tags !== undefined) toSave.tags = Array.isArray(tags) ? tags : [];
  if (note !== undefined) toSave.note = String(note || '');

  const { error } = await supabaseAdmin
    .from('feedback_annotations')
    .upsert(toSave, { onConflict: 'feedback_id' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: 'ok' });
});

/* -------------------- EXPORT CSV -------------------- */

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows) {
  if (!rows?.length) return 'id,timestamp,shop_id,device_id,sentiment,emotion_score,tags,summary,manager_tags,manager_note\n';
  const head = Object.keys(rows[0]);
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push(head.map(k => csvEscape(r[k])).join(','));
  }
  return lines.join('\n');
}

// GET /admin/api/export?shop_id=&limit=
router.get('/api/export', requireAdmin, async (req, res) => {
  try {
    const shopId = (req.query.shop_id || '').trim();
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));

    let q = supabase
      .from('feedbacks')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (shopId) q = q.eq('shop_id', shopId);

    const { data, error } = await q;
    if (error) return res.status(500).send('db error');

    const rows = data || [];
    // CSV: заголовок
    const head = [
      'id','timestamp','shop_id','device_id','sentiment','emotion_score',
      'tags','summary','audio_path'
    ].join(',');

    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    };

    const body = rows.map(r => [
      r.id,
      r.timestamp,
      r.shop_id,
      r.device_id ?? '',
      r.sentiment ?? '',
      r.emotion_score ?? '',
      Array.isArray(r.tags) ? r.tags.join('|') : '',
      r.summary ?? '',
      r.audio_path ?? ''
    ].map(escape).join(','));

    const csv = [head, ...body].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    res.setHeader('Content-Disposition', `attachment; filename="feedback_${shopId || 'all'}_${ts}.csv"`);
    return res.status(200).send(csv);
  } catch (e) {
    console.error('export error', e);
    return res.status(500).send('internal error');
  }
});
