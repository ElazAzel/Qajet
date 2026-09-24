import type React from 'react';
import { interpolate } from 'remotion';
import { formatKzt, LANDING, PLANS, type Plan, planFactTotal } from '../content';
import { BAR_SCALE_MAX, J } from '../journey/script';
import { CLAMP, EASE_IN_OUT, EASE_OUT, PRODUCT, progress, springAt } from '../lib/motion';
import { theme } from '../theme';

/**
 * Полоса варианта — фирменный элемент QAJET (§12, packages/ui/src/motion/bar-grow.tsx).
 * Три варианта в ЕДИНОЙ шкале, каждый разбит на товар / нанесение и работы /
 * доставку / комиссию QAJET / налоговый эффект. Разницу видно глазом, без цифр.
 *
 * В продукте полоса растёт 420 мс со стаггером 60 мс. В ролике — те же кривая
 * и порядок, но медленнее (BAR_GROW, ROW_STAGGER), чтобы зритель успел сравнить.
 */

const BAR_GROW = PRODUCT.deliberate * 2;
const ROW_STAGGER = PRODUCT.stagger * 3;

const SEGMENTS = [
  { key: 'goods', label: 'Товар', color: theme.color.ink },
  { key: 'work', label: 'Нанесение и работы', color: theme.color.muted },
  { key: 'delivery', label: 'Доставка', color: theme.color.muted },
  { key: 'commission', label: 'Комиссия QAJET', color: theme.color.purple },
  { key: 'taxEffect', label: 'Налоговый эффект', color: theme.color.signal },
] as const;

// Раскладка панели (экранные пиксели).
const P = {
  width: 1240,
  padX: 56,
  padTop: 44,
  rowsTop: 170,
  rowStep: 156,
  headerH: 40,
  barTop: 52,
  barH: 44,
  legendTop: 640,
  height: 760,
} as const;
const BAR_W = P.width - 2 * P.padX;
const CHEAPER = PLANS.findIndex((p) => p.key === 'cheaper');

const segmentValue = (plan: Plan, key: (typeof SEGMENTS)[number]['key']): number => plan[key];
const widthOf = (amount: number): number => (amount / BAR_SCALE_MAX) * BAR_W;

// Точка, к которой приближается «камера» панели: налоговый сегмент дешёвого варианта.
const cheaper = PLANS[CHEAPER];
const taxStart = widthOf(cheaper.goods + cheaper.work + cheaper.delivery + cheaper.commission);
const ZOOM_ORIGIN = {
  x: P.padX + taxStart + widthOf(cheaper.taxEffect) / 2,
  y: P.rowsTop + CHEAPER * P.rowStep + P.barTop + P.barH / 2,
};

export const VariantBars: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < J.barsIn || frame > J.barsOut + 12) return null;
  const dim = interpolate(
    frame,
    [J.barsIn, J.barsIn + 8, J.barsOut, J.barsOut + 10],
    [0, 1, 1, 0],
    CLAMP,
  );
  const inP = springAt(frame, J.barsIn + 2);
  const outP = progress(frame, J.barsOut, 10, PRODUCT.accelerate);
  const zoom = interpolate(
    frame,
    [J.barsZoomIn, J.barsZoomIn + 14, J.barsZoomOut, J.barsZoomOut + 10],
    [1, 1.55, 1.55, 1],
    { ...CLAMP, easing: [EASE_IN_OUT, EASE_IN_OUT, EASE_IN_OUT] },
  );
  const callout = springAt(frame, J.barsCallout, { damping: 13, stiffness: 200 });

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: theme.stage.dim,
          opacity: dim,
          zIndex: 40,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: (1920 - P.width) / 2,
          top: (1080 - P.height) / 2,
          width: P.width,
          height: P.height,
          borderRadius: theme.radius.hero,
          background: theme.color.surface,
          boxShadow: '0 40px 120px rgba(0, 0, 0, 0.5)',
          fontFamily: theme.font.family,
          color: theme.color.ink,
          zIndex: 45,
          opacity: interpolate(inP, [0, 1], [0, 1], CLAMP) * (1 - outP),
          translate: `0 ${interpolate(inP, [0, 1], [70, 0], CLAMP) + outP * 60}px`,
          transformOrigin: `${ZOOM_ORIGIN.x}px ${ZOOM_ORIGIN.y}px`,
          scale: String(interpolate(inP, [0, 1], [0.96, 1], CLAMP) * zoom),
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: P.padX,
            top: P.padTop,
            fontSize: 44,
            lineHeight: '52px',
            fontWeight: 800,
            letterSpacing: '-0.01em',
          }}
        >
          Из чего складывается цена
        </div>
        <div
          style={{
            position: 'absolute',
            left: P.padX,
            top: P.padTop + 60,
            fontSize: 24,
            lineHeight: '30px',
            color: theme.color.muted,
          }}
        >
          Единая шкала для всех вариантов — видно, почему дешевле, без чтения цифр
        </div>

        {PLANS.map((plan, row) => {
          const top = P.rowsTop + row * P.rowStep;
          const growStart = J.barsGrow + row * ROW_STAGGER;
          const isCheaper = row === CHEAPER;
          const total =
            planFactTotal(plan) * progress(frame, growStart, BAR_GROW, PRODUCT.decelerate);
          let left = 0;
          return (
            <div key={plan.key} style={{ position: 'absolute', left: P.padX, top, width: BAR_W }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  height: P.headerH,
                }}
              >
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 600,
                    color: isCheaper ? theme.color.ink : theme.color.muted,
                  }}
                >
                  {plan.barLabel}
                </span>
                <span
                  style={{
                    fontSize: 32,
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    color: isCheaper && callout > 0.5 ? theme.color.signal : theme.color.ink,
                    // Сумма проявляется вместе с ростом полосы, а не висит «0 ₸» до него.
                    opacity: progress(frame, growStart, 4),
                  }}
                >
                  {formatKzt(total)}
                </span>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: P.barTop,
                  left: 0,
                  width: BAR_W,
                  height: P.barH,
                  borderRadius: theme.radius.cardSm,
                  overflow: 'hidden',
                  background: theme.color.page,
                }}
              >
                {SEGMENTS.map((seg, j) => {
                  const w = widthOf(segmentValue(plan, seg.key));
                  const x = left;
                  left += w;
                  const g = interpolate(
                    frame,
                    [growStart + j * 0.5, growStart + j * 0.5 + BAR_GROW],
                    [0, 1],
                    {
                      ...CLAMP,
                      easing: PRODUCT.bar,
                    },
                  );
                  return (
                    <div
                      key={seg.key}
                      style={{
                        position: 'absolute',
                        left: x,
                        top: 0,
                        width: w,
                        height: P.barH,
                        background: seg.color,
                        borderLeft: j > 0 ? `1px solid ${theme.color.page}` : undefined,
                        boxSizing: 'border-box',
                        transformOrigin: 'left center',
                        scale: `${g} 1`,
                      }}
                    />
                  );
                })}
              </div>
              {/* Срок и запас — короткая шкала в общем масштабе (§12) */}
              <div
                style={{
                  position: 'absolute',
                  top: P.barTop + P.barH + 14,
                  left: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  fontSize: 20,
                  color: theme.color.muted,
                }}
              >
                <div
                  style={{
                    width: 220,
                    height: 8,
                    borderRadius: 4,
                    background: theme.color.page,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(plan.slackDays / 10) * 100}%`,
                      height: '100%',
                      background: plan.slackDays < 3 ? theme.status.pending.fg : theme.color.purple,
                      transformOrigin: 'left center',
                      scale: `${progress(frame, growStart + 4, BAR_GROW, PRODUCT.bar)} 1`,
                    }}
                  />
                </div>
                <span>
                  запас {plan.slackDays} дн. · срок {plan.eta}
                </span>
              </div>
            </div>
          );
        })}

        {/* Выноска: налоговый эффект дешёвого варианта */}
        <div
          style={{
            position: 'absolute',
            left: P.padX + taxStart - 8,
            top: P.rowsTop + CHEAPER * P.rowStep + P.barTop - 8,
            width: widthOf(cheaper.taxEffect) + 16,
            height: P.barH + 16,
            borderRadius: theme.radius.cardSm + 4,
            border: `3px solid ${theme.color.signal}`,
            boxSizing: 'border-box',
            opacity: callout,
            scale: String(interpolate(callout, [0, 1], [1.25, 1], CLAMP)),
          }}
        />
        <div
          style={{
            position: 'absolute',
            // Под полосой, правым краем к налоговому сегменту: на зуме не уходит за кадр.
            right: P.width - (P.padX + taxStart + widthOf(cheaper.taxEffect)),
            top: P.rowsTop + CHEAPER * P.rowStep + P.barTop + P.barH + 12,
            padding: '6px 14px',
            borderRadius: theme.radius.pill,
            background: theme.status.signal.bg,
            color: theme.status.signal.fg,
            fontSize: 22,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            opacity: callout,
            translate: `0 ${(1 - callout) * -12}px`,
          }}
        >
          Налоговый эффект +{formatKzt(cheaper.taxEffect)}
        </div>

        {/* Легенда и честная сноска с лендинга */}
        <div
          style={{
            position: 'absolute',
            left: P.padX,
            top: P.legendTop,
            display: 'flex',
            gap: 28,
            fontSize: 20,
            color: theme.color.muted,
          }}
        >
          {SEGMENTS.map((seg) => (
            <span key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: seg.color }} />
              {seg.label}
            </span>
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: P.padX,
            top: P.legendTop + 44,
            fontSize: 18,
            color: theme.color.muted,
            opacity: progress(frame, J.barsGrow + 10, 12, EASE_OUT),
          }}
        >
          {LANDING.demoNote}
        </div>
      </div>
    </>
  );
};
