import { interpolate } from 'remotion';
import { type CaseStageKey, PLANS } from '../content';
import { type CameraKey, pageToWindow } from '../lib/camera';
import {
  CLAMP,
  EASE_IN_OUT,
  type PathKeyframe,
  type Point,
  PRODUCT,
  progress,
} from '../lib/motion';

/**
 * СЦЕНАРИЙ ПУТИ ПОКУПАТЕЛЯ. Все ключевые кадры — здесь.
 *
 * Кадры локальные: 0 = начало сцены Journey (см. TIMING в MainSequence).
 * Раскладка страниц (A_LAYOUT, B_LAYOUT, C_LAYOUT) — в координатах основной
 * области продукта (правее сайдбара, ниже хедера). Из неё же считаются
 * точки кликов и фокус камеры, поэтому правка раскладки двигает курсор
 * и камеру вместе с кнопками.
 */

// ───────────────────────────── Ключевые кадры ─────────────────────────────
export const J = {
  // Вход окна в кадр (3D-наклон → ровно).
  enterStart: 0,
  enterEnd: 44,

  // A. Новая заявка
  aCursorIn: 30,
  aClickTextarea: 44,
  aTypeStart: 48,
  aTypeEnd: 96,
  aClickParse: 106,
  aParseDone: 120,
  aTokensStart: 124,
  aTokenStagger: 7,
  aTokenFlight: 16,
  aClickAccept: 166,
  aScrollStart: 168,
  aScrollEnd: 190,
  aFillItems: 184,
  aFillDate: 190,
  aFillBudget: 196,
  aClickTitle: 206,
  aTitleTypeStart: 208,
  aTitleTypeEnd: 222,
  aScroll2Start: 214,
  aScroll2End: 230,
  aClickSubmit: 238,
  routeB: 254,

  // B. Закупка: таймлапс стадий и варианты
  bEstimated: 282,
  bSourcing: 304,
  bProposed: 328,
  bScrollStart: 342,
  bScrollEnd: 362,
  bCountUp: 352,
  barsIn: 374,
  barsGrow: 388,
  barsZoomIn: 416,
  barsCallout: 426,
  barsZoomOut: 448,
  barsOut: 458,
  bClickConfirm: 476,
  routeC: 486,

  // C. Подтверждение заказа
  cScroll1Start: 496,
  cScroll1End: 514,
  cCountUp: 506,
  cScroll2Start: 524,
  cScroll2End: 542,
  cClickCta: 554,
  cAudit: 562,
  routeD: 574,

  // D. Исполнение → документы
  dProduction: 592,
  dShipped: 606,
  dDelivered: 618,
  dClickAccept: 632,
  dAccepted: 636,
  dClickClose: 648,
  dClosed: 652,
  dScrollStart: 658,
  dScrollEnd: 680,
  dDocs: 666,
  exitStart: 684,
  end: 710,
} as const;

// Подписи шагов ролика: появление, уход и место. Внизу слева по умолчанию;
// наверху — там, где кнопка клика оказывается у нижнего края кадра.
export const CAPTION_TIMES = {
  describe: { start: 40, end: 120, top: false },
  autofill: { start: 130, end: 232, top: false },
  sourcing: { start: 270, end: 338, top: false },
  compare: { start: 398, end: 468, top: false },
  approve: { start: 494, end: 556, top: true },
  done: { start: 598, end: 690, top: false },
} as const;

// ─────────────────────────────── Маршруты ─────────────────────────────────
export type Route = 'newRequest' | 'request' | 'confirm';
export const routeAt = (frame: number): Route => {
  if (frame < J.routeB) return 'newRequest';
  if (frame < J.routeC) return 'request';
  if (frame < J.routeD) return 'confirm';
  return 'request';
};
/** Кадр, с которого показан текущий маршрут (для RouteTransition). */
export const routeStartAt = (frame: number): number => {
  if (frame < J.routeB) return 0;
  if (frame < J.routeC) return J.routeB;
  if (frame < J.routeD) return J.routeC;
  return J.routeD;
};

// ───────────────────────── Стадии закупки (страница B) ─────────────────────
export const STAGE_STEPS: readonly { frame: number; value: CaseStageKey }[] = [
  { frame: J.routeB, value: 'received' },
  { frame: J.bEstimated, value: 'estimated' },
  { frame: J.bSourcing, value: 'sourcing' },
  { frame: J.bProposed, value: 'planProposed' },
  { frame: J.routeD, value: 'planApproved' },
  { frame: J.dProduction, value: 'inProduction' },
  { frame: J.dShipped, value: 'shipped' },
  { frame: J.dDelivered, value: 'delivered' },
  { frame: J.dAccepted, value: 'accepted' },
  { frame: J.dClosed, value: 'closed' },
];

export const stageAt = (frame: number): { key: CaseStageKey; changedAt: number } => {
  let current = STAGE_STEPS[0];
  for (const s of STAGE_STEPS) {
    if (frame >= s.frame) current = s;
  }
  return { key: current.value, changedAt: current.frame };
};

// ─────────────────────── Раскладка A: мастер заявки ────────────────────────
export const A_LAYOUT = {
  padX: 24,
  crumbY: 24,
  titleY: 58,
  subY: 102,
  gridY: 150,
  card: { x: 24, w: 788, pad: 28 },
  cardSubY: 212,
  quick: { x: 52, y: 268, w: 732, pad: 12 },
  // Внутри блока «Что нужно закупить?» (координаты страницы).
  quickLabelY: 280,
  quickHintY: 304,
  textarea: { x: 64, y: 330, w: 708, h: 84 },
  parseBtn: { x: 64, y: 422, w: 100, h: 32 },
  preview: { x: 64, y: 462, w: 708, h: 134 },
  acceptBtn: { x: 76, y: 552, w: 150, h: 32 },
  // Нижняя граница блока без превью и прирост высоты с превью.
  quickBottomBase: 466,
  previewGrow: 142,
  // Поля формы: смещения от fieldsY.
  fieldsGap: 12,
  rowTitle: 0,
  rowDescription: 88,
  rowBudget: 214,
  itemsLegend: 310,
  itemsRow: 336,
  footer: 494,
  titleInput: { x: 52, w: 358 },
  submitBtn: { w: 156, h: 40 },
  side: { x: 836, w: 340 },
} as const;

/** Насколько раскрыт блок «Что мы поняли» (0..1). */
export const previewOpen = (frame: number): number => {
  if (frame < J.aParseDone) return 0;
  if (frame < J.aClickAccept + 2)
    return progress(frame, J.aParseDone, PRODUCT.base, PRODUCT.decelerate);
  return 1 - progress(frame, J.aClickAccept + 2, PRODUCT.base, PRODUCT.accelerate);
};

/** Верх блока полей формы: сдвигается, пока открыто превью. */
export const fieldsY = (frame: number): number =>
  A_LAYOUT.quickBottomBase + A_LAYOUT.previewGrow * previewOpen(frame) + A_LAYOUT.fieldsGap;

// Прокрутка страницы A: сначала к полям, потом к кнопке отправки.
export const A_SCROLL_MID = 200;
export const A_SCROLL_END = 306;
export const scrollA = (frame: number): number =>
  interpolate(
    frame,
    [J.aScrollStart, J.aScrollEnd, J.aScroll2Start, J.aScroll2End],
    [0, A_SCROLL_MID, A_SCROLL_MID, A_SCROLL_END],
    { ...CLAMP, easing: [EASE_IN_OUT, EASE_IN_OUT, EASE_IN_OUT] },
  );

// Центры кнопок (страница) для кликов.
const center = (r: { x: number; y: number; w: number; h: number }): Point => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});
const A_FIELDS_FINAL = A_LAYOUT.quickBottomBase + A_LAYOUT.fieldsGap;
export const A_POINTS = {
  textarea: { x: 200, y: A_LAYOUT.textarea.y + 42 },
  parse: center(A_LAYOUT.parseBtn),
  accept: center(A_LAYOUT.acceptBtn),
  title: { x: A_LAYOUT.titleInput.x + 150, y: A_FIELDS_FINAL + A_LAYOUT.rowTitle + 49 },
  submit: {
    x: A_LAYOUT.card.x + A_LAYOUT.card.w - A_LAYOUT.card.pad - A_LAYOUT.submitBtn.w / 2,
    y: A_FIELDS_FINAL + A_LAYOUT.footer + A_LAYOUT.submitBtn.h / 2,
  },
} as const;

// ──────────────────── Раскладка B: страница закупки ────────────────────────
export const B_LAYOUT = {
  x: 264,
  w: 672,
  pad: 20,
  crumbY: 24,
  headerY: 58,
  statusY: 148,
  gap: 24,
  // Высоты блоков (их считают страница и камера).
  composition: 168,
  planProposed: 485,
  planApproved: 156,
  rejections: 165,
  closed: 86,
  documents: 160,
  history: 480,
  // Внутри карточки плана.
  planCtaOffset: 118,
  planCtaW: 210,
  altOffset: 295,
  altH: 170,
  altGap: 12,
  statusActionW: {
    'Выбрать вариант и утвердить': 226,
    'Оплатить счёт на предоплату': 232,
    'Принять поставку': 150,
    'Подтвердить сверку и закрыть': 236,
  } as Record<string, number>,
} as const;

/** Высота карточки статуса для стадии. */
export const statusCardHeight = (headlineLines: number, rows: number, action: boolean): number =>
  20 + headlineLines * 20 + 12 + rows * 27 + (rows - 1) * 8 + (action ? 56 : 0) + 20;

// Прокрутка страницы B: к карточке плана, а в финале — к документам.
export const B_SCROLL_PLAN = 549;
export const B_SCROLL_DOCS = 800;
export const scrollB = (frame: number): number => {
  if (frame < J.routeC) {
    return interpolate(frame, [J.bScrollStart, J.bScrollEnd], [0, B_SCROLL_PLAN], {
      ...CLAMP,
      easing: EASE_IN_OUT,
    });
  }
  return interpolate(frame, [J.dScrollStart, J.dScrollEnd], [0, B_SCROLL_DOCS], {
    ...CLAMP,
    easing: EASE_IN_OUT,
  });
};

// Верх карточки плана в состоянии «план предложен» (для кликов и камеры).
const B_STATUS_PROPOSED = statusCardHeight(1, 3, true);
export const B_PLAN_Y =
  B_LAYOUT.statusY + B_STATUS_PROPOSED + B_LAYOUT.gap + B_LAYOUT.composition + B_LAYOUT.gap;
const ALT_W = (B_LAYOUT.w - 2 * B_LAYOUT.pad - 2 * B_LAYOUT.altGap) / 3;
export const B_POINTS = {
  toConfirm: {
    x: B_LAYOUT.x + B_LAYOUT.pad + B_LAYOUT.planCtaW / 2,
    y: B_PLAN_Y + B_LAYOUT.planCtaOffset + 20,
  },
  cheaperCard: {
    x: B_LAYOUT.x + B_LAYOUT.pad + 1 * (ALT_W + B_LAYOUT.altGap) + ALT_W / 2,
    y: B_PLAN_Y + B_LAYOUT.altOffset + B_LAYOUT.altH / 2,
  },
  // Кнопка действия в карточке статуса (однострочный заголовок, 3 строки dl).
  statusAction: (label: string): Point => ({
    x: B_LAYOUT.x + B_LAYOUT.pad + (B_LAYOUT.statusActionW[label] ?? 200) / 2,
    y: B_LAYOUT.statusY + 20 + 20 + 12 + 3 * 27 + 2 * 8 + 16 + 20,
  }),
} as const;
export const ALT_CARD_W = ALT_W;

// ───────────────── Раскладка C: подтверждение заказа ───────────────────────
export const C_LAYOUT = {
  x: 264,
  w: 672,
  backY: 24,
  titleY: 50,
  subY: 94,
  executorY: 158,
  customerY: 312,
  compositionY: 450,
  termY: 578,
  costY: 750,
  paymentY: 899,
  returnsY: 1035,
  ctaY: 1179,
  ctaW: 300,
} as const;
export const C_SCROLL_COST = 360;
export const C_SCROLL_CTA = 543;
export const scrollC = (frame: number): number =>
  interpolate(
    frame,
    [J.cScroll1Start, J.cScroll1End, J.cScroll2Start, J.cScroll2End],
    [0, C_SCROLL_COST, C_SCROLL_COST, C_SCROLL_CTA],
    { ...CLAMP, easing: [EASE_IN_OUT, EASE_IN_OUT, EASE_IN_OUT] },
  );
export const C_POINTS = {
  cta: { x: C_LAYOUT.x + C_LAYOUT.ctaW / 2, y: C_LAYOUT.ctaY + 20 },
} as const;

// ─────────────────────────── Камера ────────────────────────────────────────
// Фокус задаётся точкой окна; pageToWindow переводит точку страницы с учётом прокрутки.
const W = (x: number, y: number, scroll: number): { x: number; y: number } =>
  pageToWindow({ x, y }, scroll);
const WINDOW_CENTER = { x: 720, y: 429 };

const aQuick = W(418, 380, 0);
const aPreview = W(418, 470, 0);
const aWide = { x: 720, y: 470 };
const aTitle = W(A_POINTS.title.x + 120, A_POINTS.title.y, A_SCROLL_MID);
const aSubmit = W(A_POINTS.submit.x - 120, A_POINTS.submit.y - 70, A_SCROLL_END);
const bStatus = W(B_LAYOUT.x + 336, 215, 0);
const bPlan = W(B_LAYOUT.x + 336, B_PLAN_Y + 200, B_SCROLL_PLAN);
const bCta = W(B_POINTS.toConfirm.x + 180, B_POINTS.toConfirm.y + 40, B_SCROLL_PLAN);
const cTop = W(C_LAYOUT.x + 336, 330, 0);
const cCost = W(C_LAYOUT.x + 336, C_LAYOUT.costY + 66, C_SCROLL_COST);
const cCta = W(C_LAYOUT.x + 300, C_LAYOUT.ctaY - 20, C_SCROLL_CTA);
const dStatus = W(B_LAYOUT.x + 336, 230, 0);
const dDocs = W(B_LAYOUT.x + 336, 1020, B_SCROLL_DOCS);

export const CAMERA_KEYS: readonly CameraKey[] = [
  // Вход: окно летит снизу с наклоном, камера общая.
  { frame: 0, ...WINDOW_CENTER, zoom: 0.78, rotX: 34 },
  { frame: J.enterEnd, ...WINDOW_CENTER, zoom: 1.12, rotX: 0, ease: 'out' },
  // A: наезд на «Что нужно закупить?»
  { frame: 60, ...aQuick, zoom: 1.95 },
  { frame: J.aParseDone, ...aQuick, zoom: 2.05, ease: 'inOut' },
  { frame: J.aTokensStart + 8, ...aPreview, zoom: 1.8 },
  { frame: J.aClickAccept, ...aPreview, zoom: 1.85 },
  // Общий план: поля заполняются сами.
  { frame: J.aScrollEnd, ...aWide, zoom: 1.14, ease: 'inOut' },
  { frame: J.aFillBudget + 4, ...aWide, zoom: 1.16 },
  { frame: J.aClickTitle - 2, ...aTitle, zoom: 1.75, ease: 'whip' },
  { frame: J.aTitleTypeEnd, ...aTitle, zoom: 1.8 },
  { frame: J.aClickSubmit - 4, ...aSubmit, zoom: 1.6, ease: 'whip' },
  { frame: J.routeB, ...aSubmit, zoom: 1.62 },
  // B: статус закупки крупно — таймлапс стадий.
  { frame: J.routeB + 14, ...bStatus, zoom: 1.7, ease: 'whip' },
  { frame: J.bScrollStart, ...bStatus, zoom: 1.9 },
  // Отъезд к плану и вариантам.
  { frame: J.bScrollEnd, ...bPlan, zoom: 1.42, ease: 'inOut' },
  { frame: J.barsZoomOut + 10, ...bPlan, zoom: 1.46 },
  { frame: J.bClickConfirm - 4, ...bCta, zoom: 1.75, ease: 'inOut' },
  { frame: J.routeC, ...bCta, zoom: 1.78 },
  // C: подтверждение — сумма и кнопка.
  { frame: J.routeC + 8, ...cTop, zoom: 1.35, ease: 'inOut' },
  { frame: J.cScroll1Start, ...cTop, zoom: 1.38 },
  { frame: J.cScroll1End + 2, ...cCost, zoom: 2.05, ease: 'whip' },
  { frame: J.cScroll2Start, ...cCost, zoom: 2.1 },
  { frame: J.cScroll2End, ...cCta, zoom: 1.7, ease: 'inOut' },
  { frame: J.routeD, ...cCta, zoom: 1.72 },
  // D: исполнение — снова статус, потом документы.
  { frame: J.routeD + 12, ...dStatus, zoom: 1.8, ease: 'whip' },
  { frame: J.dScrollStart, ...dStatus, zoom: 1.85 },
  { frame: J.dScrollEnd, ...dDocs, zoom: 1.5, ease: 'inOut' },
  { frame: J.exitStart, ...dDocs, zoom: 1.52 },
  // Выход: общий план и уход окна вглубь.
  { frame: J.end, ...WINDOW_CENTER, zoom: 0.9, rotX: -14, ease: 'inOut' },
];

// ─────────────────────────── Курсор ────────────────────────────────────────
// Точки в координатах окна (прокрутка на момент клика учтена).
const pA = (p: Point, scroll: number): Point => pageToWindow(p, scroll);
const aside = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

const A_TEXTAREA = pA(A_POINTS.textarea, 0);
const A_PARSE = pA(A_POINTS.parse, 0);
const A_ACCEPT = pA(A_POINTS.accept, 0);
const A_TITLE = pA(A_POINTS.title, A_SCROLL_MID);
const A_SUBMIT = pA(A_POINTS.submit, A_SCROLL_END);
const B_CHEAPER = pA(B_POINTS.cheaperCard, B_SCROLL_PLAN);
const B_CONFIRM = pA(B_POINTS.toConfirm, B_SCROLL_PLAN);
const C_CTA = pA(C_POINTS.cta, C_SCROLL_CTA);
const D_ACCEPT = pA(B_POINTS.statusAction('Принять поставку'), 0);
const D_CLOSE = pA(B_POINTS.statusAction('Подтвердить сверку и закрыть'), 0);

export const CURSOR_PATH: readonly PathKeyframe[] = [
  { frame: J.aCursorIn, x: 1260, y: 820 },
  { frame: J.aClickTextarea - 2, ...A_TEXTAREA },
  { frame: J.aTypeStart + 12, ...aside(A_TEXTAREA, 260, 110) },
  { frame: J.aClickParse - 12, ...aside(A_TEXTAREA, 260, 110) },
  { frame: J.aClickParse - 2, ...A_PARSE },
  { frame: J.aParseDone + 8, ...aside(A_PARSE, 330, 150) },
  { frame: J.aClickAccept - 14, ...aside(A_PARSE, 330, 150) },
  { frame: J.aClickAccept - 2, ...A_ACCEPT },
  { frame: J.aScrollEnd, ...aside(A_ACCEPT, 420, 40) },
  { frame: J.aClickTitle - 12, ...aside(A_ACCEPT, 420, 40) },
  { frame: J.aClickTitle - 2, ...A_TITLE },
  { frame: J.aTitleTypeEnd, ...aside(A_TITLE, 200, 90) },
  { frame: J.aClickSubmit - 2, ...A_SUBMIT },
  { frame: J.routeB + 8, ...aside(A_SUBMIT, 120, 60) },
  { frame: J.bScrollEnd, x: 1100, y: 700 },
  { frame: J.barsIn - 6, ...B_CHEAPER },
  { frame: J.barsOut, ...aside(B_CHEAPER, 60, 40) },
  { frame: J.bClickConfirm - 2, ...B_CONFIRM },
  { frame: J.routeC + 10, ...aside(B_CONFIRM, 300, 200) },
  { frame: J.cScroll2End, ...aside(C_CTA, 260, -40) },
  { frame: J.cClickCta - 2, ...C_CTA },
  { frame: J.routeD + 10, ...aside(C_CTA, 240, -300) },
  { frame: J.dClickAccept - 12, ...aside(D_ACCEPT, 260, 120) },
  { frame: J.dClickAccept - 2, ...D_ACCEPT },
  { frame: J.dClickClose - 8, ...aside(D_CLOSE, 20, 40) },
  { frame: J.dClickClose - 2, ...D_CLOSE },
  { frame: J.dScrollEnd, ...aside(D_CLOSE, 320, 220) },
];

/** Видимость курсора: прячем на время таймлапсов и полос вариантов. */
export const cursorOpacity = (frame: number): number =>
  interpolate(
    frame,
    [
      J.aCursorIn,
      J.aCursorIn + 6,
      J.routeB + 6,
      J.routeB + 14,
      J.bScrollEnd,
      J.bScrollEnd + 8,
      J.barsIn,
      J.barsIn + 6,
      J.barsOut - 2,
      J.barsOut + 6,
      J.routeD + 20,
      J.routeD + 30,
      J.dClickClose + 8,
      J.dClickClose + 16,
    ],
    [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0],
    CLAMP,
  );

/** Все клики сцены: кадр и точка окна. Из этого списка рисуются вспышки и нажатия. */
export const CLICKS: readonly { frame: number; at: Point }[] = [
  { frame: J.aClickTextarea, at: A_TEXTAREA },
  { frame: J.aClickParse, at: A_PARSE },
  { frame: J.aClickAccept, at: A_ACCEPT },
  { frame: J.aClickTitle, at: A_TITLE },
  { frame: J.aClickSubmit, at: A_SUBMIT },
  { frame: J.bClickConfirm, at: B_CONFIRM },
  { frame: J.cClickCta, at: C_CTA },
  { frame: J.dClickAccept, at: D_ACCEPT },
  { frame: J.dClickClose, at: D_CLOSE },
];

// Суммы вариантов для масштаба полос: единая шкала для всех (§12).
export const BAR_SCALE_MAX = Math.max(
  ...PLANS.map((p) => p.goods + p.work + p.delivery + p.commission + p.taxEffect),
);
