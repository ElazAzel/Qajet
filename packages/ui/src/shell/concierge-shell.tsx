'use client';

import type { ReactNode } from 'react';
import {
  Group,
  type LayoutStorage,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels';
import { ShellLayout, type ShellNavItem, type ShellUser } from './shell-layout';

/**
 * Оболочка консьержа — §10, §12: тот же сайдбар + хедер, что у покупателя
 * и поставщика (структурно роли не различаются). Отличие консьержа не
 * структурное, а плотностное: внутри `main` — список заказов и карточка
 * заказа в изменяемом по ширине split view, а не единая колонка контента.
 * Раскладка панелей запоминается в localStorage (useDefaultLayout).
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
  navItems: ShellNavItem[];
  user: ShellUser;
  list: ReactNode;
  detail: ReactNode;
  /** Показывается поверх detail при открытии панели подбора/сведения КП. */
  overlayPanel?: ReactNode;
}

export function ConciergeShell({
  navItems,
  user,
  list,
  detail,
  overlayPanel,
}: ConciergeShellProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'qajet-concierge-layout',
    storage: typeof window === 'undefined' ? noopStorage : window.localStorage,
  });

  return (
    <ShellLayout navItems={navItems} user={user}>
      <Group
        orientation="horizontal"
        id="concierge-columns"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="-m-6 h-[calc(100%+3rem)]"
      >
        <Panel id="list" defaultSize="32" minSize="22%" maxSize="48%">
          <div className="h-full overflow-y-auto border-r border-rule bg-surface">{list}</div>
        </Panel>
        <Separator className="w-px bg-rule transition-colors hover:bg-purple data-[active]:bg-purple" />
        <Panel id="detail" minSize="40%">
          <div className="relative h-full overflow-y-auto bg-page">
            {detail}
            {overlayPanel}
          </div>
        </Panel>
      </Group>
    </ShellLayout>
  );
}
