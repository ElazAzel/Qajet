import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { canRunLive, loginAs, skipLiveReason } from './fixtures';

/**
 * Доступность критичных экранов.
 *
 * Гейт: ни одного `critical` и ни одного `serious`, включая контраст цвета.
 * Контраст был вне гейта до 2026-09-24: цвета текста статусов и фиолетовый не
 * дотягивали до 4.5:1 (аудит F14), а мелкие кнопки теряли белый текст из-за
 * склейки классов. Токены исправлены в globals.css, склейка — в packages/ui/src/lib/cn.ts.
 *
 * Не покрыто и не заявлено: порядок фокуса при ошибке валидации, ловушка фокуса
 * в диалогах, работа с экранным читателем. Клавиатурный ввод формы заявки
 * проверяет buyer-journey.spec.ts.
 */

test.skip(!canRunLive, skipLiveReason);

const SCREENS: { name: string; path: string; email: string | null }[] = [
  { name: 'посадочная', path: '/', email: null },
  { name: 'вход', path: '/login', email: null },
  { name: 'покупатель: главная', path: '/buyer', email: 'buyer@demo.qajet.kz' },
  { name: 'покупатель: новая заявка', path: '/buyer/requests/new', email: 'buyer@demo.qajet.kz' },
  { name: 'поставщик: главная', path: '/supplier', email: 'supplier@demo.qajet.kz' },
  { name: 'поставщик: сообщения', path: '/supplier/messages', email: 'supplier@demo.qajet.kz' },
  { name: 'консьерж: доска', path: '/concierge', email: 'concierge@demo.qajet.kz' },
  { name: 'админ: главная', path: '/admin', email: 'admin@demo.qajet.kz' },
  { name: 'админ: компании', path: '/admin/companies', email: 'admin@demo.qajet.kz' },
  { name: 'админ: параметры', path: '/admin/settings', email: 'admin@demo.qajet.kz' },
];

for (const screen of SCREENS) {
  test(`axe: ${screen.name}`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      if (screen.email) await loginAs(page, screen.email);
      await page.goto(screen.path);
      await page.waitForLoadState('networkidle');

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map(
          (v) =>
            `${v.impact} ${v.id} ×${v.nodes.length}: ${v.help} ${JSON.stringify(v.nodes[0]?.target)}`,
        );
      expect(blocking, 'нарушения доступности, блокирующие гейт').toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test.describe('адаптивность: экраны ролей не требуют горизонтальной прокрутки', () => {
  const ROLE_HOMES = [
    { name: 'покупатель', path: '/buyer', email: 'buyer@demo.qajet.kz' },
    { name: 'поставщик', path: '/supplier', email: 'supplier@demo.qajet.kz' },
    { name: 'консьерж', path: '/concierge', email: 'concierge@demo.qajet.kz' },
    { name: 'админ', path: '/admin', email: 'admin@demo.qajet.kz' },
  ];

  for (const width of [375, 768]) {
    for (const role of ROLE_HOMES) {
      test(`${role.name}: ${width}px`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        try {
          await loginAs(page, role.email);
          await page.goto(role.path);
          await page.waitForLoadState('networkidle');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflow, `выход за ширину экрана на ${overflow}px`).toBeLessThanOrEqual(1);

          // Прокрутки страницы нет, но содержимое может быть обрезано контейнером с
          // overflow: сама по себе мера scrollWidth такого не видит. Поэтому отдельно:
          // каждый видимый пункт навигации целиком помещается в экран.
          const clipped = await page.evaluate(() =>
            [...document.querySelectorAll('nav a')]
              .map((a) => ({ text: (a.textContent ?? '').trim(), r: a.getBoundingClientRect() }))
              .filter((x) => x.r.width > 0 && x.r.height > 0)
              .filter((x) => x.r.left < -1 || x.r.right > window.innerWidth + 1)
              .map((x) => `${x.text}: ${Math.round(x.r.left)}..${Math.round(x.r.right)}`),
          );
          expect(clipped, `пункты навигации вне экрана на ${width}px`).toEqual([]);

          // Подпись пункта — одна строка. Раньше размер шрифта подписи терялся
          // (tailwind-merge выбрасывал text-micro), и «Сообщения», «Настройки»
          // рвались посреди слова на две строки.
          const wrapped = await page.evaluate(() =>
            [...document.querySelectorAll('nav a, nav button')]
              .filter((el) => el.getBoundingClientRect().width > 0)
              // Подпись — текстовый span пункта; иконка скрыта aria-hidden, значок — число.
              .map((el) =>
                [...el.querySelectorAll('span')].find(
                  (span) =>
                    !span.closest('[aria-hidden="true"]') &&
                    /\p{L}/u.test(span.textContent ?? '') &&
                    span.children.length === 0,
                ),
              )
              .filter((label): label is HTMLSpanElement => label instanceof HTMLSpanElement)
              .filter((label) => {
                const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
                return label.getBoundingClientRect().height > lineHeight * 1.5;
              })
              .map((label) => label.textContent ?? ''),
          );
          expect(wrapped, `подписи навигации в две строки на ${width}px`).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  }
});

test('админ на телефоне: все разделы доступны через «Ещё»', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    await page.goto('/admin');
    const mobileNav = page.getByRole('navigation', { name: 'Разделы' });
    const more = mobileNav.getByRole('button', { name: 'Ещё' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await mobileNav.getByRole('link', { name: 'Исходящие' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Исходящие уведомления' }),
    ).toBeVisible();
    // Раздел из «Ещё» активен — кнопка «Ещё» показывает, где человек находится.
    await expect(
      page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Ещё' }),
    ).toHaveAttribute('data-active', 'true');
    // Escape закрывает меню, фокус возвращается на кнопку.
    const moreAgain = page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' });
    await moreAgain.click();
    await page.keyboard.press('Escape');
    await expect(moreAgain).toHaveAttribute('aria-expanded', 'false');
    await expect(moreAgain).toBeFocused();
  } finally {
    await context.close();
  }
});

test('prefers-reduced-motion: содержимое не прячется за анимацией входа', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await loginAs(page, 'supplier@demo.qajet.kz');
    await page.goto('/supplier');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('main h1, main h2, main h3, main p')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return el.textContent?.trim() && Number(s.opacity) < 0.99;
        })
        .map((el) => (el.textContent ?? '').trim().slice(0, 40)),
    );
    expect(hidden, 'текст, оставшийся прозрачным при reduced motion').toEqual([]);
  } finally {
    await context.close();
  }
});
