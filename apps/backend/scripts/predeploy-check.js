// scripts/predeploy-check.js
const required = [
  'SUPABASE_URL',
  'SUPABASE_KEY',               // anon
  'SUPABASE_SERVICE_ROLE_KEY',  // service
  'SUPABASE_BUCKET',            // audio
  'ASSEMBLYAI_API_KEY',
  'TELEGRAM_TOKEN',
  'TELEGRAM_CHAT_ID',
  'CORS_ORIGINS'
];

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Missing ENV:', missing.join(', '));
  process.exit(1);
}
console.log('✅ Predeploy ENV OK');
