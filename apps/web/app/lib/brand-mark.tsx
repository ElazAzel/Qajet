/**
 * Единственное место, где описан графический бренд-знак QAJET —
 * документ с шафрановой полосой снизу, отсылающий к «полосе варианта»
 * с экрана сравнения (§12, фирменный элемент продукта). Используется
 * из icon.tsx, apple-icon.tsx и app/icons/[size]/route.tsx через
 * next/og ImageResponse (Satori), поэтому разметка — ограниченное
 * подмножество JSX/CSS, которое Satori умеет рендерить (flex, без
 * произвольных CSS-функций).
 */

const INK = '#0c1b22';
const PAPER = '#edefea';
const RULE = '#c9cfc6';
const ACCENT = '#d9a521';

export function brandMark({ box, safeZone }: { box: number; safeZone: boolean }) {
  // Maskable-иконки должны держать значимое содержимое в безопасной зоне
  // ~80% от размера — иначе ОС обрежет знак кругом или квадратом со скруглением.
  const inset = safeZone ? box * 0.12 : box * 0.08;
  const docWidth = box - inset * 2;
  const docHeight = docWidth * 1.15;
  const ruleWidth = docWidth * 0.62;
  const barHeight = Math.max(docHeight * 0.12, 2);

  return (
    <div
      style={{
        width: box,
        height: box,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: INK,
      }}
    >
      <div
        style={{
          width: docWidth,
          height: docHeight,
          background: PAPER,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: docWidth * 0.14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: docHeight * 0.1 }}>
          <div style={{ width: ruleWidth, height: 2, background: RULE, display: 'flex' }} />
          <div style={{ width: ruleWidth * 0.7, height: 2, background: RULE, display: 'flex' }} />
        </div>
        <div style={{ width: '100%', height: barHeight, background: ACCENT, display: 'flex' }} />
      </div>
    </div>
  );
}
