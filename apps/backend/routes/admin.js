// apps/backend/routes/admin.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { getSetting, setSetting } from '../lib/settings.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Статика: /admin -> index.html
router.use('/', express.static(path.join(__dirname, '../public/admin')));

// API: список отзывов (лента)
router.get('/api/feedbacks', adminAuth(), async (req, res) => {
  try {
    const {
      shop_id,
      sentiment,             // 'негатив' | 'нейтральный' | 'позитивный'
      limit = 20,
      offset = 0
    } = req.query;

    let q = supabase
      .from('feedbacks')
      .select('id,shop_id,device_id,timestamp,sentiment,emotion_score,tags,summary')
      .order('timestamp', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (shop_id) q = q.eq('shop_id', shop_id);
    if (sentiment) q = q.eq('sentiment', sentiment);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    res.json({ status: 'ok', items: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// API: получить настройки
router.get('/api/settings', adminAuth(), async (req, res) => {
  const thr = await getSetting('TELEGRAM_ALERT_THRESHOLD', { value: 0.4 });
  res.json({ TELEGRAM_ALERT_THRESHOLD: thr });
});

// API: обновить настройки
router.put('/api/settings', adminAuth(), express.json(), async (req, res) => {
  try {
    const { TELEGRAM_ALERT_THRESHOLD } = req.body || {};
    if (!TELEGRAM_ALERT_THRESHOLD || typeof TELEGRAM_ALERT_THRESHOLD.value !== 'number') {
      return res.status(400).json({ error: 'Invalid TELEGRAM_ALERT_THRESHOLD' });
    }
    await setSetting('TELEGRAM_ALERT_THRESHOLD', { value: TELEGRAM_ALERT_THRESHOLD.value });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

export default router;
