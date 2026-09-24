import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge знает только стандартную шкалу размеров. Свои размеры темы
 * (`--text-micro`, `--text-fine` в apps/web/app/globals.css) без этой настройки
 * считаются цветом текста и молча выбрасываются рядом с настоящим цветом.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['micro', 'fine'] } },
});

/** Склейка классов с разрешением конфликтов Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
