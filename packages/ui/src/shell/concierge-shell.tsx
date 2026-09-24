'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Group,
  type LayoutStorage,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels';
import { cn } from '../lib/cn';
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
 *
 * Split-панель включается с `lg` (1024px), не с `md` (768px). Замерено
 * вживую: react-resizable-panels на этой странице несёт устойчивый
 * hydration mismatch (Group/Panel рендерят SSR/клиент со своим инлайн-
 * `style`, "won't be patched up" — React принимает серверное значение и
 * не пересчитывает), из-за которого панель "list" на ширинах 768–900px
 * застревает на абсолютной ширине ~565px, а "detail" схлопывается до 0 —
 * экран сравнения физически недоступен на большинстве планшетов. При
 * ≥1024px сумма помещается и оставляет detail видимую полосу; ниже —
 * одна колонка на весь экран, список ИЛИ карточка, в зависимости от
 * маршрута (`/concierge` — список, `/concierge/orders/[id]` — карточка с
 * кнопкой «Все заказы» назад). Разметка списка/карточки при этом
 * присутствует в DOM дважды (для split и для одноколоночной раскладки) и
 * переключается через `hidden`/`lg:hidden` — тот же приём, что уже
 * использует ShellLayout для сайдбара и нижних вкладок, не новый паттерн
 * ради этого экрана.
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
  const pathname = usePathname();
  const isDetailRoute = pathname !== '/concierge';

  return (
    <ShellLayout navItems={navItems} user={user}>
      {/*
        react-resizable-panels рендерит Group/Panel со своим инлайновым
        `style={{ display: 'flex' }}` (нужен ему для собственной раскладки) —
        инлайновый style всегда побеждает класс, поэтому `hidden md:flex`
        НА САМОМ Group ничего не прячет. Прячем через внешний div, до
        которого библиотека не дотягивается.
      */}
      {/* Высота колонок — ровно экран под шапкой (h-20): каждая прокручивается
          сама, а не вся страница целиком. Без этого обе колонки вытягивались на
          длину списка, и подсказка «Выберите заказ» уезжала за край экрана. */}
      <div className="-m-6 hidden h-[calc(100dvh-5rem)] lg:block">
        <Group
          orientation="horizontal"
          id="concierge-columns"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="h-full"
        >
          <Panel id="list" defaultSize="32" minSize="22%" maxSize="48%">
            <div className="h-full overflow-y-auto border-r border-rule bg-surface">{list}</div>
          </Panel>
          <Separator className="w-px bg-rule transition-colors hover:bg-purple data-[active]:bg-purple" />
          <Panel id="detail" minSize="40%">
            <div className="relative h-full overflow-y-auto bg-page">
              {/* Отступ карточки задаёт оболочка — одинаково в обеих раскладках. */}
              <div className="h-full p-6">{detail}</div>
              {overlayPanel}
            </div>
          </Panel>
        </Group>
      </div>

      <div className="-mx-6 -mt-6 lg:hidden">
        <div className={cn('bg-surface', isDetailRoute && 'hidden')}>{list}</div>
        <div className={cn('relative bg-page', !isDetailRoute && 'hidden')}>
          <Link
            href="/concierge"
            className="flex items-center gap-1.5 border-b border-rule px-4 py-3 text-fine font-semibold text-muted"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Все заказы
          </Link>
          <div className="px-6 py-6">{detail}</div>
          {overlayPanel}
        </div>
      </div>
    </ShellLayout>
  );
}
