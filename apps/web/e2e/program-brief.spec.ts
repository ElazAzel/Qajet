import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('собирает бриф без входа и передаёт его в WhatsApp только по действию пользователя', async ({
  page,
}) => {
  await page.goto('/collections');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Соберите закупку под вашу задачу',
  );
  await page.getByLabel('Количество получателей').fill('50');
  await page.getByLabel('Общий бюджет, ₸').fill('500000');
  const summary = page.getByRole('complementary', { name: 'Итог брифа' });
  await expect(summary).toContainText('500 000 ₸');
  await expect(summary).toContainText('10 000 ₸');
  const target = await page
    .getByRole('link', { name: 'Обсудить готовый бриф' })
    .getAttribute('href');
  expect(target).not.toBeNull();
  const whatsapp = new URL(target ?? '');
  expect(whatsapp.hostname).toBe('wa.me');
  expect(whatsapp.searchParams.get('text')).toContain('Общий бюджет клиента: 500 000');
  expect(page.url()).not.toMatch(/500000|budget=/);
  await page.getByLabel('Количество получателей').fill('1');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Проверьте количество, бюджет и дату' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Обсудить готовый бриф' })).toHaveCount(0);
});

test('сохраняет бриф в этой вкладке и переносит его в форму входа без суммы в URL', async ({
  page,
}) => {
  await page.goto('/collections?program=event');
  await page.getByLabel('Общий бюджет, ₸').fill('720000');
  await page.getByRole('button', { name: 'Я уже клиент: открыть заявку' }).click();
  await expect(page).toHaveURL(/\/login\?prepared=program$/);
  await expect(
    page.getByText('После входа откроется подготовленная заявка.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('input[name="brief"]')).toHaveValue(
    'program=event&qty=100&city=almaty&budget=720000',
  );
  expect(page.url()).not.toContain('720000');
  // No sign-in or database write is attempted by this public scenario.
});

test('доступен на мобильном экране и с клавиатуры', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/collections');
  await page.getByRole('button', { name: /Участникам события/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Участникам события/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Количество получателей')).toHaveValue('100');
  await expect(page.getByText('Баннер 2×1 м', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
});
