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
    fileName.endsWith('.wav') ? 'audio/wav'
    : fileName.endsWith('.ogg') ? 'audio/ogg'
    : fileName.endsWith('.webm') ? 'audio/webm'
    : 'audio/mpeg';

  const { error: upErr } = await supabaseAdmin
    .storage.from(BUCKET)
    .upload(storagePath, fileBuf, { contentType, upsert: false });

  if (upErr) {
    console.error('❌ Ошибка upload в Supabase:', upErr.message);
    return null;
  }

  const { data: s, error: se } = await supabaseAdmin
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, 60);

  if (se) {
    console.error('❌ Ошибка createSignedUrl:', se.message);
    return { storagePath, signedUrl: null };
  }

  return { storagePath, signedUrl: s?.signedUrl || null };
}

console.log('🔐 Signed URL создан:', redactUrl(signedUrl));
