// apps/backend/lib/audio-validate.js
import { parseFile } from 'music-metadata';

/**
 * Валидирует длительность аудио-файла.
 * @param {string} filePath - локальный путь до файла (tmp-аплоад multer)
 * @param {{minSec?:number,maxSec?:number}} opts
 * @returns {Promise<{ok:boolean, seconds:number, error?:string}>}
 */
export async function validateAudioDuration(filePath, opts = {}) {
  const minSec = Number(process.env.MIN_AUDIO_SECONDS ?? opts.minSec ?? 1.5); // отсекаем «пустышки»
  const maxSecEnv = process.env.MAX_AUDIO_SECONDS; // приоритет окружения
  const maxSec = Number(maxSecEnv ?? opts.maxSec ?? 5 * 60); // дефолт: 5 минут

  try {
    const meta = await parseFile(filePath);
    const seconds = Number(meta?.format?.duration || 0);

    if (!Number.isFinite(seconds) || seconds <= 0) {
      return { ok: false, seconds: 0, error: 'Не удалось определить длительность аудио' };
    }
    if (seconds < minSec) {
      return { ok: false, seconds, error: `Аудио слишком короткое (< ${minSec} сек)` };
    }
    if (seconds > maxSec) {
      return { ok: false, seconds, error: `Аудио слишком длинное (> ${Math.round(maxSec/60)} мин)` };
    }
    return { ok: true, seconds };
  } catch (e) {
    return { ok: false, seconds: 0, error: `Ошибка чтения аудио: ${e.message}` };
  }
}
