'use client';

import { formatKzt } from '@qajet/ui/primitives';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DemoData } from './_data';

/**
 * Клиентский степпер сцен — управление пробелом/стрелками (agents.md §13:
 * «отдельный маршрут, управляемый пробелом и стрелками»). Данные уже
 * загружены сервером (page.tsx) один раз при заходе — сцена сама не ходит
 * в сеть, поэтому переключение работает и без интернета (Wi-Fi падает —
 * страница уже у presenter'а в браузере). «Работает без интернета» в
 * терминах ADR-0008 означает боевой стек локально (self-hosted Supabase);
 * здесь — честная более узкая гарантия: сама навигация по уже открытой
 * странице сети не требует.
 */

const PLAN_LABEL: Record<string, string> = {
  recommended: 'Рекомендованный',
  cheaper: 'Дешевле',
  more_slack: 'С запасом по сроку',
};

interface Scene {
  title: string;
  render: () => React.ReactNode;
}

function buildScenes(data: DemoData): Scene[] {
  const scenes: Scene[] = [];

  scenes.push({
    title: '1. Заявка приходит текстом',
    render: () =>
      data.scene1 ? (
        <div>
          <p className="text-ink">
            «{data.scene1.requestTitle}» — {data.scene1.itemsTotal} позиций распознано.
          </p>
          <p className="mt-3 text-fine text-muted">Требуют уточнения:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {data.scene1.itemsNeedingClarification.map((i) => (
              <li key={i.name} className="text-fine text-signal">
                {i.name} — {i.reason ?? 'нужна деталь от покупателя'}
              </li>
            ))}
          </ul>
          <Link
            href={`/concierge/orders/${data.demoOrderId}/items`}
            className="mt-4 inline-block text-fine font-medium text-purple hover:underline"
          >
            Открыть на сцене →
          </Link>
        </div>
      ) : (
        <EmptyNote />
      ),
  });

  scenes.push({
    title: '2. Оценка калькулятора',
    render: () =>
      data.scene2 ? (
        <div>
          <p className="text-ink">
            {data.scene2.nClosedOrders} закрытых заказов в основе калькулятора.
          </p>
          <p className="mt-2 text-2xl font-extrabold text-ink">
            запас {data.scene2.currentMarginPct?.toFixed(0) ?? '—'}%
          </p>
          {data.scene2.firstMarginPct !== null && (
            <p className="text-fine text-muted">
              было {data.scene2.firstMarginPct.toFixed(0)}% девять месяцев назад — запас снижается
              по мере накопления истории
            </p>
          )}
          <Link
            href="/admin/learning"
            className="mt-4 inline-block text-fine font-medium text-purple hover:underline"
          >
            Открыть на сцене →
          </Link>
        </div>
      ) : (
        <EmptyNote />
      ),
  });

  scenes.push({
    title: '3. Рассылка RFQ',
    render: () =>
      data.scene3 ? (
        <div>
          <p className="text-ink">
            {data.scene3.rfqsTotal} поставщиков получили RFQ, {data.scene3.explorationCount} — через
            слот исследования.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {data.scene3.sampleReasons.map((r) => (
              <li key={r.supplierName} className="text-fine text-muted">
                <span className="font-semibold text-ink">{r.supplierName}</span> — {r.category},{' '}
                {r.reason === 'exploration_slot' ? 'слот исследования' : 'по скору'}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyNote />
      ),
  });

  scenes.push({
    title: '4. Пришли КП',
    render: () =>
      data.scene4 ? (
        <div>
          <p className="text-ink">
            {data.scene4.quotesTotal} КП приведены к единым полям,{' '}
            {data.scene4.quoteLinesWithOpenFlags} с пропуском поля.
          </p>
          {data.scene4.rejectedWithReasons.length > 0 && (
            <p className="mt-3 text-fine text-signal">
              Отброшено: {data.scene4.rejectedWithReasons[0]?.reasonHuman}
            </p>
          )}
        </div>
      ) : (
        <EmptyNote />
      ),
  });

  scenes.push({
    title: '5. Три варианта с полосами',
    render: () =>
      data.scene5and6 ? (
        <div>
          <ul className="flex flex-col gap-2">
            {data.scene5and6.plans.map((p) => (
              <li key={p.kind} className="flex items-center justify-between text-fine">
                <span className="text-ink">
                  {PLAN_LABEL[p.kind] ?? p.kind} · {p.supplierCount} поставщик(ов)
                </span>
                <span className="numeric text-ink">{formatKzt(p.totalKzt)}</span>
              </li>
            ))}
          </ul>
          {data.scene5and6.cheaperWithFewerSuppliers && (
            <p className="mt-3 text-fine text-muted">
              Есть вариант, где меньше поставщиков выгоднее большего числа — обязательный кейс §15.
            </p>
          )}
          <Link
            href={`/concierge/orders/${data.demoOrderId}`}
            className="mt-4 inline-block text-fine font-medium text-purple hover:underline"
          >
            Открыть на сцене →
          </Link>
        </div>
      ) : (
        <EmptyNote />
      ),
  });

  scenes.push({
    title: '6. Налоговый эффект СНР',
    render: () => {
      const withTax = data.scene5and6?.plans.find((p) => p.taxEffectKzt > 0);
      return withTax ? (
        <p className="text-ink">
          {PLAN_LABEL[withTax.kind] ?? withTax.kind}: +{formatKzt(withTax.taxEffectKzt)} эффект СНР
          — дешёвое КП может оказаться дороже после вычета.
        </p>
      ) : (
        <EmptyNote text="В этом демо-заказе ни один вариант не даёт налогового эффекта." />
      );
    },
  });

  scenes.push({
    title: '7. Утверждение, аудит, документы',
    render: () =>
      data.scene7 ? (
        <div>
          <p className="text-fine text-muted">Пример по уже закрытому заказу сида:</p>
          <p className="text-ink">«{data.scene7.requestTitle}»</p>
          <p className="mt-2 text-fine text-muted">
            {data.scene7.stageEventsCount} записей в аудит-логе, {data.scene7.documentsCount}{' '}
            документа (счёт, акт).
          </p>
          <Link
            href={`/buyer/orders/${data.scene7.orderId}`}
            className="mt-4 inline-block text-fine font-medium text-purple hover:underline"
          >
            Открыть на сцене →
          </Link>
        </div>
      ) : (
        <EmptyNote />
      ),
  });

  scenes.push({
    title: '8. /metrics',
    render: () => (
      <div>
        <p className="text-ink">
          {data.scene8.closedOrdersCount} закрытых заказов · GMV{' '}
          {formatKzt(data.scene8.gmvTotalKzt)}
        </p>
        <p className="mt-1 text-fine text-muted">
          {data.scene8.avgHoursPerOrder !== null
            ? `${data.scene8.avgHoursPerOrder.toFixed(1)} ч на заказ`
            : 'часы на заказ — нет данных'}
        </p>
        <Link
          href="/metrics"
          className="mt-4 inline-block text-fine font-medium text-purple hover:underline"
        >
          Открыть на сцене →
        </Link>
      </div>
    ),
  });

  return scenes;
}

function EmptyNote({ text }: { text?: string }) {
  return (
    <p className="text-fine text-muted">
      {text ?? 'Сейчас нет демо-заказа на нужной стадии — заведите его через сид (agents.md §13).'}
    </p>
  );
}

export function DemoSceneViewer({ data }: { data: DemoData }) {
  const scenes = buildScenes(data);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, scenes.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scenes.length]);

  const scene = scenes[index];
  if (!scene) return null;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
      <p className="text-micro tracking-wide text-muted uppercase">
        Сцена {index + 1} / {scenes.length}
      </p>
      <h1 className="mt-1 text-2xl font-extrabold text-ink">{scene.title}</h1>
      <div className="mt-6">{scene.render()}</div>

      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          className="rounded-control border border-rule px-4 py-2 text-fine text-ink disabled:opacity-40"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => setIndex(0)}
          className="text-fine text-muted hover:underline"
        >
          Сбросить демо
        </button>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(i + 1, scenes.length - 1))}
          disabled={index === scenes.length - 1}
          className="rounded-control bg-purple px-4 py-2 text-fine font-medium text-white disabled:opacity-40"
        >
          Далее →
        </button>
      </div>
      <p className="mt-4 text-center text-micro text-muted">Пробел / ← → — навигация</p>
    </div>
  );
}
