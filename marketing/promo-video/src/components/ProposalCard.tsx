import type React from 'react';
import { DEMO, formatTenge, PRICE_LABELS, type Proposal } from '../content';
import { theme } from '../theme';

// Внутренние размеры карточки. ProductDemo считает по ним точку клика
// в кнопку «Выбрать», поэтому менять их нужно здесь, а не в разметке.
export const CARD_PADDING = 28;
export const CARD_BUTTON_HEIGHT = 58;

type Props = {
  proposal: Proposal;
  width: number;
  height: number;
  // Масштаб кнопки «Выбрать» (нажатие при клике).
  buttonScale?: number;
  // После клика кнопка показывает «Выбрано».
  selected?: boolean;
  // Анимация самой карточки (появление, затухание, увеличение) задаётся снаружи.
  style?: React.CSSProperties;
};

const PriceRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div
    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 19, lineHeight: '30px' }}
  >
    <span style={{ color: theme.color.textMuted }}>{label}</span>
    <span style={{ color: theme.color.text, fontVariantNumeric: theme.font.numeric }}>
      {formatTenge(value)}
    </span>
  </div>
);

export const ProposalCard: React.FC<Props> = ({
  proposal,
  width,
  height,
  buttonScale = 1,
  selected = false,
  style,
}) => {
  const total = proposal.goods + proposal.branding + proposal.delivery;
  const { optimal } = proposal;

  return (
    <div
      style={{
        position: 'absolute',
        width,
        height,
        boxSizing: 'border-box',
        padding: CARD_PADDING,
        borderRadius: theme.radius.card,
        background: theme.color.surface,
        border: optimal
          ? `2px solid ${theme.color.accentBright}`
          : `1px solid ${theme.color.border}`,
        boxShadow: optimal
          ? `0 0 0 6px ${theme.color.accentBrightSoft}, ${theme.shadow.cardRaised}`
          : theme.shadow.card,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.font.family,
        color: theme.color.text,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {proposal.supplier}
        </span>
        {optimal ? (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: theme.radius.pill,
              background: theme.color.accentBrightSoft,
              color: theme.color.accentBright,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {DEMO.optimalBadge}
          </span>
        ) : null}
      </div>
      <span style={{ fontSize: 18, color: theme.color.textMuted, marginTop: 4 }}>
        {proposal.kind}
      </span>

      <span
        style={{
          marginTop: 22,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: theme.color.textFaint,
        }}
      >
        {DEMO.kitLabel}
      </span>
      <span
        style={{ marginTop: 6, fontSize: 20, fontWeight: 500, lineHeight: 1.35, minHeight: 54 }}
      >
        {proposal.kit}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 19 }}>
        <svg aria-hidden="true" width={20} height={20} viewBox="0 0 20 20">
          <rect
            x={2}
            y={4}
            width={16}
            height={14}
            rx={3}
            fill="none"
            stroke={theme.color.textMuted}
            strokeWidth={1.6}
          />
          <path d="M2 8.5h16M6.5 2v4M13.5 2v4" stroke={theme.color.textMuted} strokeWidth={1.6} />
        </svg>
        <span>{proposal.deadline}</span>
      </div>

      <div style={{ height: 1, background: theme.color.border, margin: '18px 0 12px' }} />

      <PriceRow label={PRICE_LABELS.goods} value={proposal.goods} />
      <PriceRow label={PRICE_LABELS.branding} value={proposal.branding} />
      <PriceRow label={PRICE_LABELS.delivery} value={proposal.delivery} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 19, fontWeight: 600 }}>{PRICE_LABELS.total}</span>
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            fontVariantNumeric: theme.font.numeric,
          }}
        >
          {formatTenge(total)}
        </span>
      </div>

      <div
        style={{
          marginTop: 'auto',
          height: CARD_BUTTON_HEIGHT,
          borderRadius: theme.radius.control,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontSize: 20,
          fontWeight: 600,
          scale: String(buttonScale),
          ...(selected
            ? { background: theme.color.successSoft, color: theme.color.success }
            : optimal
              ? {
                  background: theme.color.accent,
                  color: theme.color.accentText,
                  boxShadow: theme.shadow.button,
                }
              : {
                  background: theme.color.surface,
                  color: theme.color.text,
                  border: `1px solid ${theme.color.borderStrong}`,
                }),
        }}
      >
        {selected ? (
          <svg aria-hidden="true" width={20} height={20} viewBox="0 0 20 20">
            <path
              d="M4 10.5l4 4 8-9"
              fill="none"
              stroke={theme.color.success}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {selected ? DEMO.selectedButton : DEMO.selectButton}
      </div>
    </div>
  );
};
