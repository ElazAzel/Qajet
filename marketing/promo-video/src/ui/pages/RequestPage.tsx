import type React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import {
  CASE,
  type CaseStageKey,
  DOCUMENTS,
  ENGINE_PARSE,
  formatKzt,
  ORDER_EVENTS,
  PLAN_VIEW,
  PLANS,
  planTotal,
  REJECTIONS,
  REQUEST_CITY,
  REQUEST_TITLE,
  STAGES,
  supplierWord,
} from '../../content';
import {
  ALT_CARD_W,
  B_LAYOUT,
  J,
  STAGE_STEPS,
  scrollB,
  stageAt,
  statusCardHeight,
} from '../../journey/script';
import { MAIN } from '../../lib/camera';
import { CLAMP, countUp, PRODUCT, pressScale, progress, reveal } from '../../lib/motion';
import { textStyle, theme } from '../../theme';
import { Share2 } from '../icons';
import { Button, Card, DefRow, Pill } from '../primitives';

/**
 * Страница закупки — реплика apps/web/app/buyer/requests/[id]/page.tsx
 * и BuyerOrderView (orders/[id]/_order-view.tsx). Один адрес на всю жизнь
 * закупки: «на каком мы этапе, чей ход и что делать дальше».
 * Одна и та же страница показывает таймлапс стадий до выбора варианта (B)
 * и после подтверждения (D).
 */

// Заголовки стадий помещаются в одну строку карточки (672px) и в Helvetica Neue, и в Arimo.
const statusHeightOf = (key: CaseStageKey): number => {
  const s = STAGES[key];
  return statusCardHeight(1, s.waiting ? 3 : 2, s.action !== null);
};

const RECOMMENDED = PLANS[0];

export const RequestPage: React.FC = () => {
  const frame = useCurrentFrame();
  const L = B_LAYOUT;
  const scroll = scrollB(frame);
  const { key, changedAt } = stageAt(frame);
  const stage = STAGES[key];
  const isD = frame >= J.routeD;

  // Высота карточки статуса плавно меняется при смене стадии (base, decelerate).
  const idx = STAGE_STEPS.findIndex((s) => s.frame === changedAt);
  const prevKey = idx > 0 ? STAGE_STEPS[idx - 1].value : key;
  const hp = progress(frame, changedAt, PRODUCT.base, PRODUCT.decelerate);
  const statusH = interpolate(hp, [0, 1], [statusHeightOf(prevKey), statusHeightOf(key)], CLAMP);

  const planShown = key !== 'received' && key !== 'estimated' && key !== 'sourcing';
  const closed = key === 'closed';
  const planH = isD ? L.planApproved : L.planProposed;

  // Вертикальный стек блоков страницы.
  const yComposition = L.statusY + statusH + L.gap;
  const yPlan = yComposition + L.composition + L.gap;
  const yRejections = yPlan + planH + L.gap;
  const yClosed = yRejections + L.rejections + L.gap;
  const yDocuments = yClosed + L.closed + L.gap;
  const yHistory = closed ? yDocuments + L.documents + L.gap : yClosed;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: -scroll,
        width: MAIN.width,
        height: 1800,
        fontFamily: theme.font.family,
        color: theme.color.ink,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: L.x,
          top: L.crumbY,
          ...textStyle('fine'),
          color: theme.color.muted,
        }}
      >
        Закупки<span style={{ margin: '0 6px' }}>›</span>
        <span style={{ fontWeight: 500, color: theme.color.ink }}>{REQUEST_TITLE}</span>
      </div>

      {/* Пилюля стадии, заголовок, «поделиться» */}
      <div
        style={{
          position: 'absolute',
          left: L.x,
          top: L.headerY,
          width: L.w,
          display: 'flex',
          justifyContent: 'space-between',
          ...reveal(frame, J.routeB),
        }}
      >
        <div>
          <Pill key={key + changedAt} tone={stage.tone} label={stage.label} changedAt={changedAt} />
          <div
            style={{ ...textStyle('2xl'), fontWeight: 800, letterSpacing: '-0.01em', marginTop: 8 }}
          >
            {REQUEST_TITLE}
          </div>
        </div>
        <div
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.color.muted,
          }}
        >
          <Share2 size={16} />
        </div>
      </div>

      {/* Карточка «что происходит сейчас» */}
      <Card
        style={{
          position: 'absolute',
          left: L.x,
          top: L.statusY,
          width: L.w,
          height: statusH,
          overflow: 'hidden',
          ...reveal(frame, J.routeB + 2),
        }}
      >
        <div key={`h-${key}`} style={{ ...textStyle('sm'), ...reveal(frame, changedAt) }}>
          {stage.headline}
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stage.waiting ? (
            <DefRow
              term={CASE.waitingOn}
              value={
                <WaitingValue
                  key={`w-${key}`}
                  value={stage.waiting}
                  changedAt={changedAt}
                  frame={frame}
                />
              }
            />
          ) : null}
          <DefRow term={CASE.expected} value={stage.expected} />
          <DefRow term={CASE.updated} value={stage.updated} strong={false} />
        </div>
        {stage.action ? (
          <div key={`a-${key}`} style={{ marginTop: 16, ...reveal(frame, changedAt + 2) }}>
            <Button
              label={stage.action}
              variant="primary"
              size="md"
              width={L.statusActionW[stage.action]}
              scale={
                stage.action === 'Принять поставку'
                  ? pressScale(frame, J.dClickAccept)
                  : stage.action === 'Подтвердить сверку и закрыть'
                    ? pressScale(frame, J.dClickClose)
                    : 1
              }
            />
          </div>
        ) : null}
      </Card>

      {/* Состав заявки */}
      <Card
        style={{
          position: 'absolute',
          left: L.x,
          top: yComposition,
          width: L.w,
          height: L.composition,
          ...reveal(frame, J.routeB + 4),
        }}
      >
        <div style={{ ...textStyle('sm'), fontWeight: 700 }}>{CASE.compositionTitle}</div>
        <div style={{ marginTop: 12 }}>
          <DefRow
            term={ENGINE_PARSE.itemLabel}
            value={`${ENGINE_PARSE.qty} ${ENGINE_PARSE.unit}`}
            strong={false}
            style={{ color: theme.color.ink }}
          />
        </div>
        <div
          style={{
            marginTop: 12,
            borderTop: `1px solid ${theme.color.rule}`,
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <DefRow first term={CASE.city} value={REQUEST_CITY} strong={false} />
          <DefRow
            first
            term={CASE.budget}
            value={formatKzt(ENGINE_PARSE.budgetKzt)}
            strong={false}
          />
        </div>
      </Card>

      {planShown ? (
        <>
          <PlanCard
            frame={frame}
            y={yPlan}
            approved={isD}
            shownAt={isD ? J.routeD : J.bProposed + 2}
          />
          <Card
            style={{
              position: 'absolute',
              left: L.x,
              top: yRejections,
              width: L.w,
              height: L.rejections,
              ...reveal(frame, isD ? J.routeD : J.bProposed + 4),
            }}
          >
            <div style={{ ...textStyle('sm'), fontWeight: 700 }}>{PLAN_VIEW.rejectionsTitle}</div>
            <div style={{ ...textStyle('fine'), color: theme.color.muted, marginTop: 4 }}>
              {PLAN_VIEW.rejectionsSub}
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {REJECTIONS.map((r, i) => (
                <DefRow
                  key={r.reason}
                  first={i === 0}
                  term={r.reason}
                  value={String(r.count)}
                  strong={false}
                  style={{ color: theme.color.ink }}
                />
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {closed ? (
        <>
          <Card
            style={{
              position: 'absolute',
              left: L.x,
              top: yClosed,
              width: L.w,
              height: L.closed,
              ...reveal(frame, J.dClosed + 2),
            }}
          >
            <div style={{ ...textStyle('sm'), fontWeight: 700 }}>{PLAN_VIEW.closedTitle}</div>
            <div style={{ marginTop: 8 }}>
              <DefRow
                first
                term={PLAN_VIEW.finalCost}
                value={formatKzt(planTotal(RECOMMENDED))}
                strong={false}
              />
            </div>
          </Card>
          <Card
            style={{
              position: 'absolute',
              left: L.x,
              top: yDocuments,
              width: L.w,
              height: L.documents,
              ...reveal(frame, J.dClosed + 4),
            }}
          >
            <div style={{ ...textStyle('sm'), fontWeight: 700 }}>{PLAN_VIEW.documentsTitle}</div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DOCUMENTS.map((doc, i) => {
                const start = J.dDocs + i * 5;
                const flash = interpolate(frame, [start, start + 4, start + 24], [0, 1, 0], CLAMP);
                return (
                  <div
                    key={doc}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: i === 0 ? 'none' : `1px solid ${theme.color.rule}`,
                      paddingTop: i === 0 ? 0 : 8,
                      ...textStyle('fine'),
                      ...reveal(frame, start),
                    }}
                  >
                    <span
                      style={{
                        borderRadius: 4,
                        padding: '0 4px',
                        margin: '0 -4px',
                        background: `rgba(108, 93, 211, ${0.2 * flash})`,
                      }}
                    >
                      {doc}
                    </span>
                    <span style={{ display: 'flex', gap: 12, fontWeight: 600 }}>
                      <span style={{ color: theme.color.purple }}>{PLAN_VIEW.open}</span>
                      <span style={{ color: theme.color.muted }}>{PLAN_VIEW.print}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      ) : null}

      {isD ? (
        <div style={{ position: 'absolute', left: L.x, top: yHistory, width: L.w }}>
          <div style={{ ...textStyle('sm'), fontWeight: 700 }}>{PLAN_VIEW.historyTitle}</div>
          <div style={{ marginTop: 12 }}>
            {ORDER_EVENTS.map((e, i) => (
              <div
                key={e.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: i === 0 ? 'none' : `1px solid ${theme.color.rule}`,
                  padding: '12px 0',
                  ...reveal(frame, J.dDocs + 6 + i * PRODUCT.stagger * 2),
                }}
              >
                <div>
                  <div style={{ ...textStyle('sm'), fontWeight: 500 }}>{e.label}</div>
                  <div style={{ ...textStyle('fine'), color: theme.color.muted, marginTop: 2 }}>
                    {e.actor}
                  </div>
                </div>
                <span style={{ ...textStyle('fine'), color: theme.color.muted }}>{e.at}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** «Сейчас ход за»: при смене значения — фиолетовая вспышка; «Вы» остаётся подсвеченным. */
const WaitingValue: React.FC<{ value: string; changedAt: number; frame: number }> = ({
  value,
  changedAt,
  frame,
}) => {
  const you = value === 'Вы';
  const p = progress(frame, changedAt, PRODUCT.quick, PRODUCT.decelerate);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0 6px',
        margin: '0 -6px',
        borderRadius: theme.radius.pill,
        background: you ? `rgba(108, 93, 211, ${0.14 * p})` : 'transparent',
        color: you ? theme.color.purple : theme.color.ink,
        opacity: p,
        translate: `0 ${(1 - p) * 4}px`,
      }}
    >
      {value}
    </span>
  );
};

// ──────────────────────────── Карточка плана ─────────────────────────────

const PlanCard: React.FC<{ frame: number; y: number; approved: boolean; shownAt: number }> = ({
  frame,
  y,
  approved,
  shownAt,
}) => {
  const L = B_LAYOUT;
  const p = RECOMMENDED;
  const countFrom = approved ? -100 : J.bCountUp;
  return (
    <Card
      style={{
        position: 'absolute',
        left: L.x,
        top: y,
        width: L.w,
        height: approved ? L.planApproved : L.planProposed,
        ...reveal(frame, shownAt),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ ...textStyle('fine'), fontWeight: 600, color: theme.color.muted }}>
            {p.label}
          </div>
          <div
            style={{
              ...textStyle('xl'),
              fontWeight: 800,
              marginTop: 2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatKzt(countUp(frame, countFrom, planTotal(p)))}
          </div>
        </div>
        <div style={{ ...textStyle('fine'), color: theme.color.muted, textAlign: 'right' }}>
          <div>
            Срок {p.eta} · запас {p.slackDays} дн.
          </div>
          <div>
            {p.suppliers} {supplierWord(p.suppliers)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <DefRow first term={PLAN_VIEW.delivery} value={formatKzt(p.delivery)} strong={false} />
      </div>
      {approved ? null : (
        <div style={{ marginTop: 16 }}>
          <Button
            label={PLAN_VIEW.toConfirm}
            variant="primary"
            size="md"
            width={L.planCtaW}
            scale={pressScale(frame, J.bClickConfirm)}
          />
        </div>
      )}
      <div
        style={{ marginTop: 16, ...textStyle('fine'), fontWeight: 600, color: theme.color.purple }}
      >
        {PLAN_VIEW.history}
      </div>
      {approved ? null : (
        <div style={{ marginTop: 16, borderTop: `1px solid ${theme.color.rule}`, paddingTop: 16 }}>
          <div style={{ ...textStyle('fine'), fontWeight: 600 }}>{PLAN_VIEW.chooseTitle}</div>
          <div style={{ ...textStyle('fine'), color: theme.color.muted, marginTop: 4 }}>
            {PLAN_VIEW.chooseSub}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: L.altGap }}>
            {PLANS.map((plan, i) => {
              const selected = plan.key === 'recommended';
              return (
                <Card
                  key={plan.key}
                  style={{
                    width: ALT_CARD_W,
                    height: L.altH,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: `inset 0 0 0 1px ${selected ? theme.color.purple : theme.color.rule}`,
                    ...reveal(frame, J.bScrollEnd - 6 + i * PRODUCT.stagger),
                  }}
                >
                  <div style={{ ...textStyle('fine'), fontWeight: 600 }}>{plan.label}</div>
                  <div
                    style={{
                      ...textStyle('lg'),
                      fontWeight: 800,
                      marginTop: 4,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatKzt(countUp(frame, J.bCountUp + i * PRODUCT.stagger, planTotal(plan)))}
                  </div>
                  <div style={{ ...textStyle('micro'), color: theme.color.muted, marginTop: 4 }}>
                    Доставка {formatKzt(plan.delivery)} · запас {plan.slackDays} дн.
                  </div>
                  <Button
                    label={selected ? PLAN_VIEW.selected : PLAN_VIEW.select}
                    variant={selected ? 'primary' : 'secondary'}
                    size="sm"
                    width="100%"
                    // В продукте выбранный вариант — disabled-кнопка (opacity 40 %).
                    style={{ marginTop: 'auto', opacity: selected ? 0.4 : 1 }}
                  />
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};
