import { ImageResponse } from 'next/og';
import { brandMark } from './lib/brand-mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(brandMark({ box: 180, safeZone: false }), size);
}
