// apps/backend/routes/admin.js
import express from 'express';
import path from 'path';
import { supabase } from '../lib/supabase.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getSetting, setSetting, getSettingNumber } from '../lib/settings.js';

const router = express.Router();

// Абсолютный путь к папке админки
const ADMIN_DIR = path.join(process.cwd(), 'public', 'admin');

// Отдаём статику (admin.js, css, картинки) по /admin/*
router.use(express.static(ADMIN_DIR));

// Главная страница админки
router.get('/', (_req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'index.html'));
});

export default router;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'ADMIN_TOKEN';

function adminAuth(req, res, next) {
  const t = req.header('x-admin-token') || req.query.token || '';
  if (t && t === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

/* ================= SETTINGS ================= */

router.get('/settings', adminAuth, async (_req, res) => {
  const fallback = String(Number.parseFloat(process.env.TELEGRAM_ALERT_THRESHOLD || '0.4'));
  const val = await getSetting('TELEGRAM_ALERT_THRESHOLD', fallback);
  res.json({ TELEGRAM_ALERT_THRESHOLD: val });
});

router.post('/settings', adminAuth, express.json(), async (req, res) => {
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

/* ================= LIST / CARD ================= */

router.get('/list', adminAuth, async (req, res) => {
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

router.get('/feedback/:id', adminAuth, async (req, res) => {
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

/* ================= ANNOTATE (теги/заметка) ================= */

router.post('/annotate', adminAuth, express.json(), async (req, res) => {
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

/* ================= EXPORT CSV ================= */

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

router.get('/export', adminAuth, async (req, res) => {
  const {
    shop_id = '',
    sentiment = '',
    limit = '1000',
    offset = '0',
  } = req.query;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 5000);
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

  const ids = (data || []).map(x => x.id);
  let annMap = new Map();
  if (ids.length) {
    const { data: anns } = await supabase
      .from('feedback_annotations')
      .select('feedback_id,tags,note')
      .in('feedback_id', ids);
    (anns || []).forEach(a => annMap.set(a.feedback_id, a));
  }

  const rows = (data || []).map(d => {
    const a = annMap.get(d.id);
    return {
      id: d.id,
      timestamp: d.timestamp,
      shop_id: d.shop_id,
      device_id: d.device_id,
      sentiment: d.sentiment,
      emotion_score: d.emotion_score,
      tags: (d.tags || []).join('|'),
      summary: d.summary || '',
      manager_tags: (a?.tags || []).join('|'),
      manager_note: a?.note || '',
    };
  });

  const csv = toCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="feedback_export_${Date.now()}.csv"`);
  res.send(csv);
});

export default router;
