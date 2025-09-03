// Простая утилита: нормализует число в диапазон [0,1]
export function clamp01(x) {
  if (Number.isNaN(Number(x))) return 0;
  return Math.max(0, Math.min(1, Number(x)));
}
