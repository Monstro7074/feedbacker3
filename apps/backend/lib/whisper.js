import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// 🔑 Проверка наличия API-ключа
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ Ошибка: переменная OPENAI_API_KEY не установлена!');
  throw new Error('Отсутствует ключ OpenAI API. Укажите его в .env или Replit Secrets.');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 📥 Скачать аудио по URL и сохранить во временный файл
 * @param {string} audioUrl - прямая ссылка на mp3/m4a/webm/wav
 * @returns {Promise<string>} путь к временно сохранённому файлу
 */
async function downloadToTempFile(audioUrl) {
  console.log(`⬇️ Скачиваем аудио: ${audioUrl}`);

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Не удалось скачать аудио: ${res.statusText}`);

  const buffer = await res.arrayBuffer();
  const tempFilename = `whisper-${Date.now()}.mp3`;
  const tempPath = path.join('/tmp', tempFilename);

  fs.writeFileSync(tempPath, Buffer.from(buffer));
  console.log(`💾 Аудио сохранено во временный файл: ${tempPath}`);
  return tempPath;
}

/**
 * 🧠 Расшифровать аудио через Whisper API
 * @param {string} audioUrl - прямая ссылка на mp3/m4a/webm/wav
 * @returns {Promise<string>} текст расшифровки
 */

console.log("🔑 Проверка ключа перед Whisper:", process.env.OPENAI_API_KEY ? "OK" : "MISSING");

export async function transcribeAudio(audioUrl) {
  // 1. Скачиваем аудио
  const filePath = await downloadToTempFile(audioUrl);

  try {
    // 2. Отправляем в Whisper
    console.log('🎙 Отправляем в OpenAI Whisper...');
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
    });

    console.log('📄 Whisper вернул текст:', response.text);
    return response.text;
  } catch (err) {
    console.error('❌ Ошибка при расшифровке аудио через Whisper:', err);
    throw err;
  } finally {
    // 3. Удаляем временный файл
    try {
      fs.unlinkSync(filePath);
      console.log(`🗑 Удалён временный файл: ${filePath}`);
    } catch (unlinkErr) {
      console.warn(`⚠️ Не удалось удалить файл: ${unlinkErr.message}`);
    }
  }
}
