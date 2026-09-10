'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, Card } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addManualTimeEntry } from '../../../lib/actions/time-actions';
import { type StageTime, TIME_ENTRY_STAGE_LABEL } from '../../../lib/order-time';

/**
 * Учёт времени по стадиям (agents.md §10 «Консьерж») с ручной
 * корректировкой (§9). Автоматическое и ручное показаны раздельно: правка
 * не должна выглядеть замером автотаймера.
 */
export function TimeTracking({ orderId, stages }: { orderId: string; stages: StageTime[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<string>(stages[0]?.stage ?? 'sourcing');
  const [minutes, setMinutes] = useState('15');

  const { run, pending, error } = useAsyncAction(async () => {
    const result = await addManualTimeEntry(orderId, stage, Number(minutes));
    if (result.ok) {
      setMinutes('15');
      router.refresh();
    }
    return result;
  });

  const totalSeconds = stages.reduce((sum, s) => sum + s.autoSeconds + s.manualSeconds, 0);

  return (
    <Card padding="sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink">Учёт времени</p>
        <p className="numeric text-sm font-semibold text-ink">{formatHours(totalSeconds)}</p>
      </div>

      {stages.length === 0 ? (
        <p className="mt-2 text-fine text-muted">
          Записей пока нет — автотаймер добавит их при следующем переходе стадии.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {stages.map((s) => (
            <li key={s.stage} className="flex items-center justify-between gap-3 text-fine">
              <span className="text-ink">{s.label}</span>
              <span className="numeric shrink-0 text-muted">
                {formatHours(s.autoSeconds)}
                {s.manualSeconds !== 0 && (
                  <span className="ml-1 text-purple">
                    {s.manualSeconds > 0 ? '+' : '−'}
                    {formatHours(Math.abs(s.manualSeconds))} вручную
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2 border-rule border-t pt-4">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-micro text-muted">Стадия</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="Стадия учёта времени"
            className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
          >
            {Object.entries(TIME_ENTRY_STAGE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="w-28">
          <span className="mb-1 block text-micro text-muted">Минуты</span>
          <input
            type="number"
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="Минуты корректировки"
            className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
          />
        </label>
        <Button variant="secondary" size="sm" loading={pending} onClick={run}>
          Добавить
        </Button>
      </div>
      <p className="mt-2 text-micro text-muted">
        Отрицательное значение вычитает время — если автотаймер посчитал лишнего.
      </p>
      {error && <p className="mt-1 text-fine text-danger">{error}</p>}
    </Card>
  );
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours >= 1 ? `${hours.toFixed(1)} ч` : `${Math.round(seconds / 60)} мин`;
}
