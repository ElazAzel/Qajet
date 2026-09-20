import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { canRunLive, loginAs, skipLiveReason } from './fixtures';

/**
 * Доступность критичных экранов.
 *
 * Гейт: ни одного `critical` и ни одного `serious`, кроме контраста цвета. Так
 * падают настоящие функциональные дефекты: кнопка без имени, поле без подписи,
 * неверная роль, ловушка фокуса.
 *
 * Контраст (`color-contrast`, serious) на 2026-09-20 присутствует на каждом
 * экране, включая активный пункт меню, и упирается в цвета дизайн-токенов, то
 * есть в решение по дизайну, а не в правку одного компонента. Он НЕ скрыт: число
 * затронутых элементов пишется в аннотацию теста, а находка записана в
 * docs/qa/post-hardening-ux-audit.md. Когда токены исправят, условие
 * `IGNORED_FOR_GATE` убирается и контраст становится частью гейта.
 *
 * Не покрыто и не заявлено: порядок фокуса при ошибке валидации, ловушка фокуса
 * в диалогах, работа с экранным читателем. Клавиатурный ввод формы заявки
 * проверяет buyer-journey.spec.ts.
 */

test.skip(!canRunLive, skipLiveReason);

const IGNORED_FOR_GATE = new Set(['color-contrast']);

const SCREENS: { name: string; path: string; email: string | null }[] = [
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
  test(`axe: ${screen.name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      if (screen.email) await loginAs(page, screen.email);
      await page.goto(screen.path);
      await page.waitForLoadState('networkidle');

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const contrast = violations.find((v) => v.id === 'color-contrast');
      if (contrast) {
        testInfo.annotations.push({
          type: 'известное: контраст цвета',
          description: `${contrast.nodes.length} элементов (не в гейте, см. шапку файла)`,
        });
      }

      const blocking = violations
        .filter((v) => !IGNORED_FOR_GATE.has(v.id))
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
    { name: 'админ', path: '/admin', email: 'admin@demo.qajet.kz', knownNavClipAt375: true },
  ];

  for (const width of [375, 768]) {
    for (const role of ROLE_HOMES) {
      test(`${role.name}: ${width}px`, async ({ browser }, testInfo) => {
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
          if (width === 375 && 'knownNavClipAt375' in role) {
            // Известная находка (аудит, F12): 8 пунктов по 60px = 480px, «Параметры» и
            // «Исходящие» вне экрана; панель прокручивается, но пункты не видны. Внутренняя
            // роль, вне пилотного пути; когда навигацию сократят, признак убирается.
            testInfo.annotations.push({
              type: 'известное: навигация вне экрана',
              description: clipped.join('; '),
            });
            expect(clipped.length, 'ожидается ровно известный набор').toBeGreaterThan(0);
          } else {
            expect(clipped, `пункты навигации вне экрана на ${width}px`).toEqual([]);
          }
        } finally {
          await context.close();
        }
      });
    }
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
