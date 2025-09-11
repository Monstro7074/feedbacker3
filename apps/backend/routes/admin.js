// apps/backend/routes/admin.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabaseAdmin } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { getSettingNumber, setSetting } from '../lib/settings.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Статика: /admin -> index.html
router.use('/', express.static(path.join(__dirname, '../public/admin')));

/**
 * API: список отзывов (лента) с пагинацией
 * GET /admin/api/feedbacks?shop_id=&sentiment=&limit=20&offset=0
 */
router.get('/api/feedbacks', adminAuth(), async (req, res) => {
  try {
    const {
      shop_id = '',
      sentiment = '', // 'негатив' | 'нейтральный' | 'позитивный' | ''
      limit = '20',
      offset = '0',
    } = req.query;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    let q = supabaseAdmin
      .from('feedbacks')
      .select('id,shop_id,device_id,timestamp,sentiment,emotion_score,tags,summary')
      .order('timestamp', { ascending: false })
      .range(off, off + lim - 1);

    if (shop_id) q = q.eq('shop_id', shop_id);
    if (sentiment) q = q.eq('sentiment', sentiment);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const items = data || [];
    const nextOffset = items.length === lim ? off + lim : null;

    res.json({ status: 'ok', items, nextOffset });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * API: получить настройки
 * GET /admin/api/settings
 * Возвращает число TELEGRAM_ALERT_THRESHOLD
 */
router.get('/api/settings', adminAuth(), async (req, res) => {
  const fallback = Number.parseFloat(process.env.TELEGRAM_ALERT_THRESHOLD || '0.4');
  const thr = await getSettingNumber('TELEGRAM_ALERT_THRESHOLD', fallback, { ttlMs: 60_000 });
  res.json({ TELEGRAM_ALERT_THRESHOLD: thr });
});

/**
 * API: обновить настройки
 * PUT /admin/api/settings  { TELEGRAM_ALERT_THRESHOLD: 0.4 }
 * Принимает также форму { TELEGRAM_ALERT_THRESHOLD: { value: 0.4 } }
 */
router.put('/api/settings', adminAuth(), express.json(), async (req, res) => {
  try {
    const raw = (req.body || {}).TELEGRAM_ALERT_THRESHOLD;
    const n = typeof raw === 'object' && raw !== null ? raw.value : raw;
    const val = Number.parseFloat(n);

    if (!Number.isFinite(val)) {
      return res.status(400).json({ error: 'Invalid TELEGRAM_ALERT_THRESHOLD' });
    }

    const clamped = Math.min(Math.max(val, 0), 1); // 0..1
    await setSetting('TELEGRAM_ALERT_THRESHOLD', String(clamped));

    res.json({ status: 'ok', TELEGRAM_ALERT_THRESHOLD: clamped });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

export default router;
