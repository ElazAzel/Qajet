import type React from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { continueRender, delayRender, interpolate, useCurrentFrame } from 'remotion';
import {
  ENGINE_PARSE,
  NEW_REQUEST,
  REQUEST_CITY,
  REQUEST_DATE_INPUT,
  REQUEST_TEXT,
  REQUEST_TITLE,
  REQUEST_TOKENS,
} from '../../content';
import { A_LAYOUT, fieldsY, J, previewOpen, scrollA } from '../../journey/script';
import { MAIN } from '../../lib/camera';
import {
  CLAMP,
  EASE_OUT,
  PRODUCT,
  pressScale,
  progress,
  reveal,
  typedLength,
  velocityBlur,
} from '../../lib/motion';
import { textStyle, theme } from '../../theme';
import { ChevronDown } from '../icons';
import { Button, Card, Caret, FieldLabel, InputBox } from '../primitives';

/**
 * Мастер новой заявки — реплика apps/web/app/buyer/requests/new/page.tsx.
 * Настоящий сценарий продукта: текст → «Разобрать» → «Что мы поняли» →
 * «Добавить в заявку» → поля заполнены → название → «Отправить заявку».
 */

type Rect = { x: number; y: number; w: number; h: number };
type TokenRects = { from: Rect[]; to: Rect[] };

/** Смещение элемента внутри контейнера по цепочке offsetParent (трансформации камеры не мешают). */
const offsetWithin = (el: HTMLElement, container: HTMLElement): Rect => {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== container) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
};

// Подсветка поля при автозаполнении: вспышка purple-10 и плавный уход.
const flashAt = (frame: number, start: number): number =>
  frame < start ? 0 : interpolate(frame, [start, start + 4, start + 26], [0, 1, 0], CLAMP);

export const NewRequestPage: React.FC = () => {
  const frame = useCurrentFrame();
  const L = A_LAYOUT;
  const scroll = scrollA(frame);
  const fy = fieldsY(frame);
  const open = previewOpen(frame);
  const accepted = frame >= J.aClickAccept + 2;

  const typedCount = typedLength(frame, J.aTypeStart, J.aTypeEnd, REQUEST_TEXT.length);
  const quickText = accepted ? '' : REQUEST_TEXT.slice(0, typedCount);
  const textareaFocused = frame >= J.aClickTextarea && frame < J.aClickParse;
  const parsing = frame >= J.aClickParse + 2 && frame < J.aParseDone;

  const titleText = REQUEST_TITLE.slice(
    0,
    typedLength(frame, J.aTitleTypeStart, J.aTitleTypeEnd, REQUEST_TITLE.length),
  );
  const titleFocused = frame >= J.aClickTitle && frame < J.aClickSubmit;
  const submitting = frame >= J.aClickSubmit + 2;

  // Позиции появились → строка позиции вместо пустого состояния.
  const items = progress(frame, J.aFillItems, PRODUCT.base, PRODUCT.decelerate);
  const footerOffset = interpolate(items, [0, 1], [450, L.footer], CLAMP);
  const cardBottom = fy + footerOffset + 40 + L.card.pad;

  // ── Измерение токенов: откуда летят (текст запроса) и куда (превью) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const fromRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const toRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const handleRef = useRef<number | null>(null);
  const [rects, setRects] = useState<TokenRects | null>(null);
  const needsRects = frame >= J.aTokensStart - 2 && frame < J.aClickAccept;

  useLayoutEffect(() => {
    if (!needsRects || rects || handleRef.current !== null) return;
    const handle = delayRender('Измерение токенов запроса');
    handleRef.current = handle;
    document.fonts.ready.then(() => {
      const container = containerRef.current;
      if (!container) return;
      const measure = (els: (HTMLSpanElement | null)[]): Rect[] =>
        els.map((el) => (el ? offsetWithin(el, container) : { x: 0, y: 0, w: 0, h: 0 }));
      setRects({ from: measure(fromRefs.current), to: measure(toRefs.current) });
    });
  }, [needsRects, rects]);

  useLayoutEffect(() => {
    if (rects && handleRef.current !== null) {
      continueRender(handleRef.current);
      handleRef.current = null;
    }
  }, [rects]);

  // Разбиваем текст запроса на куски: токены — отдельные span с подсветкой.
  const segments = splitByTokens(quickText);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: 0,
        top: -scroll,
        width: MAIN.width,
        height: 1400,
        fontFamily: theme.font.family,
        color: theme.color.ink,
      }}
    >
      {/* Хлебные крошки, заголовок */}
      <div
        style={{
          position: 'absolute',
          left: L.padX,
          top: L.crumbY,
          ...textStyle('fine'),
          color: theme.color.muted,
          ...reveal(frame, 10),
        }}
      >
        {NEW_REQUEST.crumbRoot}
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ fontWeight: 500, color: theme.color.ink }}>{NEW_REQUEST.crumb}</span>
      </div>
      <div style={{ position: 'absolute', left: L.padX, top: L.titleY, ...reveal(frame, 12) }}>
        <div style={{ ...textStyle('3xl'), fontWeight: 800, letterSpacing: '-0.01em' }}>
          {NEW_REQUEST.title}
        </div>
        <div style={{ ...textStyle('sm'), color: theme.color.muted, marginTop: 8 }}>
          {NEW_REQUEST.sub}
        </div>
      </div>

      {/* Основная карточка формы */}
      <Card
        padding={0}
        style={{
          position: 'absolute',
          left: L.card.x,
          top: L.gridY,
          width: L.card.w,
          height: cardBottom - L.gridY,
          ...reveal(frame, 14),
        }}
      >
        <div />
      </Card>
      <div
        style={{
          position: 'absolute',
          left: L.quick.x,
          top: L.gridY + L.card.pad,
          width: L.quick.w,
          ...reveal(frame, 14),
        }}
      >
        <div style={{ ...textStyle('lg'), fontWeight: 700 }}>{NEW_REQUEST.cardTitle}</div>
        <div style={{ ...textStyle('fine'), color: theme.color.muted, marginTop: 6 }}>
          {NEW_REQUEST.cardSub}
        </div>
      </div>

      {/* Блок «Что нужно закупить?» */}
      <div
        style={{
          position: 'absolute',
          left: L.quick.x,
          top: L.quick.y,
          width: L.quick.w,
          height: L.quickBottomBase - L.quick.y + L.previewGrow * open,
          boxSizing: 'border-box',
          borderRadius: theme.radius.control,
          background: theme.color.page,
          boxShadow: `inset 0 0 0 1px ${theme.color.rule}`,
          ...reveal(frame, 16),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: L.textarea.x,
          top: L.quickLabelY,
          ...textStyle('sm'),
          fontWeight: 700,
        }}
      >
        {NEW_REQUEST.quickLabel}
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.textarea.x,
          top: L.quickHintY,
          width: L.textarea.w,
          ...textStyle('fine'),
          color: theme.color.muted,
          whiteSpace: 'nowrap',
        }}
      >
        {NEW_REQUEST.quickHint}
      </div>
      <InputBox
        surface
        multiline
        focused={textareaFocused}
        height={L.textarea.h}
        style={{ position: 'absolute', left: L.textarea.x, top: L.textarea.y, width: L.textarea.w }}
      >
        {quickText.length === 0 ? (
          <>
            {textareaFocused ? <Caret /> : null}
            <span style={{ color: theme.color.muted }}>
              300 welcome-наборов до 20 октября, бюджет 3 млн ₸
            </span>
          </>
        ) : (
          <span style={{ position: 'relative' }}>
            {segments.map((seg) =>
              seg.token === null ? (
                <span key={seg.key}>{seg.text}</span>
              ) : (
                <span
                  key={seg.key}
                  ref={(el) => {
                    fromRefs.current[seg.token ?? 0] = el;
                  }}
                  style={{
                    borderRadius: 4,
                    background: tokenMarker(frame, seg.token),
                  }}
                >
                  {seg.text}
                </span>
              ),
            )}
            {textareaFocused ? <Caret solid={frame < J.aTypeEnd} /> : null}
          </span>
        )}
      </InputBox>
      <Button
        label={NEW_REQUEST.parse}
        variant="secondary"
        size="sm"
        width={L.parseBtn.w}
        loading={parsing}
        scale={pressScale(frame, J.aClickParse)}
        style={{ position: 'absolute', left: L.parseBtn.x, top: L.parseBtn.y }}
      />

      {/* «Что мы поняли» — превью разбора (реальный вывод @qajet/engine/intake) */}
      {open > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: L.preview.x,
            top: L.preview.y,
            width: L.preview.w,
            height: L.preview.h * open,
            overflow: 'hidden',
            opacity: open,
            borderRadius: theme.radius.control,
            background: theme.color.purple10,
            boxShadow: 'inset 0 0 0 1px rgba(108, 93, 211, 0.4)',
            boxSizing: 'border-box',
            padding: 12,
            ...textStyle('fine'),
          }}
        >
          <div style={{ fontWeight: 600 }}>{NEW_REQUEST.previewTitle}</div>
          <div style={{ marginTop: 8, color: theme.color.muted }}>
            <span
              ref={(el) => {
                toRefs.current[0] = el;
              }}
              style={{ borderRadius: 4, background: landedMarker(frame, 0) }}
            >
              «{ENGINE_PARSE.itemLabel}» · {ENGINE_PARSE.qty} {ENGINE_PARSE.unit}
            </span>
          </div>
          <div style={{ marginTop: 8, color: theme.color.muted }}>
            Срок:{' '}
            <span
              ref={(el) => {
                toRefs.current[1] = el;
              }}
              style={{ borderRadius: 4, background: landedMarker(frame, 1) }}
            >
              {ENGINE_PARSE.deadline}
            </span>{' '}
            · Бюджет:{' '}
            <span
              ref={(el) => {
                toRefs.current[2] = el;
              }}
              style={{ borderRadius: 4, background: landedMarker(frame, 2) }}
            >
              {`${ENGINE_PARSE.budgetKzt.toLocaleString('ru-RU')} ₸`}
            </span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Button
              label={NEW_REQUEST.accept}
              variant="primary"
              size="sm"
              width={L.acceptBtn.w}
              scale={pressScale(frame, J.aClickAccept)}
            />
            <Button label={NEW_REQUEST.dismiss} variant="secondary" size="sm" />
          </div>
        </div>
      ) : null}

      {/* Летящие токены: текст запроса → разобранные поля */}
      {rects && frame >= J.aTokensStart && frame < J.aClickAccept
        ? REQUEST_TOKENS.map((token, i) => (
            <TokenFlight
              key={token.text}
              text={token.text}
              from={rects.from[i]}
              to={rects.to[i]}
              start={J.aTokensStart + i * J.aTokenStagger}
              frame={frame}
            />
          ))
        : null}

      {/* Поля формы */}
      <FormFields
        frame={frame}
        fy={fy}
        items={items}
        titleText={titleText}
        titleFocused={titleFocused}
      />

      <Button
        label={NEW_REQUEST.cancel}
        variant="secondary"
        size="md"
        style={{ position: 'absolute', left: L.quick.x, top: fy + footerOffset, fontWeight: 500 }}
      />
      <Button
        label={submitting ? NEW_REQUEST.submitting : NEW_REQUEST.submit}
        variant="primary"
        size="md"
        width={L.submitBtn.w}
        loading={submitting}
        scale={pressScale(frame, J.aClickSubmit)}
        style={{
          position: 'absolute',
          left: L.card.x + L.card.w - L.card.pad - L.submitBtn.w,
          top: fy + footerOffset,
        }}
      />

      {/* Правая колонка: «Кратко о заявке» и «Что дальше?» */}
      <SidePanel frame={frame} />
    </div>
  );
};

// ─────────────────────────────── Поля формы ───────────────────────────────

const FormFields: React.FC<{
  frame: number;
  fy: number;
  items: number;
  titleText: string;
  titleFocused: boolean;
}> = ({ frame, fy, items, titleText, titleFocused }) => {
  const L = A_LAYOUT;
  const colW2 = (L.quick.w - 16) / 2;
  const colW3 = (L.quick.w - 32) / 3;
  const dateSet = frame >= J.aFillDate;
  const budgetSet = frame >= J.aFillBudget;
  return (
    <>
      <div style={{ position: 'absolute', left: L.quick.x, top: fy + L.rowTitle, width: colW2 }}>
        <FieldLabel label={NEW_REQUEST.fieldTitle} required />
        <InputBox
          value={titleText}
          placeholder={NEW_REQUEST.fieldTitlePlaceholder}
          focused={titleFocused}
          caret={titleFocused}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.quick.x + colW2 + 16,
          top: fy + L.rowTitle,
          width: colW2,
        }}
      >
        <FieldLabel label={NEW_REQUEST.fieldCity} required />
        <InputBox>
          <span style={{ flex: 1 }}>{REQUEST_CITY}</span>
          <ChevronDown size={16} color={theme.color.muted} />
        </InputBox>
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.quick.x,
          top: fy + L.rowDescription,
          width: L.quick.w,
        }}
      >
        <FieldLabel label={NEW_REQUEST.fieldDescription} />
        <InputBox multiline height={84} placeholder={NEW_REQUEST.fieldDescriptionPlaceholder} />
      </div>
      <div style={{ position: 'absolute', left: L.quick.x, top: fy + L.rowBudget, width: colW3 }}>
        <FieldLabel label={NEW_REQUEST.fieldBudget} />
        <InputBox
          value={budgetSet ? String(ENGINE_PARSE.budgetKzt) : ''}
          placeholder="1 200 000"
          flash={flashAt(frame, J.aFillBudget)}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.quick.x + colW3 + 16,
          top: fy + L.rowBudget,
          width: colW3,
        }}
      >
        <FieldLabel label={NEW_REQUEST.fieldDate} />
        <InputBox flash={flashAt(frame, J.aFillDate)}>
          <span style={{ flex: 1, color: dateSet ? theme.color.ink : theme.color.muted }}>
            {dateSet ? REQUEST_DATE_INPUT : 'дд.мм.гггг'}
          </span>
          <CalendarGlyph />
        </InputBox>
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.quick.x + 2 * (colW3 + 16),
          top: fy + L.rowBudget,
          width: colW3,
        }}
      >
        <FieldLabel label={NEW_REQUEST.fieldAddress} />
        <InputBox placeholder={NEW_REQUEST.fieldAddressPlaceholder} />
      </div>

      {/* Позиции */}
      <div
        style={{
          position: 'absolute',
          left: L.quick.x,
          top: fy + L.itemsLegend,
          ...textStyle('fine'),
          fontWeight: 600,
        }}
      >
        {NEW_REQUEST.itemsLegend} <span style={{ color: theme.color.muted }}>*</span>
      </div>
      {items < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: L.quick.x,
            top: fy + L.itemsRow,
            width: L.quick.w,
            height: 90,
            boxSizing: 'border-box',
            padding: 16,
            borderRadius: theme.radius.control,
            border: `1px dashed rgba(20, 20, 26, 0.16)`,
            opacity: 1 - items,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ ...textStyle('fine'), color: theme.color.muted }}>
            {NEW_REQUEST.itemsEmpty}
          </span>
          <Button label={NEW_REQUEST.itemsAddEmpty} variant="secondary" size="sm" />
        </div>
      ) : null}
      {items > 0 ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: L.quick.x,
              top: fy + L.itemsRow,
              width: L.quick.w,
              height: 90,
              boxSizing: 'border-box',
              padding: 12,
              borderRadius: theme.radius.control,
              background:
                flashAt(frame, J.aFillItems) > 0 ? theme.color.purple10 : theme.color.page,
              boxShadow: `inset 0 0 0 1px ${flashAt(frame, J.aFillItems) > 0.2 ? 'rgba(108, 93, 211, 0.4)' : theme.color.rule}`,
              display: 'grid',
              gridTemplateColumns: '1fr 140px auto',
              gap: 12,
              alignItems: 'end',
              opacity: items,
              translate: `0 ${(1 - items) * 6}px`,
            }}
          >
            <div>
              <div
                style={{
                  ...textStyle('micro'),
                  fontWeight: 600,
                  color: theme.color.muted,
                  marginBottom: 4,
                }}
              >
                {NEW_REQUEST.itemLabel}
              </div>
              <InputBox surface>
                <span style={{ flex: 1 }}>{ENGINE_PARSE.itemLabel}</span>
                <ChevronDown size={16} color={theme.color.muted} />
              </InputBox>
            </div>
            <div>
              <div
                style={{
                  ...textStyle('micro'),
                  fontWeight: 600,
                  color: theme.color.muted,
                  marginBottom: 4,
                }}
              >
                {NEW_REQUEST.itemQtyLabel}
              </div>
              <InputBox surface value={String(ENGINE_PARSE.qty)} />
            </div>
            <div
              style={{
                height: 46,
                boxSizing: 'border-box',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: theme.radius.control,
                boxShadow: `inset 0 0 0 1px ${theme.color.rule}`,
                color: theme.color.muted,
                ...textStyle('fine'),
              }}
            >
              {NEW_REQUEST.itemRemove}
            </div>
          </div>
          <Button
            label={NEW_REQUEST.itemsAddMore}
            variant="secondary"
            size="sm"
            style={{
              position: 'absolute',
              left: L.quick.x,
              top: fy + L.itemsRow + 102,
              opacity: items,
            }}
          />
        </>
      ) : null}
    </>
  );
};

// ───────────────────────────── Правая колонка ─────────────────────────────

const SidePanel: React.FC<{ frame: number }> = ({ frame }) => {
  const L = A_LAYOUT;
  const itemsSet = frame >= J.aFillItems;
  const dateSet = frame >= J.aFillDate;
  const budgetSet = frame >= J.aFillBudget;
  // В продукте дата и бюджет в этой карточке всегда серые и без форматирования
  // (`${budget} ₸`) — так и показываем.
  const rows: [string, string, boolean, number][] = [
    [NEW_REQUEST.summaryItems, itemsSet ? '1' : '0', true, J.aFillItems],
    [NEW_REQUEST.summaryCity, REQUEST_CITY, true, -100],
    [
      NEW_REQUEST.summaryDate,
      dateSet ? ENGINE_PARSE.deadline : NEW_REQUEST.notSetDate,
      false,
      J.aFillDate,
    ],
    [
      NEW_REQUEST.summaryBudget,
      budgetSet ? `${ENGINE_PARSE.budgetKzt} ₸` : NEW_REQUEST.notSetBudget,
      false,
      J.aFillBudget,
    ],
  ];
  return (
    <div
      style={{
        position: 'absolute',
        left: L.side.x,
        top: L.gridY,
        width: L.side.w,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <Card style={reveal(frame, 18)}>
        <div style={{ ...textStyle('sm'), fontWeight: 600, marginBottom: 16 }}>
          {NEW_REQUEST.summaryTitle}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...textStyle('fine') }}>
          {rows.map(([term, value, ink, changedAt]) => {
            const f = flashAt(frame, changedAt);
            return (
              <div
                key={term}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderTop: `1px solid ${theme.color.rule}`,
                  paddingTop: 10,
                }}
              >
                <span style={{ color: theme.color.muted }}>{term}</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: ink ? theme.color.ink : theme.color.muted,
                    borderRadius: 4,
                    padding: '0 4px',
                    margin: '0 -4px',
                    background: f > 0 ? `rgba(108, 93, 211, ${0.18 * f})` : 'transparent',
                  }}
                >
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
      <Card style={reveal(frame, 20)}>
        <div style={{ ...textStyle('sm'), fontWeight: 600, marginBottom: 16 }}>
          {NEW_REQUEST.nextTitle}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {NEW_REQUEST.nextSteps.map(([title, sub], i) => (
            <div key={title} style={{ display: 'flex', gap: 12 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: theme.color.page,
                  color: theme.color.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  ...textStyle('micro'),
                }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ ...textStyle('fine'), fontWeight: 600 }}>{title}</div>
                <div style={{ ...textStyle('micro'), color: theme.color.muted }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────── Эффекты страницы ─────────────────────────────

type Segment = { key: string; text: string; token: number | null };

/** Режет напечатанный текст по токенам: токен виден, только когда допечатан целиком. */
const splitByTokens = (typed: string): Segment[] => {
  const segments: Segment[] = [];
  let cursor = 0;
  REQUEST_TOKENS.forEach((token, i) => {
    const start = REQUEST_TEXT.indexOf(token.text);
    const end = start + token.text.length;
    if (start > cursor) {
      segments.push({
        key: `plain-${i}`,
        text: typed.slice(cursor, Math.min(start, typed.length)),
        token: null,
      });
    }
    if (typed.length >= end) {
      segments.push({ key: `token-${i}`, text: token.text, token: i });
    } else if (typed.length > start) {
      segments.push({ key: `partial-${i}`, text: typed.slice(start, typed.length), token: null });
    }
    cursor = end;
  });
  if (typed.length > cursor) {
    segments.push({ key: 'tail', text: typed.slice(cursor), token: null });
  }
  return segments.filter((s) => s.text.length > 0);
};

// Маркер токена в тексте запроса: загорается перед вылетом.
const tokenMarker = (frame: number, token: number | null): string => {
  if (token === null) return 'transparent';
  const start = J.aTokensStart + token * J.aTokenStagger - 4;
  const p = interpolate(
    frame,
    [start, start + 5, J.aClickAccept - 8, J.aClickAccept],
    [0, 1, 1, 0],
    CLAMP,
  );
  return `rgba(108, 93, 211, ${0.22 * p})`;
};

// Маркер в превью: вспыхивает, когда токен долетел.
const landedMarker = (frame: number, token: number): string => {
  const land = J.aTokensStart + token * J.aTokenStagger + J.aTokenFlight;
  const p = interpolate(frame, [land - 2, land + 2, land + 22], [0, 1, 0.35], CLAMP);
  return `rgba(108, 93, 211, ${0.28 * p})`;
};

/** Копия токена летит по дуге из текста запроса в разобранное поле. */
const TokenFlight: React.FC<{
  text: string;
  from: Rect;
  to: Rect;
  start: number;
  frame: number;
}> = ({ text, from, to, start, frame }) => {
  const dur = J.aTokenFlight;
  if (frame < start || frame > start + dur + 3) return null;
  const posX = (f: number): number =>
    interpolate(f, [start, start + dur], [from.x, to.x], { ...CLAMP, easing: EASE_OUT });
  const posY = (f: number): number => {
    const t = interpolate(f, [start, start + dur], [0, 1], { ...CLAMP, easing: EASE_OUT });
    return from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * 34;
  };
  const t = interpolate(frame, [start, start + dur], [0, 1], CLAMP);
  const blur = Math.max(velocityBlur(posX, frame, 0.06, 2.5), velocityBlur(posY, frame, 0.06, 2.5));
  return (
    <div
      style={{
        position: 'absolute',
        left: posX(frame) - 4,
        top: posY(frame) - 2,
        padding: '2px 4px',
        borderRadius: 6,
        background: theme.color.purple,
        color: theme.color.white,
        whiteSpace: 'nowrap',
        fontWeight: 600,
        ...textStyle('fine'),
        boxShadow: theme.shadow.overlay,
        // На подлёте токен сжимается и растворяется — на месте вспыхивает разобранное поле.
        scale: String(interpolate(t, [0, 0.15, 0.7, 1], [1, 1.08, 1, 0.7], CLAMP)),
        opacity: interpolate(
          frame,
          [start, start + 2, start + dur - 5, start + dur],
          [0, 1, 1, 0],
          CLAMP,
        ),
        filter: `blur(${blur}px)`,
        zIndex: 20,
      }}
    >
      {text}
    </div>
  );
};

// Значок календаря в поле type="date" (как рисует Chrome).
const CalendarGlyph: React.FC = () => (
  <svg
    aria-hidden="true"
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke={theme.color.ink}
    strokeWidth={2}
  >
    <rect x={3} y={4} width={18} height={18} rx={2} />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
