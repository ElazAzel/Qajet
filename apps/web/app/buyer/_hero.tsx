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
            ? 'flex items-center py-5 pr-16 pl-6 sm:pl-10'
            : 'flex flex-col items-start pt-7 pr-16 pl-6 sm:flex-row sm:items-center sm:justify-between sm:pt-10 sm:pl-10'
        }
      >
        <h1
          className={
            collapsed
              ? 'text-base font-bold text-white'
              : 'text-2xl font-extrabold text-white sm:text-3xl'
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
          {/* На телефоне блок компактнее: «Ждут вашего решения» — главное действие
              покупателя — должно попадать в первый экран, а не уходить под баннер. */}
          <div className="max-w-md px-6 pb-7 sm:px-10 sm:pb-10">
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
