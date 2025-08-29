// apps/backend/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  throw new Error('SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы');
}

// Используем service role везде на бэкенде
export const supabase = createClient(URL, SERVICE_KEY);
export const supabaseAdmin = supabase;
