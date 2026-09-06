import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { brandMark } from '../../lib/brand-mark';

/**
 * PWA-иконки для manifest.ts (192, 512, 512-maskable), сгенерированные
 * тем же бренд-знаком, что и favicon — см. app/lib/brand-mark.tsx.
 * Динамическая генерация вместо бинарных файлов в репозитории: знак
 * меняется в одном месте и сразу обновляется во всех размерах.
 */

const VARIANTS = {
  '192': { box: 192, safeZone: false },
  '512': { box: 512, safeZone: false },
  '512-maskable': { box: 512, safeZone: true },
} as const;

type SizeParam = keyof typeof VARIANTS;

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((size) => ({ size }));
}

export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size } = await context.params;
  const variant = VARIANTS[size as SizeParam];

  if (!variant) {
    return NextResponse.json({ error: 'unknown icon size' }, { status: 404 });
  }

  return new ImageResponse(brandMark(variant), { width: variant.box, height: variant.box });
}
