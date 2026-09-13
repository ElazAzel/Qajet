'use client';

import { Bell, Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { CommandPalette, type CommandPaletteItem } from './command-palette';

/**
 * Общая оболочка ролей — §12: сайдбар 240px + хедер 80px одинаковы для
 * всех четырёх ролей. Светлый сайдбар с фиолетовым активным пунктом —
 * для покупателя/поставщика/консьержа; тёмный сайдбар с лаймовым активным
 * пунктом — только у админа (`tone="dark"`), это единственное место, где
 * лайм заливает интерактивный элемент, а не просто акцентирует тёмный фон.
 * Мобильная раскладка — нижние табы теми же пунктами навигации, а не
 * отдельный компонент: одна оболочка, два физических размера.
 *
 * Активный пункт считается от реального `usePathname()`, а не от статичного
 * флага, который layout.tsx выставлял бы вручную и который в подстраницах
 * (/buyer/team, /concierge/exceptions и т.п.) устаревал бы молча.
 */

export interface ShellNavItem {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Ручной оверрайд — обычно не нужен, активность считается от pathname. */
  active?: boolean;
  badge?: number;
}

/** Корневой пункт роли ("/buyer") подсвечивается только на точном совпадении,
 *  иначе он горел бы активным на любой вложенной подстранице тоже. */
function isNavItemActive(pathname: string, href: string): boolean {
  const isRoot = href.split('/').filter(Boolean).length <= 1;
  return isRoot ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export interface ShellUser {
  name: string;
  meta: string;
}

export interface ShellSearch {
  placeholder: string;
  shortcut?: string;
}

export interface ShellLayoutProps {
  navItems: ShellNavItem[];
  children: ReactNode;
  user: ShellUser;
  tone?: 'light' | 'dark';
  brand?: ReactNode;
  /** Карточка внизу сайдбара — промо/апсейл, только на десктопе. */
  promo?: ReactNode;
  /** Поиск в хедере с подсказкой хоткея — сейчас только у покупателя (⌘K). */
  search?: ShellSearch;
  /** Контент слева в хедере рядом с поиском — заголовок экрана и т.п. */
  headerTitle?: ReactNode;
}

export function ShellLayout({
  navItems,
  children,
  user,
  tone = 'light',
  brand = 'QAJET',
  promo,
  search,
  headerTitle,
}: ShellLayoutProps) {
  const dark = tone === 'dark';
  const pathname = usePathname();
  const router = useRouter();
  const ordersHref = navItems[0]?.href;
  const messagesHref = navItems.find((item) => item.key === 'messages')?.href;
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Палитра (⌘K) монтируется здесь, а не в каждой роли: компонент был
  // написан целиком, но не подключён нигде — ⌘K не работал, кнопка поиска
  // в хедере не имела обработчика, а нативная оболочка (apps/desktop)
  // слала глобальный хоткей `global-shortcut:command-palette` в пустоту.
  // Пункты — та же навигация роли: палитра обязана вести туда же, куда
  // ведёт сайдбар, а не заводить второй список маршрутов.
  const paletteItems: CommandPaletteItem[] = useMemo(
    () =>
      navItems.map((item) => ({
        key: item.key,
        label: item.label,
        hint: item.href,
        group: 'Навигация',
        onSelect: () => {
          setPaletteOpen(false);
          router.push(item.href);
        },
      })),
    [navItems, router],
  );

  // `g o` — план §"Оболочка ПК": «g o к заказам». Первый пункт навигации
  // каждой роли и есть её экран заказов (buyer/supplier/concierge/admin —
  // структурно один и тот же корневой маршрут, agents.md §12), так что
  // хардкодить целевой путь по роли не нужно.
  useEffect(() => {
    let awaitingSecondKey = false;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'g' && !awaitingSecondKey) {
        awaitingSecondKey = true;
        resetTimer = setTimeout(() => {
          awaitingSecondKey = false;
        }, 800);
        return;
      }
      if (event.key === 'o' && awaitingSecondKey && ordersHref) {
        awaitingSecondKey = false;
        clearTimeout(resetTimer);
        event.preventDefault();
        router.push(ordersHref);
        return;
      }
      awaitingSecondKey = false;
      clearTimeout(resetTimer);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(resetTimer);
    };
  }, [ordersHref, router]);

  return (
    <div className="flex min-h-screen bg-page">
      <CommandPalette items={paletteItems} open={paletteOpen} onOpenChange={setPaletteOpen} />
      <aside
        className={cn(
          'hidden w-60 shrink-0 flex-col border-r px-4 py-6 md:flex',
          dark ? 'border-white/10 bg-ink text-white' : 'border-rule bg-surface text-ink',
        )}
      >
        <div className="px-2 text-lg font-extrabold">{brand}</div>
        <nav className="mt-8 flex flex-col gap-1">
          {navItems.map((item) => {
            const active = item.active ?? isNavItemActive(pathname, item.href);
            return (
              <a
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? dark
                      ? 'bg-lime text-ink'
                      : 'bg-purple-10 text-purple'
                    : dark
                      ? 'text-white/70 hover:bg-white/10'
                      : 'text-muted hover:bg-page hover:text-ink',
                )}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {!!item.badge && (
                  <span
                    className={cn(
                      'ml-auto flex h-5 min-w-5 items-center justify-center rounded-pill px-1 text-[11px] font-semibold',
                      dark ? 'bg-white/15 text-white' : 'bg-purple text-white',
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
        {promo && <div className="mt-auto pt-6">{promo}</div>}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-rule bg-surface px-6">
          <div className="flex min-w-0 items-center gap-4">
            {headerTitle}
            {search && (
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden items-center gap-2 rounded-pill border border-rule bg-page px-4 py-2 text-sm text-muted md:flex"
              >
                <Search size={16} aria-hidden="true" />
                <span className="truncate">{search.placeholder}</span>
                {search.shortcut && (
                  <span className="ml-2 rounded-control border border-rule px-1.5 py-0.5 text-[11px] text-muted">
                    {search.shortcut}
                  </span>
                )}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {messagesHref && (
              <a
                href={messagesHref}
                aria-label="Открыть сообщения"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink"
              >
                <Bell size={18} aria-hidden="true" />
              </a>
            )}
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-10 text-sm font-semibold text-purple">
                {initials(user.name)}
              </span>
              <span className="hidden text-left text-sm leading-tight sm:block">
                <span className="block font-medium text-ink">{user.name}</span>
                <span className="block text-fine text-muted">{user.meta}</span>
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6 pb-24 md:pb-6">{children}</main>
      </div>

      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t md:hidden',
          dark ? 'border-white/10 bg-ink' : 'border-rule bg-surface',
        )}
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {navItems.map((item) => {
          const active = item.active ?? isNavItemActive(pathname, item.href);
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                // flex-[1_0_60px]: делит ширину поровну, пока пунктов мало
                // (растёт), но не сжимается тоньше 60px — при 6-7 пунктах
                // (buyer/admin, agents.md §8) подпись в одну строку с
                // `truncate` при такой ширине обрезалась до нечитаемых
                // обрывков («Новая...», «Сообщ...») даже когда сама ячейка
                // помещалась без горизонтального скролла — обрыв текста, а
                // не переполнение контейнера. Сама подпись (ниже) переносится
                // на 2 строки вместо truncate — на 60px это и есть читаемый
                // предел для русских подписей в 1-2 слова. Лишние пункты
                // (7-й у admin) по-прежнему уезжают в горизонтальный скролл
                // контейнера — известное ограничение, нужен паттерн «Ещё»,
                // не предмет этой правки.
                'relative flex min-w-0 flex-[1_0_60px] flex-col items-center gap-1 py-2.5 text-micro',
                active
                  ? dark
                    ? 'text-lime'
                    : 'text-purple'
                  : dark
                    ? 'text-white/60'
                    : 'text-muted',
              )}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span className="line-clamp-2 w-full text-center leading-[1.15] break-words">
                {item.label}
              </span>
              {!!item.badge && (
                <span className="absolute top-1 right-[calc(50%-18px)] flex h-4 min-w-4 items-center justify-center rounded-full bg-purple px-1 text-[10px] font-medium text-white">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
