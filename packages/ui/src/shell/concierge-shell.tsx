'use client';

import type { ReactNode } from 'react';
import {
  Group,
  type LayoutStorage,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels';

/**
 * Оболочка консьержа — §10, §12: плотный рабочий стол с левым рельсом,
 * профессиональный инструмент для ежедневного использования. Раскладка
 * панелей запоминается в localStorage (useDefaultLayout) — консьерж не
 * должен каждый день заново раздвигать список заказов и карточку.
 *
 * react-resizable-panels v4 переписал API на примитивы Group/Panel/Separator
 * (раньше — PanelGroup/PanelResizeHandle). Читать это как факт версии,
 * а не как сокращение имён по вкусу.
 */

/**
 * useDefaultLayout, если не передать `storage` явно, использует параметром
 * по умолчанию голую глобаль `localStorage` (не `window.localStorage`).
 * Значения по умолчанию в JS вычисляются всегда, когда ключ отсутствует —
 * так что при серверном рендере (localStorage не существует) это падает
 * ReferenceError раньше, чем компонент успевает что-то проверить. Надёжный
 * обход — никогда не давать сработать их дефолту: передавать `storage`
 * явно всегда, на сервере — безобидную заглушку без записи.
 */
const noopStorage: LayoutStorage = {
  getItem: () => null,
  setItem: () => {},
};
export interface ConciergeShellProps {
  rail: ReactNode;
  list: ReactNode;
  detail: ReactNode;
  /** Показывается поверх detail при открытии панели подбора/сведения КП. */
  overlayPanel?: ReactNode;
}

export function ConciergeShell({ rail, list, detail, overlayPanel }: ConciergeShellProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'qajet-concierge-layout',
    storage: typeof window === 'undefined' ? noopStorage : window.localStorage,
  });

  return (
    <div className="flex h-screen bg-paper text-ink">
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-rule bg-ink py-3 text-paper">
        {rail}
      </nav>
      <Group
        orientation="horizontal"
        id="concierge-columns"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="flex-1"
      >
        <Panel id="list" defaultSize="32" minSize="22%" maxSize="48%">
          <div className="h-full overflow-y-auto border-r border-rule bg-surface">{list}</div>
        </Panel>
        <Separator className="w-px bg-rule transition-colors data-[active]:bg-accent hover:bg-accent" />
        <Panel id="detail" minSize="40%">
          <div className="relative h-full overflow-y-auto">
            {detail}
            {overlayPanel}
          </div>
        </Panel>
      </Group>
    </div>
  );
}
