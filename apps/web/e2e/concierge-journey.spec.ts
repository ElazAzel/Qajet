import { expect, test } from '@playwright/test';
import {
  advanceStage,
  canRunLive,
  createRfqSentOrder,
  e2eTitle,
  gotoUntilButtonVisible,
  loginAs,
  rowContaining,
  setSetting,
  skipLiveReason,
} from './fixtures';

/**
 * Работа консьержа с действиями: то, чего не покрывает сквозной сценарий заказа.
 *
 *   1. Тупик и его исправление. Заказ, у которого все КП отбракованы, не даёт
 *      предложить план; консьерж запрашивает исправление, поставщик исправляет,
 *      план снова доступен. Это задуманный путь выхода (аудит, F1).
 *   2. Новая заявка берётся в работу и исчезает из блока «Новые заявки».
 *   3. Очередь «Исключения» показывает заказы на паузе и в споре.
 *
 * Только роли, подписи и видимый текст. Каждый шаг ждёт следующее действие ИМЕННО
 * этого заказа, а не исчезновения кнопки.
 */

test.skip(!canRunLive, skipLiveReason);
test.describe.configure({ mode: 'serial' });

test('консьерж: заказ с отбракованными КП → запрос исправления → план снова доступен', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { title, orderUrl } = await createRfqSentOrder(browser, { name: 'concierge-revision' });

  const supplierCtx = await browser.newContext();
  const conciergeCtx = await browser.newContext();
  const supplier = await supplierCtx.newPage();
  const concierge = await conciergeCtx.newPage();

  try {
    // Поставщик отвечает, не отметив «могу исполнить»: КП принимается, но будет отбраковано.
    await loginAs(supplier, 'supplier@demo.qajet.kz');
    await supplier.goto('/supplier');
    await rowContaining(supplier, title, 'li')
      .getByRole('link', { name: 'Берусь, цена и срок' })
      .click();
    await supplier.waitForURL(/\/supplier\/rfq\//);
    const rfqUrl = supplier.url();
    await supplier.getByLabel('Цена за ед., ₸').first().fill('4500');
    await supplier.getByLabel('Срок, дней').first().fill('10');
    await supplier.getByLabel('Setup fee, ₸').first().fill('0');
    await supplier.getByLabel('Мин. партия, шт.').first().fill('1');
    // Отправка без подтверждения теперь двухшаговая: первое нажатие предупреждает
    // (аудит F1), второе отправляет. Политика отбраковки при этом не изменилась,
    // поэтому дальше сценарий тот же — КП принято и будет отбраковано.
    await supplier.getByRole('button', { name: 'Отправить КП' }).click();
    await supplier.getByRole('button', { name: 'Всё равно отправить без подтверждения' }).click();
    await supplier.waitForURL('**/supplier');

    // Консьерж видит причину тупика и не может предложить план.
    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await advanceStage(concierge, orderUrl, '→ КП получены');
    await concierge.goto(orderUrl);
    await expect(
      concierge.getByText('Ни один вариант не прошёл допустимость').locator('visible=true'),
    ).toBeVisible();
    await expect(concierge.getByRole('button', { name: 'Предложить этот план' })).toHaveCount(0);

    // Выход: запросить исправление с пояснением.
    await concierge.getByRole('link', { name: /Проверить КП и запросить исправление/ }).click();
    await concierge.waitForURL(/\/quotes$/);
    const note = concierge.getByRole('textbox', { name: 'Что нужно уточнить или исправить' });
    const send = concierge.getByRole('button', { name: 'Запросить исправление' });
    await expect(send, 'без пояснения кнопка недоступна').toBeDisabled();
    await note.fill('Подтвердите, что можете исполнить позицию');
    await expect(send).toBeEnabled();
    await send.click();
    // Признак успеха — строка о том, что запрос отправлен, а не очистка поля: в 1 из 12
    // локальных прогонов запрос принимался сервером, а текст в поле оставался.
    await expect(
      concierge.getByText('Запрос исправления уже отправлен').locator('visible=true'),
    ).toBeVisible();

    // Поставщик видит запрос и исправляет КП.
    await supplier.goto(rfqUrl);
    await expect(
      supplier.getByText('QAJET запросил исправление КП').locator('visible=true'),
    ).toBeVisible();
    await expect(supplier.getByText('Подтвердите, что можете исполнить позицию')).toBeVisible();
    await supplier.getByLabel('Цена за ед., ₸').first().fill('4500');
    await supplier.getByLabel('Срок, дней').first().fill('10');
    await supplier.getByLabel('Setup fee, ₸').first().fill('0');
    await supplier.getByLabel('Мин. партия, шт.').first().fill('1');
    await supplier
      .getByRole('checkbox', {
        name: 'Подтверждаю, что могу исполнить эту позицию и указанные условия.',
      })
      .first()
      .check();
    await supplier.getByRole('button', { name: 'Отправить исправленное КП' }).click();
    await supplier.waitForURL('**/supplier');

    // Тупик снят: план можно предложить.
    await gotoUntilButtonVisible(concierge, orderUrl, 'Предложить этот план');
    await expect(concierge.getByText('Ни один вариант не прошёл допустимость')).toHaveCount(0);
  } finally {
    await supplierCtx.close();
    await conciergeCtx.close();
  }
});

test('консьерж: новая заявка берётся в работу и исчезает из «Новых заявок»', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const title = e2eTitle('concierge-intake');
  await setSetting(browser, 'Поставщиков в рассылке RFQ', '20');

  const buyerCtx = await browser.newContext();
  const conciergeCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  const concierge = await conciergeCtx.newPage();
  try {
    await loginAs(buyer, 'buyer@demo.qajet.kz');
    await buyer.goto('/buyer/requests/new');
    await buyer.locator('#request-title').fill(title);
    await buyer.getByRole('button', { name: 'Добавить позицию из каталога' }).click();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 30);
    await buyer.locator('#request-date').fill(deadline.toISOString().slice(0, 10));
    await buyer.getByRole('button', { name: 'Отправить заявку' }).click();
    await buyer.waitForURL(/\/buyer\/requests\/[0-9a-f-]{36}$/);

    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await concierge.goto('/concierge');
    const take = rowContaining(concierge, title).getByRole('button', { name: 'Взять в работу' });
    await expect(take, 'новая заявка видна с кнопкой «Взять в работу»').toBeVisible();
    await take.click();
    await concierge.waitForURL(/\/concierge\/orders\//);

    // Заявка взята: кнопки «Взять в работу» у неё больше нет, повторно взять нельзя.
    await concierge.goto('/concierge');
    await expect(
      rowContaining(concierge, title).getByRole('button', { name: 'Взять в работу' }),
    ).toHaveCount(0);
  } finally {
    await buyerCtx.close();
    await conciergeCtx.close();
  }
});

test('консьерж: «Исключения» показывает заказы на паузе и в споре', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'concierge@demo.qajet.kz');
    await page.goto('/concierge/exceptions');
    await expect(page.getByRole('heading', { level: 1, name: 'Исключения' })).toBeVisible();
    // Область очереди — правая колонка; слева доска, где те же слова встречаются в других строках.
    const queue = page.getByTestId('detail');
    await expect(queue.getByText(/заказ\S* требуют решения/)).toBeVisible();
    // Демо-данные содержат по одному заказу «На паузе» и «Спор»: если это изменится,
    // проверка должна упасть и потребовать фикстуру, а не молча пропуститься.
    await expect(queue.getByText('На паузе')).toBeVisible();
    await expect(queue.getByText('Спор')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('консьерж: заказ с отбракованными КП виден в «Исключениях» и помечен на доске (F1, F6)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { title, orderUrl } = await createRfqSentOrder(browser, { name: 'concierge-blocked' });

  const supplierCtx = await browser.newContext();
  const conciergeCtx = await browser.newContext();
  const supplier = await supplierCtx.newPage();
  const concierge = await conciergeCtx.newPage();

  try {
    // КП без подтверждения возможности: принимается, но будет отбраковано.
    await loginAs(supplier, 'supplier@demo.qajet.kz');
    await supplier.goto('/supplier');
    await rowContaining(supplier, title, 'li')
      .getByRole('link', { name: 'Берусь, цена и срок' })
      .click();
    await supplier.waitForURL(/\/supplier\/rfq\//);
    await supplier.getByLabel('Цена за ед., ₸').first().fill('4500');
    await supplier.getByLabel('Срок, дней').first().fill('10');
    await supplier.getByLabel('Setup fee, ₸').first().fill('0');
    await supplier.getByLabel('Мин. партия, шт.').first().fill('1');
    await supplier.getByRole('button', { name: 'Отправить КП' }).click();
    await supplier.getByRole('button', { name: 'Всё равно отправить без подтверждения' }).click();
    await supplier.waitForURL('**/supplier');

    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await advanceStage(concierge, orderUrl, '→ КП получены');

    // На доске (левая колонка) строка этого заказа помечена, а не выглядит здоровой.
    // Строка доски — это ссылка, поэтому ищем по роли, а не по вёрстке.
    await concierge.goto('/concierge/exceptions');
    const boardRow = concierge
      .getByTestId('list')
      .getByRole('link')
      .filter({ hasText: title })
      .first();
    await expect(boardRow.getByText('Заблокирован')).toBeVisible();

    // И тот же заказ попал в очередь действий справа, а не потерялся.
    // Проверка привязана к СВОЕЙ строке: заблокированных заказов в очереди
    // закономерно несколько — их создают и другие сценарии, а данные e2e не
    // чистятся. Общая проверка по всей очереди ловила бы чужую строку.
    const queueRow = concierge.getByTestId('detail').getByRole('link').filter({ hasText: title });
    await expect(queueRow, 'заказ ровно один раз в очереди').toHaveCount(1);
    await expect(queueRow.getByText('Все КП отбракованы')).toBeVisible();
  } finally {
    await supplierCtx.close();
    await conciergeCtx.close();
  }
});

test('консьерж: строка доски показывает срок и «чей ход» (F6)', async ({ browser }) => {
  test.setTimeout(180_000);
  const { title } = await createRfqSentOrder(browser, { name: 'concierge-board-row' });

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'concierge@demo.qajet.kz');
    await page.goto('/concierge');
    const row = page.getByTestId('list').getByRole('link').filter({ hasText: title }).first();
    // Заказ ждёт КП от поставщиков — по строке это должно читаться без открытия.
    await expect(row.getByText(/Поставщики/)).toBeVisible();
    // И срок: фикстура ставит его в будущем, поэтому просрочки быть не должно.
    await expect(row.getByText(/к \d|срок сегодня|срок не указан/)).toBeVisible();
  } finally {
    await context.close();
  }
});
