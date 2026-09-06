import { ImageResponse } from 'next/og';
import { brandMark } from './lib/brand-mark';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Фавикон генерируется кодом через next/og (Satori), а не берётся из
 * заготовки: в бренд-марке та же полоса, что и на экране сравнения
 * вариантов (§12) — документ с шафрановой полосой снизу, а не буква
 * логотипа. Единый источник (brandMark) переиспользуется во всех
 * иконках, чтобы бренд-знак не разъехался между favicon, apple-touch
 * и PWA-иконками.
 */
export default function Icon() {
  return new ImageResponse(brandMark({ box: 32, safeZone: false }), size);
}
