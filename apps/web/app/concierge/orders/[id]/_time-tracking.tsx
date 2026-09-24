'use client';

import { TIME_ENTRY_STAGE_BY_STATE } from '@qajet/engine/order';
import { useAsyncAction } from '@qajet/ui/hooks';
import { Button, Card } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { addManualTimeEntry, heartbeatActiveTime } from '../../../lib/actions/time-actions';
import type { OrderState } from '../../../lib/order-state';
import { type StageTime, TIME_ENTRY_STAGE_LABEL } from '../../../lib/order-time';

/**
 * Учёт времени по стадиям (agents.md §10 «Консьерж») с ручной
 * корректировкой (§9). Автоматическое и ручное показаны раздельно: правка
 * не должна выглядеть замером автотаймера.
 */
export function TimeTracking({
  orderId,
  currentState,
  stages,
}: {
  orderId: string;
  currentState: OrderState;
  stages: StageTime[];
}) {
  const router = useRouter();
  const currentStage = TIME_ENTRY_STAGE_BY_STATE[currentState];
  const [stage, setStage] = useState<string>(currentStage);
  const [minutes, setMinutes] = useState('15');
  const [reason, setReason] = useState('');
  const [intervalId] = useState(
    () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  );
  const [startedAt] = useState(() => new Date().toISOString());
  const trackingEnabled = currentState !== 'closed' && currentState !== 'cancelled';
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);

  useEffect(() => {
    if (!trackingEnabled) return;
    let stopped = false;
    const sendHeartbeat = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      const result = await heartbeatActiveTime(orderId, currentStage, intervalId, startedAt);
      if (!stopped && !result.ok) setHeartbeatError(result.error ?? 'Активное время не записано');
      else if (!stopped) setHeartbeatError(null);
    };
    void sendHeartbeat();
    const timer = window.setInterval(() => void sendHeartbeat(), 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void sendHeartbeat();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentStage, intervalId, orderId, startedAt, trackingEnabled]);

  const { run, pending, error } = useAsyncAction(async () => {
    const result = await addManualTimeEntry(orderId, stage, Number(minutes), reason);
    if (result.ok) {
      setMinutes('15');
      setReason('');
      router.refresh();
    }
    return result;
  });

  const activeSeconds = stages.reduce((sum, s) => sum + s.activeSeconds, 0);
  const elapsedSeconds = stages.reduce((sum, s) => sum + s.autoSeconds, 0);
  const manualSeconds = stages.reduce((sum, s) => sum + s.manualSeconds, 0);

  return (
    <Card padding="sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink">Учёт времени</p>
        <div className="text-right">
          <p className="numeric text-sm font-semibold text-ink">
            {formatHours(Math.max(0, activeSeconds + manualSeconds))}
          </p>
          <p className="text-micro text-muted">активно</p>
        </div>
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
                <span title="Время между переходами, исторический замер">
                  этап: {formatHours(s.autoSeconds)}
                </span>
                {s.activeSeconds > 0 && (
                  <span className="ml-2 text-ink">активно: {formatHours(s.activeSeconds)}</span>
                )}
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
        <label className="min-w-40 flex-1">
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
        <label className="min-w-52 flex-1">
          <span className="mb-1 block text-micro text-muted">Причина</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            placeholder="Например: звонок с поставщиком"
            aria-label="Причина корректировки времени"
            className="w-full rounded-control bg-page px-3 py-2 text-fine text-ink"
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={run}
          disabled={!trackingEnabled}
        >
          Добавить
        </Button>
      </div>
      <p className="mt-2 text-micro text-muted">
        «Этап» — историческое elapsed-время между переходами. «Активно» — только видимая вкладка;
        пауза дольше минуты не начисляется.
      </p>
      {elapsedSeconds > 0 && (
        <p className="mt-1 text-micro text-muted">
          Историческое elapsed-время: {formatHours(elapsedSeconds)}.
        </p>
      )}
      {trackingEnabled && heartbeatError && (
        <p className="mt-1 text-micro text-danger">{heartbeatError}</p>
      )}
      {error && <p className="mt-1 text-fine text-danger">{error}</p>}
    </Card>
  );
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours >= 1 ? `${hours.toFixed(1)} ч` : `${Math.round(seconds / 60)} мин`;
}
