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

test.describe('известные дефекты админки', () => {
  test.fixme('со страницы «Метрики» есть путь назад в админку (F8)', async () => {
    // Ожидание: на /metrics есть ссылка или навигация, а не тупик.
  });

  test.fixme('очередь верификации на главной позволяет одобрить компанию на месте (F11)', async () => {
    // Ожидание: действие рядом с очередью, а не на другой странице.
  });
});
