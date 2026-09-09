'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, Card, formatKzt, Money } from '@qajet/ui/primitives';
import { useState } from 'react';
import { updatePlanLineCommission } from '../../../lib/actions/plan-actions';
import { CATEGORY_LABEL, type CatalogCategory } from '../../../lib/catalog';

export interface PlanLineViewModel {
  id: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  supplierLineTotalKzt: number;
  commissionPct: number;
  commissionKzt: number;
  buyerTotalKzt: number;
}

export interface CommissionSuggestionViewModel {
  pct: number;
  sampleCount: number;
}

const inputClass =
  'w-16 rounded-control border border-transparent bg-page px-2 py-1.5 text-fine text-ink focus-visible:border-purple';

function PlanLineRow({
  line,
  suggestion,
}: {
  line: PlanLineViewModel;
  suggestion: CommissionSuggestionViewModel | undefined;
}) {
  const [pct, setPct] = useState(String(line.commissionPct));
  const { run, pending, error } = useAsyncAction(updatePlanLineCommission);

  const categoryLabel = CATEGORY_LABEL[line.category as CatalogCategory] ?? line.category;

  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{line.name}</p>
          <p className="mt-0.5 text-fine text-muted">
            {categoryLabel} · {line.qty} {line.unit}
          </p>
        </div>
        <p className="shrink-0 text-right font-semibold text-ink">
          {formatKzt(line.buyerTotalKzt)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-rule pt-3">
        <div>
          <p className="text-micro text-muted">Цена поставщика</p>
          <p className="numeric text-fine text-ink">{formatKzt(line.supplierLineTotalKzt)}</p>
        </div>
        <div>
          <p className="text-micro text-muted">Комиссия</p>
          <p className="numeric text-fine text-ink">{formatKzt(line.commissionKzt)}</p>
        </div>
        <label className="ml-auto flex items-center gap-2">
          <span className="text-micro font-semibold text-muted">%, 21-24</span>
          <input
            type="number"
            min={21}
            max={24}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className={inputClass}
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={() => run(line.id, Number(pct))}
        >
          Сохранить
        </Button>
      </div>

      {suggestion && (
        <p className="mt-2 text-fine text-muted">
          Алгоритм советует: {suggestion.pct}% (на основе {suggestion.sampleCount} похожих решений)
        </p>
      )}
      {error && <p className="mt-2 text-fine text-signal">{error}</p>}
    </Card>
  );
}

/**
 * Список позиций утверждённого плана с правкой комиссии — задача
 * «комиссия платформы» (agents.md §7). Покупатель этого экрана не видит:
 * apps/web/app/buyer/orders/[id]/page.tsx показывает только общий итог.
 */
export function PlanLinesReview({
  lines,
  suggestions,
  totalKzt,
}: {
  lines: PlanLineViewModel[];
  suggestions: Record<string, CommissionSuggestionViewModel>;
  totalKzt: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm">
        <p className="text-fine font-semibold text-muted">Итого для покупателя</p>
        <p className="mt-1 text-2xl font-extrabold text-ink">
          <Money amountKzt={totalKzt} />
        </p>
      </Card>
      {lines.map((line) => (
        <PlanLineRow key={line.id} line={line} suggestion={suggestions[line.category]} />
      ))}
      {lines.length === 0 && <p className="text-fine text-muted">В плане нет позиций.</p>}
    </div>
  );
}
