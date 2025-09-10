// apps/backend/lib/settings.js
import { supabase } from './supabase.js';

const SETTINGS_TABLE = 'settings';

export async function getSetting(key, defaultValue = null) {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select('value')
    .eq('key', key)
    .single();
  if (error) return defaultValue;
  return (data?.value ?? defaultValue);
}

export async function setSetting(key, valueObj) {
  const payload = { key, value: valueObj, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert(payload, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return true;
}
