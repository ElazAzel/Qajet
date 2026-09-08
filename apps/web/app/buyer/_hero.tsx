'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'qajet:buyer:hero-collapsed';

/**
 * Свёрнутое состояние экономит вертикальное пространство ради списков ниже —
 * запоминается per-браузер (localStorage), а не завязано на сессию сервера.
 */
export function BuyerHero() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <div className="relative overflow-hidden rounded-hero bg-ink">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-control text-white/50 transition-colors duration-[var(--duration-instant)] hover:bg-white/10 hover:text-white"
      >
        <ChevronDown
          size={18}
          className="transition-transform duration-[var(--duration-quick)] ease-[var(--ease-standard)]"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
        <span className="sr-only">{collapsed ? 'Развернуть блок' : 'Свернуть блок'}</span>
      </button>

      <div
        className={
          collapsed
            ? 'flex items-center py-5 pl-10 pr-16'
            : 'flex flex-col items-start pl-10 pr-16 pt-10 sm:flex-row sm:items-center sm:justify-between'
        }
      >
        <h1
          className={
            collapsed ? 'text-base font-bold text-white' : 'text-3xl font-extrabold text-white'
          }
        >
          {collapsed ? (
            <>
              Все ваши закупки. <span className="text-lime">В одном месте.</span>
            </>
          ) : (
            <>
              Все ваши закупки.
              <br />
              <span className="text-lime">В одном месте.</span>
            </>
          )}
        </h1>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-[var(--duration-quick)] ease-[var(--ease-standard)]"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          <div className="max-w-md px-10 pb-10">
            <p className="mt-3 text-sm text-white/65">
              Заявки, поставщики и заказы от идеи до доставки — под одним закупочным партнёром.
            </p>
            <Link
              href="/buyer/requests/new"
              className="mt-5 inline-flex items-center gap-2 rounded-control bg-lime px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime/90"
            >
              Новая заявка →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
