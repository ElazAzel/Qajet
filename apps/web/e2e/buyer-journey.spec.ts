import { expect, test } from '@playwright/test';
import { canRunLive, e2eTitle, loginAs, skipLiveReason } from './fixtures';

/**
 * Путь покупателя глазами человека: форма заявки, страница закупки, ошибки,
 * повторная отправка, старые ссылки, мобильная ширина. Каждый сценарий ведёт
 * реальные экраны под демо-покупателем; заголовки заявок имеют вид
 * `E2E-<runId>-<имя теста>`.
 *
 * Идёт только против локальной базы (см. fixtures.ts:isLocalSupabase).
 */

test.skip(!canRunLive, skipLiveReason);

test.describe('форма новой заявки', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'buyer@demo.qajet.kz');
    await page.goto('/buyer/requests/new');
  });

  test('начинается без позиций и не отправляет пустую форму молча', async ({ page }) => {
    // Раньше здесь была неудаляемая строка «Футболка с логотипом × 50».
    await expect(page.getByText('Позиций пока нет.')).toBeVisible();
    await expect(page.locator('#request-items select')).toHaveCount(0);

    await page.getByRole('button', { name: 'Отправить заявку' }).click();

    // Ошибки стоят рядом с полями, поля помечены, фокус — на первом из них.
    await expect(page.getByText('Введите название заявки')).toBeVisible();
    await expect(page.getByText('Добавьте хотя бы одну позицию')).toBeVisible();
    await expect(page.locator('#request-title')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#request-items')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#request-title')).toBeFocused();
    await expect(page).toHaveURL(/\/buyer\/requests\/new$/);
  });

  test('срок в прошлом отклоняется с ошибкой у поля даты', async ({ page }) => {
    await page.locator('#request-title').fill(e2eTitle('past-date'));
    await page.getByRole('button', { name: 'Добавить позицию из каталога' }).click();
    // type=date с min не даёт выбрать прошлое мышью, но значение можно ввести —
    // сервер обязан проверить сам.
    await page.locator('#request-date').fill('2020-01-01');
    await page.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(page.getByText('Срок не может быть в прошлом')).toBeVisible();
    await expect(page.locator('#request-date')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#request-date')).toBeFocused();
  });

  test('быстрый разбор текста → подтверждение → заявка одна, даже при тройном клике', async ({
    page,
  }) => {
    const title = e2eTitle('double-click');
    await page.locator('#request-title').fill(title);
    await page
      .getByLabel('Что нужно закупить?')
      .fill('100 футболок с логотипом до 30 октября 2026');
    await page.getByRole('button', { name: 'Разобрать' }).click();
    await expect(page.getByText('Что мы поняли')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить в заявку' }).click();
    await expect(page.locator('#request-items input[type=number]')).toHaveValue('100');

    const submit = page.getByRole('button', { name: /Отправить заявку|Отправляю/ });
    await submit.click({ clickCount: 3, delay: 0 }).catch(() => undefined);

    await page.waitForURL(/\/buyer\/requests\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // Заявка без заказа — тоже закупка со стадией и понятным следующим шагом.
    await expect(page.getByText('Получено', { exact: true })).toBeVisible();
    await expect(page.getByText('Сейчас ход за')).toBeVisible();
    await expect(page.getByText('QAJET', { exact: true }).first()).toBeVisible();

    // На главной она есть ровно один раз.
    await page.goto('/buyer');
    await expect(page.getByText(title, { exact: true })).toHaveCount(1);
  });
});

test.describe('страница закупки и старые ссылки', () => {
  test('старый адрес заказа перенаправляет на страницу закупки', async ({ page }) => {
    await loginAs(page, 'buyer@demo.qajet.kz');
    await page.goto('/buyer');
    // Экран подтверждения плана живёт по адресу заказа; из его ссылки берём id заказа.
    const confirmLink = page.locator('a[href^="/buyer/orders/"][href$="/confirm"]').first();
    await expect(
      confirmLink,
      'в демо-данных есть закупка, ждущая решения покупателя',
    ).toBeVisible();
    const href = (await confirmLink.getAttribute('href')) as string;
    const orderId = href.split('/')[3] as string;

    await page.goto(`/buyer/orders/${orderId}`);
    await expect(page).toHaveURL(/\/buyer\/requests\/[0-9a-f-]{36}$/);
    // Страница закупки отвечает на три вопроса: этап, чей ход, что делать.
    await expect(page.getByText('Нужно ваше решение', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Сейчас ход за')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Выбрать вариант и утвердить' })).toBeVisible();
  });

  test('чужая или несуществующая закупка даёт 404, а не чужие данные', async ({ page }) => {
    await loginAs(page, 'buyer@demo.qajet.kz');
    const response = await page.goto('/buyer/requests/00000000-0000-4000-8000-000000000000');
    expect(response?.status()).toBe(404);
    const bad = await page.goto('/buyer/requests/not-a-uuid');
    expect(bad?.status()).toBe(404);
  });
});

test.describe('мобильная ширина', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('нижняя панель и страницы покупателя не дают горизонтального скролла', async ({ page }) => {
    await loginAs(page, 'buyer@demo.qajet.kz');
    for (const path of ['/buyer', '/buyer/requests/new']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        tabs: (() => {
          const nav = document.querySelector('nav.fixed');
          return nav ? nav.scrollWidth - nav.clientWidth : 0;
        })(),
      }));
      expect(overflow.page, `${path}: скролл страницы`).toBeLessThanOrEqual(0);
      expect(overflow.tabs, `${path}: скролл нижней панели`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('клавиатура', () => {
  test('форму заявки можно заполнить и отправить без мыши', async ({ page }) => {
    await loginAs(page, 'buyer@demo.qajet.kz');
    await page.goto('/buyer/requests/new');
    await page.locator('#request-title').focus();
    await page.keyboard.type(e2eTitle('keyboard'));
    // Enter в поле формы отправляет её (настоящий <form>): без позиций
    // это даёт ошибку у поля позиций, а не тишину.
    await page.keyboard.press('Enter');
    await expect(page.getByText('Добавьте хотя бы одну позицию')).toBeVisible();
    await expect(page.locator('#request-title')).toHaveValue(/keyboard/);
  });
});
