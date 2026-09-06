import { Reveal, Stagger, Stamp } from '@qajet/ui/motion';

/**
 * Общий вид для «пустых, но настоящих» маршрутов фазы 0 (agents.md §14,
 * шаг 1). Не «coming soon» и не фейковый спиннер: ведомость экранов
 * этой роли из спеки — что уже кликабельно, что ждёт своей фазы,
 * какой раздел §10 отвечает за экран. Честный статус вместо заглушки.
 */

export type ScreenStatus = 'live' | 'planned';

export interface ScreenEntry {
  name: string;
  status: ScreenStatus;
  note: string;
}

export function ScreenLedger({ roleName, entries }: { roleName: string; entries: ScreenEntry[] }) {
  return (
    <div className="max-w-2xl">
      <Reveal>
        <p className="text-micro tracking-wide text-muted uppercase">Экраны роли · {roleName}</p>
      </Reveal>
      <Stagger startIndex={1} as="ul" className="mt-4 divide-y divide-rule border-y border-rule">
        {entries.map((entry) => (
          <li key={entry.name}>
            <Reveal from="up" className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{entry.name}</p>
                <p className="mt-0.5 text-fine text-muted">{entry.note}</p>
              </div>
              <Stamp tone={entry.status === 'live' ? 'accent' : 'neutral'} className="shrink-0">
                {entry.status === 'live' ? 'готово' : 'план'}
              </Stamp>
            </Reveal>
          </li>
        ))}
      </Stagger>
    </div>
  );
}
