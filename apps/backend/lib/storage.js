// apps/backend/lib/storage.js
import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from './supabase.js';
import { redactUrl } from '../utils/logSafe.js';

const BUCKET = process.env.SUPABASE_BUCKET;

export async function uploadAudioToSupabase(tmpPath) {
  const fileName = path.basename(tmpPath);
  const storagePath = `uploads/${Date.now()}-${fileName}`;

  const fileBuf = fs.readFileSync(tmpPath);
  const contentType =
    fileName.endsWith('.wav')  ? 'audio/wav'  :
    fileName.endsWith('.ogg')  ? 'audio/ogg'  :
    fileName.endsWith('.webm') ? 'audio/webm' :
    'audio/mpeg';

  // 1) Upload
  const { error: upErr } = await supabaseAdmin
    .storage
    .from(BUCKET)
    .upload(storagePath, fileBuf, { contentType, upsert: false });

  if (upErr) {
    console.error('❌ Ошибка upload в Supabase:', upErr.message);
    return null;
  }

  // 2) Short-lived signed URL (60s) — только для AAI
  const { data: s, error: se } = await supabaseAdmin
    .storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60);

  if (se) {
    console.error('❌ Ошибка createSignedUrl:', se.message);
    return { storagePath, signedUrl: null };
  }

  if (s?.signedUrl) {
    console.log('🔐 Signed URL создан (60s):', redactUrl(s.signedUrl));
  }
  return { storagePath, signedUrl: s?.signedUrl || null };
}
