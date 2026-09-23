import type React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BROWSER_TITLEBAR_HEIGHT, BrowserFrame } from '../components/BrowserFrame';
import { Cursor } from '../components/Cursor';
import { Logo } from '../components/Logo';
import { CARD_BUTTON_HEIGHT, CARD_PADDING, ProposalCard } from '../components/ProposalCard';
import { Toast } from '../components/Toast';
import { DEMO, PROPOSALS } from '../content';
import {
  CLAMP,
  EASE_OUT,
  type PathKeyframe,
  type Point,
  pointOnPath,
  pressScale,
  springAt,
  velocityBlur,
  velocityBlur2D,
} from '../lib/motion';
import { theme } from '../theme';

/* ──────────────────────────────────────────────────────────────────────────
 * СКРИНШОТ ВМЕСТО МАКЕТА
 * true: во вкладке браузера показывается реальный скриншот из public/screens/,
 * курсор, клики, ripple и тост работают поверх него.
 * Скриншот снимайте во вьюпорте 1640×860 (размер вкладки ниже), тогда
 * координаты клика совпадут с пикселями картинки один к одному.
 * ────────────────────────────────────────────────────────────────────────── */
export const USE_SCREENSHOT = false;

const SCREENSHOT = {
  // Путь внутри public/. Файл кладётся в public/screens/.
  src: 'screens/app.png',
  // Точки кликов в координатах вкладки (px от левого верхнего угла скриншота).
  // Подгоните под свой скриншот: кнопка поиска и кнопка «Выбрать».
  searchClick: { x: 1436, y: 200 },
  selectClick: { x: 820, y: 755 },
} as const;

/* ──────────────────────────────────────────────────────────────────────────
 * КЛЮЧЕВЫЕ КАДРЫ (локальные кадры сцены, 30 fps)
 * Первые ~20 кадров сцена въезжает переходом из интро,
 * последние ~20 растворяется в аутро (см. TIMING в MainSequence).
 * ────────────────────────────────────────────────────────────────────────── */
export const DEMO_KEYFRAMES = {
  // Бит 1. Запрос: печать текста в поле.
  typeStart: 22,
  typeEnd: 70,
  // Курсор появляется и едет к «Найти варианты».
  cursorEnter: 58,
  cursorAtSearch: 80,
  searchClick: 84,
  // Курсор отъезжает в сторону, чтобы не закрывать карточки.
  cursorAsideStart: 104,
  cursorAside: 124,
  // Бит 2. Варианты: заголовок блока и карточки со stagger.
  resultsTitleIn: 94,
  cardsIn: 100,
  cardStagger: 8,
  // Бит 3. Выбор: курсор едет к «Выбрать» на карточке «Оптимально».
  cursorToSelect: 150,
  cursorAtSelect: 186,
  selectClick: 190,
  // Бит 4. Результат: остальные карточки гаснут, выбранная растёт, выезжает тост.
  resultStart: 202,
  cursorFadeOut: 212,
  cursorGone: 232,
  toastIn: 212,
  checkStart: 226,
  checkEnd: 246,
} as const;

/* ──────────────────────────────────────────────────────────────────────────
 * РАСКЛАДКА (px). Окно браузера по центру кадра 1920×1080.
 * ────────────────────────────────────────────────────────────────────────── */
const BROWSER = { width: 1640, height: 920 } as const;
const VIEWPORT = {
  width: BROWSER.width,
  height: BROWSER.height - BROWSER_TITLEBAR_HEIGHT,
} as const;

const LAYOUT = {
  padX: 64,
  headerHeight: 72,
  titleY: 104,
  inputY: 160,
  inputHeight: 80,
  searchWidth: 280,
  gap: 16,
  resultsTitleY: 268,
  cardsY: 312,
  cardHeight: 500,
  cardGap: 28,
} as const;

const INPUT_WIDTH = VIEWPORT.width - 2 * LAYOUT.padX - LAYOUT.searchWidth - LAYOUT.gap;
const SEARCH_X = LAYOUT.padX + INPUT_WIDTH + LAYOUT.gap;
const CARD_WIDTH = (VIEWPORT.width - 2 * LAYOUT.padX - 2 * LAYOUT.cardGap) / 3;
const cardX = (index: number): number => LAYOUT.padX + index * (CARD_WIDTH + LAYOUT.cardGap);
const OPTIMAL_INDEX = Math.max(
  0,
  PROPOSALS.findIndex((p) => p.optimal),
);

// Точки кликов считаются из той же раскладки, что и макет, поэтому
// курсор попадает в кнопки при любых правках LAYOUT.
const SEARCH_POINT: Point = USE_SCREENSHOT
  ? SCREENSHOT.searchClick
  : { x: SEARCH_X + LAYOUT.searchWidth / 2, y: LAYOUT.inputY + LAYOUT.inputHeight / 2 };
const SELECT_POINT: Point = USE_SCREENSHOT
  ? SCREENSHOT.selectClick
  : {
      x: cardX(OPTIMAL_INDEX) + CARD_WIDTH / 2,
      y: LAYOUT.cardsY + LAYOUT.cardHeight - CARD_PADDING - CARD_BUTTON_HEIGHT / 2,
    };

const K = DEMO_KEYFRAMES;

// Траектория курсора: точки и кадры, между ними Easing.bezier (см. lib/motion).
const CURSOR_PATH: readonly PathKeyframe[] = [
  { frame: K.cursorEnter, x: VIEWPORT.width - 80, y: VIEWPORT.height - 40 },
  { frame: K.cursorAtSearch, ...SEARCH_POINT },
  { frame: K.cursorAsideStart, ...SEARCH_POINT },
  { frame: K.cursorAside, x: SEARCH_POINT.x + 40, y: LAYOUT.resultsTitleY + 12 },
  { frame: K.cursorToSelect, x: SEARCH_POINT.x + 40, y: LAYOUT.resultsTitleY + 12 },
  { frame: K.cursorAtSelect, ...SELECT_POINT },
  { frame: K.resultStart, ...SELECT_POINT },
  { frame: K.cursorGone, x: SELECT_POINT.x + 70, y: SELECT_POINT.y + 60 },
];

// Зум камеры внутри сцены: из ТЗ, 1 → 1.04.
const CAMERA_ZOOM_TO = 1.04;
// Насколько вырастает выбранная карточка в бите 4.
const SELECTED_CARD_SCALE = 1.06;

/* ────────────────────────────── Вспомогательные слои ───────────────────── */

// Круг, расходящийся от точки клика.
const ClickRipple: React.FC<{ point: Point; clickFrame: number }> = ({ point, clickFrame }) => {
  const frame = useCurrentFrame();
  const RIPPLE_FRAMES = 22;
  if (frame < clickFrame || frame > clickFrame + RIPPLE_FRAMES) {
    return null;
  }
  const size = interpolate(frame, [clickFrame, clickFrame + RIPPLE_FRAMES], [12, 200], {
    ...CLAMP,
    easing: EASE_OUT,
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: point.x - size / 2,
        top: point.y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${theme.color.accentBright}`,
        background: theme.color.accentBrightSoft,
        opacity: interpolate(frame, [clickFrame, clickFrame + RIPPLE_FRAMES], [0.55, 0], CLAMP),
        zIndex: 40,
      }}
    />
  );
};

// Сверстанный макет экрана QAJET: шапка, поле запроса, карточки вариантов.
const MockApp: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Бит 1: печатающийся текст — срезаем строку по кадру.
  const typedChars = Math.floor(
    interpolate(frame, [K.typeStart, K.typeEnd], [0, DEMO.requestText.length], CLAMP),
  );
  const typed = DEMO.requestText.slice(0, typedChars);
  const isTyping = frame >= K.typeStart && frame < K.typeEnd;
  const inputFocused = frame >= K.typeStart - 6 && frame < K.searchClick;
  // Каретка: сплошная во время печати, мигает (8 кадров вкл / 8 выкл) в паузах.
  const caretVisible = inputFocused && (isTyping || Math.floor(frame / 8) % 2 === 0);

  // Бит 4: прогресс «результата» — затухание соседей и рост выбранной карточки.
  const result = springAt(frame, fps, K.resultStart);

  return (
    <AbsoluteFill style={{ fontFamily: theme.font.family, color: theme.color.text }}>
      {/* Шапка приложения */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: VIEWPORT.width,
          height: LAYOUT.headerHeight,
          boxSizing: 'border-box',
          padding: `0 ${LAYOUT.padX}px`,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          background: theme.color.surface,
          borderBottom: `1px solid ${theme.color.border}`,
        }}
      >
        <Logo size={30} />
        <div style={{ width: 1, height: 26, background: theme.color.borderStrong }} />
        <span style={{ fontSize: 19, color: theme.color.textMuted }}>{DEMO.appSection}</span>
        <div
          style={{
            marginLeft: 'auto',
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: theme.color.background,
            border: `1px solid ${theme.color.border}`,
          }}
        />
      </div>

      {/* Бит 1: заголовок и поле запроса */}
      <div
        style={{
          position: 'absolute',
          left: LAYOUT.padX,
          top: LAYOUT.titleY,
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: '-0.02em',
        }}
      >
        {DEMO.requestTitle}
      </div>
      <div
        style={{
          position: 'absolute',
          left: LAYOUT.padX,
          top: LAYOUT.inputY,
          width: INPUT_WIDTH,
          height: LAYOUT.inputHeight,
          boxSizing: 'border-box',
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          borderRadius: theme.radius.control + 2,
          background: theme.color.surface,
          border: `1.5px solid ${inputFocused ? theme.color.accentBright : theme.color.borderStrong}`,
          boxShadow: inputFocused
            ? `0 0 0 5px ${theme.color.accentBrightSoft}, ${theme.shadow.card}`
            : theme.shadow.card,
          fontSize: 25,
          whiteSpace: 'pre',
        }}
      >
        {typed.length > 0 ? (
          <span>{typed}</span>
        ) : (
          <span style={{ color: theme.color.textFaint }}>{DEMO.requestPlaceholder}</span>
        )}
        {/* Каретка: после текста, а пока поле пустое — перед плейсхолдером */}
        <span
          style={{
            display: 'inline-block',
            width: 2.5,
            height: 30,
            marginLeft: typed.length > 0 ? 2 : 0,
            marginRight: typed.length > 0 ? 0 : 4,
            background: theme.color.accentBright,
            opacity: caretVisible ? 1 : 0,
            order: typed.length > 0 ? 1 : -1,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: SEARCH_X,
          top: LAYOUT.inputY,
          width: LAYOUT.searchWidth,
          height: LAYOUT.inputHeight,
          borderRadius: theme.radius.control + 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme.color.accent,
          color: theme.color.accentText,
          boxShadow: theme.shadow.button,
          fontSize: 23,
          fontWeight: 600,
          scale: String(pressScale(frame, fps, K.searchClick)),
        }}
      >
        {DEMO.searchButton}
      </div>

      {/* Бит 2: заголовок блока вариантов */}
      <div
        style={{
          position: 'absolute',
          left: LAYOUT.padX,
          top: LAYOUT.resultsTitleY,
          fontSize: 22,
          fontWeight: 600,
          color: theme.color.textMuted,
          opacity: interpolate(frame, [K.resultsTitleIn, K.resultsTitleIn + 12], [0, 1], CLAMP),
          translate: `0 ${interpolate(frame, [K.resultsTitleIn, K.resultsTitleIn + 12], [10, 0], {
            ...CLAMP,
            easing: EASE_OUT,
          })}px`,
        }}
      >
        {DEMO.resultsTitle}
      </div>

      {/* Бит 2–4: карточки вариантов */}
      {PROPOSALS.map((proposal, i) => {
        const start = K.cardsIn + i * K.cardStagger;
        const RISE_PX = 70;
        const riseAt = (f: number): number => (1 - springAt(f, fps, start)) * RISE_PX;
        const appear = springAt(frame, fps, start);
        const isChosen = i === OPTIMAL_INDEX;
        // Бит 4: соседние карточки гаснут и слегка уходят в фокус-размытие.
        const dimOpacity = isChosen ? 1 : interpolate(result, [0, 1], [1, 0.16], CLAMP);
        const dimBlur = isChosen ? 0 : interpolate(result, [0, 1], [0, 3], CLAMP);
        const scale = isChosen
          ? interpolate(result, [0, 1], [1, SELECTED_CARD_SCALE], CLAMP)
          : interpolate(result, [0, 1], [1, 0.96], CLAMP);
        const lift = isChosen ? interpolate(result, [0, 1], [0, -12], CLAMP) : 0;

        return (
          <ProposalCard
            key={proposal.supplier}
            proposal={proposal}
            width={CARD_WIDTH}
            height={LAYOUT.cardHeight}
            buttonScale={isChosen ? pressScale(frame, fps, K.selectClick) : 1}
            selected={isChosen && frame >= K.selectClick + 6}
            style={{
              left: cardX(i),
              top: LAYOUT.cardsY,
              zIndex: isChosen ? 2 : 1,
              opacity: interpolate(appear, [0, 1], [0, 1], CLAMP) * dimOpacity,
              translate: `0 ${riseAt(frame) + lift}px`,
              scale: String(scale),
              // Motion blur по скорости подъёма + размытие затухающих соседей.
              filter: `blur(${velocityBlur(riseAt, frame, 0.15, 4) + dimBlur}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* ─────────────────────────────────── Сцена ─────────────────────────────── */

type Props = {
  // Длительность сцены из TIMING в MainSequence: на неё растягивается зум камеры.
  durationInFrames: number;
};

export const ProductDemo: React.FC<Props> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cursor = pointOnPath(frame, CURSOR_PATH);
  const cursorOpacity = interpolate(
    frame,
    [K.cursorEnter, K.cursorEnter + 6, K.cursorFadeOut, K.cursorGone],
    [0, 1, 1, 0],
    CLAMP,
  );
  // Курсор «нажимается» на каждом клике.
  const cursorScale =
    interpolate(
      frame,
      [K.searchClick - 2, K.searchClick + 1, K.searchClick + 7],
      [1, 0.84, 1],
      CLAMP,
    ) *
    interpolate(
      frame,
      [K.selectClick - 2, K.selectClick + 1, K.selectClick + 7],
      [1, 0.84, 1],
      CLAMP,
    );

  // Тост выезжает сверху пружиной; motion blur по вертикальной скорости.
  const TOAST_FROM_Y = -140;
  const TOAST_TO_Y = 40;
  const toastY = (f: number): number =>
    interpolate(springAt(f, fps, K.toastIn), [0, 1], [TOAST_FROM_Y, TOAST_TO_Y], CLAMP);
  const check = interpolate(frame, [K.checkStart, K.checkEnd], [0, 1], {
    ...CLAMP,
    easing: EASE_OUT,
  });

  return (
    // Фон общий (MainSequence), сцена прозрачная.
    <AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {/* Камера: медленный наезд на всё окно браузера вместе с курсором */}
        <div
          style={{
            scale: String(interpolate(frame, [0, durationInFrames], [1, CAMERA_ZOOM_TO], CLAMP)),
          }}
        >
          <BrowserFrame width={BROWSER.width} height={BROWSER.height}>
            {USE_SCREENSHOT ? (
              <Img
                src={staticFile(SCREENSHOT.src)}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'top left',
                }}
              />
            ) : (
              <MockApp />
            )}
            <ClickRipple point={SEARCH_POINT} clickFrame={K.searchClick} />
            <ClickRipple point={SELECT_POINT} clickFrame={K.selectClick} />
            <Cursor
              x={cursor.x}
              y={cursor.y}
              scale={cursorScale}
              opacity={cursorOpacity}
              blur={velocityBlur2D((f) => pointOnPath(f, CURSOR_PATH), frame)}
            />
          </BrowserFrame>
        </div>
      </AbsoluteFill>

      {frame >= K.toastIn ? (
        <Toast
          checkProgress={check}
          style={{
            left: '50%',
            top: toastY(frame),
            translate: '-50% 0',
            opacity: interpolate(frame, [K.toastIn, K.toastIn + 8], [0, 1], CLAMP),
            filter: `blur(${velocityBlur(toastY, frame, 0.08, 3)}px)`,
            zIndex: 100,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
