import { expect, test } from '@playwright/test';
import { canRunLive, loginAs, press, RUN_ID, skipLiveReason } from './fixtures';

/**
 * Работа админа с действиями. До этого админский путь не имел ни одного e2e.
 *
 *   1. Подключить поставщика: ошибка пустой формы, создание, строка в реестре «На
 *      проверке», одобрение с комментарием, статус «Одобрен».
 *   2. Параметр экономики меняется вживую, сохраняется после перезагрузки и
 *      возвращается на прежнее значение (общее состояние не оставляем изменённым).
 *   3. Из меню админа открываются все разделы.
 *
 * Не покрыто: отклонение компании, повтор приглашения, повтор письма в «Исходящих»
 * (для него нужна строка в статусе failed), выпуск ссылки для жюри.
 * Только роли, подписи и видимый текст. Записи помечены `E2E-<runId>`.
 */

test.skip(!canRunLive, skipLiveReason);
test.describe.configure({ mode: 'serial' });

test('админ: подключить поставщика и одобрить его', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = `E2E-${RUN_ID}-admin-supplier`;
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    await page.goto('/admin/companies');

    // Пустая форма не создаёт компанию и объясняет, что проверить.
    const create = page.getByRole('button', { name: 'Создать компанию и отправить приглашение' });
    await create.click();
    await expect(page.getByText('Проверьте реквизиты компании и owner-а')).toBeVisible();

    await page.getByLabel('Тип').selectOption('supplier');
    await page.getByLabel('Название').fill(name);
    await page.getByLabel('БИН').fill('900540990099');
    await page.getByLabel('Город').fill('Алматы');
    await page.getByLabel('Имя owner-а').fill('E2E Owner');
    await page.getByLabel('Email owner-а').fill(`e2e-${RUN_ID}-admin-owner@demo.qajet.kz`);
    await press(page, create);

    // Компания появилась в реестре и ждёт проверки.
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText('На проверке')).toBeVisible();

    // Одобрение с комментарием: статус меняется без ручной перезагрузки.
    await row.getByPlaceholder('Комментарий').fill('Документы проверены');
    await press(page, row.getByRole('button', { name: 'Одобрить' }));
    await expect(row.getByText('Одобрен')).toBeVisible();
    await expect(row.getByText('Документы проверены')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('админ: параметр экономики меняется, сохраняется и возвращается', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const label = 'Стоимость часа закупщика';
  let original = '';
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    await page.goto('/admin/settings');
    const input = page.getByLabel(label);
    original = await input.inputValue();
    const changed = String(Number(original) + 7);
    const apply = input.locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Применить' });

    await expect(apply, 'без изменения значения кнопка недоступна').toBeDisabled();
    await input.fill(changed);
    await expect(apply).toBeEnabled();
    await press(page, apply);

    await page.reload();
    await expect(page.getByLabel(label), 'значение сохранилось после перезагрузки').toHaveValue(
      changed,
    );
  } finally {
    // Общее состояние не оставляем изменённым, даже если тест упал посередине.
    if (original !== '') {
      await page.goto('/admin/settings');
      const input = page.getByLabel(label);
      if ((await input.inputValue()) !== original) {
        await input.fill(original);
        await press(
          page,
          input.locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Применить' }),
        );
        await page.reload();
      }
      await expect(page.getByLabel(label)).toHaveValue(original);
    }
    await context.close();
  }
});

test('админ: из меню открываются все разделы', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const sections: [string, string][] = [
    ['Верификация', 'Верификация поставщиков'],
    ['Компании', 'Компании и подключения'],
    ['Как система учится', 'Как система учится'],
    ['Финансы', 'Финансовые факты'],
    ['Споры', 'Споры'],
    ['Параметры', 'Параметры экономики'],
    ['Исходящие', 'Исходящие уведомления'],
  ];
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    for (const [link, heading] of sections) {
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

/** F8 (docs/qa/post-hardening-ux-audit.md): /metrics вне оболочки, но не тупик. */
test('админ: со страницы «Метрики» есть путь назад в админку (F8)', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    await page.goto('/metrics');
    await expect(page.getByRole('heading', { level: 1, name: 'Юнит-экономика' })).toBeVisible();
    await page.getByRole('link', { name: 'В админку' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Верификация поставщиков' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

/** F11: очередь и действие в одном месте — одобрить можно прямо с главной админа. */
test('админ: очередь верификации на главной позволяет одобрить компанию на месте (F11)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = `E2E-${RUN_ID}-admin-queue`;
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    await page.goto('/admin/companies');
    await page.getByLabel('Тип').selectOption('supplier');
    await page.getByLabel('Название').fill(name);
    await page.getByLabel('БИН').fill('900540990099');
    await page.getByLabel('Город').fill('Алматы');
    await page.getByLabel('Имя owner-а').fill('E2E Owner');
    await page.getByLabel('Email owner-а').fill(`e2e-${RUN_ID}-admin-queue@demo.qajet.kz`);
    await press(
      page,
      page.getByRole('button', { name: 'Создать компанию и отправить приглашение' }),
    );
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();

    await page.getByRole('link', { name: 'Верификация', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.getByText('На проверке')).toBeVisible();
    await row.getByPlaceholder('Комментарий').fill('Проверено из очереди');
    await press(page, row.getByRole('button', { name: 'Одобрить' }));
    await expect(row.getByText('Одобрен')).toBeVisible();
    // После решения действие уходит: одобренную компанию повторно не одобряют.
    await expect(row.getByRole('button', { name: 'Одобрить' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
