import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { CAPTIONS, CONFIRM, TIMELAPSE, URLS } from '../content';
import { ClickFx } from '../fx/ClickFx';
import { Cursor } from '../fx/Cursor';
import { AuditStamp, Caption, type ScreenRect, Spotlight, Timelapse } from '../fx/Overlays';
import { VariantBars } from '../fx/VariantBars';
import {
  A_LAYOUT,
  B_LAYOUT,
  CAMERA_KEYS,
  CAPTION_TIMES,
  CLICKS,
  CURSOR_PATH,
  cursorOpacity,
  J,
  routeAt,
  routeStartAt,
  scrollB,
  statusCardHeight,
} from '../journey/script';
import {
  type Camera,
  cameraAt,
  cameraBlur,
  pageToWindow,
  STAGE,
  windowToScreen,
  windowTransform,
} from '../lib/camera';
import { CLAMP, EASE_OUT, PRODUCT, pointOnPath, progress } from '../lib/motion';
import { theme } from '../theme';
import { ConfirmPage } from '../ui/pages/ConfirmPage';
import { NewRequestPage } from '../ui/pages/NewRequestPage';
import { RequestPage } from '../ui/pages/RequestPage';
import { BrowserShell } from '../ui/Shell';

/**
 * Путь покупателя в реальном интерфейсе QAJET: заявка → разбор →
 * стадии закупки → варианты → подтверждение → исполнение и документы.
 * Все ключевые кадры — в src/journey/script.ts.
 */

/** Прямоугольник страницы → прямоугольник кадра (через прокрутку и камеру). */
const pageRectToScreen = (
  r: { x: number; y: number; w: number; h: number },
  scroll: number,
  cam: Camera,
): ScreenRect => {
  const a = windowToScreen(pageToWindow({ x: r.x, y: r.y }, scroll), cam);
  const b = windowToScreen(pageToWindow({ x: r.x + r.w, y: r.y + r.h }, scroll), cam);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
};

const URL_BY_ROUTE = {
  newRequest: URLS.newRequest,
  request: URLS.request,
  confirm: URLS.confirm,
} as const;

export const Journey: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = cameraAt(frame, CAMERA_KEYS);
  const blur = cameraBlur(frame, CAMERA_KEYS);
  const route = routeAt(frame);
  const routeStart = routeStartAt(frame);

  // RouteTransition продукта: opacity 0 → 1 и сдвиг 4px за quick (180 мс).
  const rt = routeStart === 0 ? 1 : progress(frame, routeStart, PRODUCT.quick, PRODUCT.standard);
  // Вход окна: снизу, с наклоном (наклон — в ключах камеры).
  const enterY = interpolate(frame, [J.enterStart, J.enterEnd], [320, 0], {
    ...CLAMP,
    easing: EASE_OUT,
  });
  const enterOpacity = interpolate(frame, [0, 10], [0, 1], CLAMP);

  // Курсор в экранных координатах: не масштабируется зумом камеры.
  const cursorAt = (f: number): { x: number; y: number } =>
    windowToScreen(pointOnPath(f, CURSOR_PATH), cameraAt(f, CAMERA_KEYS));
  const cursor = cursorAt(frame);
  const prev = cursorAt(frame - 1);
  const cursorBlur = Math.min(Math.hypot(cursor.x - prev.x, cursor.y - prev.y) * 0.05, 2.5);
  const cursorScale = CLICKS.reduce(
    (s, c) => s * interpolate(frame, [c.frame - 2, c.frame + 1, c.frame + 7], [1, 0.82, 1], CLAMP),
    1,
  );

  // Прожекторы: разбор запроса, «ход за вами», документы.
  const spotA = interpolate(
    frame,
    [J.aTokensStart - 6, J.aTokensStart + 4, J.aClickAccept - 10, J.aClickAccept - 2],
    [0, 1, 1, 0],
    CLAMP,
  );
  const spotB = interpolate(
    frame,
    [J.bProposed + 2, J.bProposed + 8, J.bScrollStart - 2, J.bScrollStart + 4],
    [0, 1, 1, 0],
    CLAMP,
  );
  const spotD = interpolate(
    frame,
    [J.dDocs + 4, J.dDocs + 12, J.exitStart, J.exitStart + 8],
    [0, 1, 1, 0],
    CLAMP,
  );
  const dDocsY =
    B_LAYOUT.statusY +
    statusCardHeight(1, 2, false) +
    B_LAYOUT.gap +
    B_LAYOUT.composition +
    B_LAYOUT.gap +
    B_LAYOUT.planApproved +
    B_LAYOUT.gap +
    B_LAYOUT.rejections +
    B_LAYOUT.gap +
    B_LAYOUT.closed +
    B_LAYOUT.gap;

  return (
    <AbsoluteFill>
      {/* Окно браузера под камерой */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          perspective: 2400,
          perspectiveOrigin: `${STAGE.width / 2}px ${STAGE.height / 2}px`,
          translate: `0 ${enterY}px`,
          opacity: enterOpacity,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: '0 0',
            transform: windowTransform(cam),
            filter: blur > 0 ? `blur(${blur}px)` : undefined,
            borderRadius: 14,
            boxShadow: theme.stage.windowShadow,
          }}
        >
          <BrowserShell url={URL_BY_ROUTE[route]} activeNav={route === 'newRequest' ? 1 : 0}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: rt,
                translate: `0 ${(1 - rt) * 4}px`,
              }}
            >
              {route === 'newRequest' ? <NewRequestPage /> : null}
              {route === 'request' ? <RequestPage /> : null}
              {route === 'confirm' ? <ConfirmPage /> : null}
            </div>
          </BrowserShell>
        </div>
      </div>

      {/* Прожекторы */}
      {spotA > 0 ? (
        <Spotlight
          rect={pageRectToScreen(
            {
              x: A_LAYOUT.quick.x,
              y: A_LAYOUT.quick.y,
              w: A_LAYOUT.quick.w,
              h: A_LAYOUT.quickBottomBase + A_LAYOUT.previewGrow - A_LAYOUT.quick.y,
            },
            0,
            cam,
          )}
          strength={spotA}
        />
      ) : null}
      {spotB > 0 ? (
        <Spotlight
          rect={pageRectToScreen(
            { x: B_LAYOUT.x, y: B_LAYOUT.statusY, w: B_LAYOUT.w, h: statusCardHeight(1, 3, true) },
            0,
            cam,
          )}
          strength={spotB}
        />
      ) : null}
      {spotD > 0 ? (
        <Spotlight
          rect={pageRectToScreen(
            { x: B_LAYOUT.x, y: dDocsY, w: B_LAYOUT.w, h: B_LAYOUT.documents },
            scrollB(frame),
            cam,
          )}
          strength={spotD}
        />
      ) : null}

      {/* Клики: кольцо и лучи привязаны к точке интерфейса и едут вместе с камерой */}
      {CLICKS.map((c) => {
        const p = windowToScreen(c.at, cam);
        return <ClickFx key={c.frame} x={p.x} y={p.y} frame={frame} clickFrame={c.frame} />;
      })}
      <Cursor
        x={cursor.x}
        y={cursor.y}
        scale={cursorScale}
        opacity={cursorOpacity(frame)}
        blur={cursorBlur}
      />

      <VariantBars frame={frame} />

      <Timelapse
        frame={frame}
        start={J.routeB + 12}
        end={J.bScrollStart - 2}
        dates={TIMELAPSE.sourcing}
      />
      <Timelapse
        frame={frame}
        start={J.cAudit + 34}
        end={J.dScrollStart}
        dates={TIMELAPSE.execution}
      />
      <AuditStamp
        frame={frame}
        start={J.cAudit}
        end={J.cAudit + 40}
        title={CONFIRM.audit}
        sub={CONFIRM.auditSub}
      />

      {(Object.keys(CAPTION_TIMES) as (keyof typeof CAPTION_TIMES)[]).map((k) => (
        <Caption
          key={k}
          frame={frame}
          start={CAPTION_TIMES[k].start}
          end={CAPTION_TIMES[k].end}
          top={CAPTION_TIMES[k].top}
          {...CAPTIONS[k]}
        />
      ))}
    </AbsoluteFill>
  );
};
