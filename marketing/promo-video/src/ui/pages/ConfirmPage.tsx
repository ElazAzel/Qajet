import type React from 'react';
import { useCurrentFrame } from 'remotion';
import { CONFIRM, ENGINE_PARSE, formatKzt, PLANS, planTotal, REQUEST_TITLE } from '../../content';
import { C_LAYOUT, J, scrollC } from '../../journey/script';
import { MAIN } from '../../lib/camera';
import { countUp, PRODUCT, pressScale, reveal } from '../../lib/motion';
import { textStyle, theme } from '../../theme';
import { Button, Card, DefRow } from '../primitives';

/**
 * Подтверждение заказа — реплика apps/web/app/buyer/orders/[id]/confirm/page.tsx.
 * Реквизиты размыты: в ролике это демо-данные сида, а не настоящие счета.
 */

const RECOMMENDED = PLANS[0];

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ ...textStyle('fine'), fontWeight: 600, color: theme.color.muted }}>{children}</div>
);

const Blurred: React.FC<{ lines: readonly string[] }> = ({ lines }) => (
  <div style={{ ...textStyle('fine'), color: theme.color.muted, filter: 'blur(4px)' }}>
    {lines.map((l) => (
      <div key={l}>{l}</div>
    ))}
  </div>
);

export const ConfirmPage: React.FC = () => {
  const frame = useCurrentFrame();
  const L = C_LAYOUT;
  const scroll = scrollC(frame);
  const pending = frame >= J.cClickCta + 2;
  const r0 = J.routeC;
  const block = (i: number): { opacity: number; translate: string } =>
    reveal(frame, r0 + 2 + i * PRODUCT.stagger);

  return (
    <div
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
      <div style={{ position: 'absolute', left: L.x, top: L.backY, width: L.w, ...block(0) }}>
        <div style={{ ...textStyle('fine'), fontWeight: 600, color: theme.color.purple }}>
          {CONFIRM.back}
        </div>
        <div
          style={{ ...textStyle('3xl'), fontWeight: 800, letterSpacing: '-0.01em', marginTop: 8 }}
        >
          {CONFIRM.title}
        </div>
        <div style={{ ...textStyle('sm'), color: theme.color.muted, marginTop: 8 }}>
          {CONFIRM.sub}
        </div>
      </div>

      <Card style={{ position: 'absolute', left: L.x, top: L.executorY, width: L.w, ...block(1) }}>
        <Label>{CONFIRM.executor}</Label>
        <div style={{ marginTop: 8, ...textStyle('fine'), fontWeight: 600 }}>
          {CONFIRM.executorName}
        </div>
        <Blurred lines={CONFIRM.executorLines} />
      </Card>

      <Card style={{ position: 'absolute', left: L.x, top: L.customerY, width: L.w, ...block(2) }}>
        <Label>{CONFIRM.customer}</Label>
        <div style={{ marginTop: 8, ...textStyle('sm'), fontWeight: 600 }}>
          {CONFIRM.customerName}
        </div>
        <Blurred lines={CONFIRM.customerLines.slice(0, 1)} />
        <div style={{ ...textStyle('fine'), color: theme.color.muted }}>
          {CONFIRM.customerLines[1]}
        </div>
      </Card>

      <Card
        style={{ position: 'absolute', left: L.x, top: L.compositionY, width: L.w, ...block(3) }}
      >
        <Label>{CONFIRM.composition}</Label>
        <div style={{ marginTop: 4, ...textStyle('sm'), fontWeight: 600 }}>{REQUEST_TITLE}</div>
        <div style={{ marginTop: 12 }}>
          <DefRow
            first
            term={ENGINE_PARSE.itemLabel}
            value={`${ENGINE_PARSE.qty} ${ENGINE_PARSE.unit}`}
            strong={false}
            style={{ color: theme.color.ink }}
          />
        </div>
      </Card>

      <Card style={{ position: 'absolute', left: L.x, top: L.termY, width: L.w, ...block(4) }}>
        <Label>{CONFIRM.term}</Label>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CONFIRM.termRows.map(([term, value]) => (
            <DefRow key={term} first term={term} value={value} strong={false} />
          ))}
        </div>
      </Card>

      <Card style={{ position: 'absolute', left: L.x, top: L.costY, width: L.w, ...block(5) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ ...textStyle('sm'), color: theme.color.muted }}>{CONFIRM.cost}</span>
          <span
            style={{ ...textStyle('2xl'), fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatKzt(countUp(frame, J.cCountUp, planTotal(RECOMMENDED)))}
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          <DefRow
            term={CONFIRM.costDelivery}
            value={formatKzt(RECOMMENDED.delivery)}
            strong={false}
          />
        </div>
        <div style={{ marginTop: 8, ...textStyle('fine'), color: theme.color.muted }}>
          {CONFIRM.version}
        </div>
      </Card>

      <Card style={{ position: 'absolute', left: L.x, top: L.paymentY, width: L.w, ...block(6) }}>
        <Label>{CONFIRM.paymentTitle}</Label>
        <div style={{ marginTop: 8, ...textStyle('fine'), color: theme.color.muted }}>
          {CONFIRM.payment}
        </div>
      </Card>

      <Card style={{ position: 'absolute', left: L.x, top: L.returnsY, width: L.w, ...block(7) }}>
        <Label>{CONFIRM.returnTitle}</Label>
        <div style={{ marginTop: 8, ...textStyle('fine'), color: theme.color.muted }}>
          {CONFIRM.returns}
        </div>
      </Card>

      <div style={{ position: 'absolute', left: L.x, top: L.ctaY, width: L.w, ...block(8) }}>
        <Button
          label={pending ? CONFIRM.ctaPending : CONFIRM.cta}
          variant="primary"
          size="md"
          width={L.ctaW}
          loading={pending}
          scale={pressScale(frame, J.cClickCta)}
        />
        <div style={{ marginTop: 6, ...textStyle('fine'), color: theme.color.muted }}>
          {CONFIRM.ctaNote}
        </div>
      </div>
    </div>
  );
};
