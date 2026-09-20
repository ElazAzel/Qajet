import { expect, test } from '@playwright/test';
import {
  advanceStage,
  canRunLive,
  createRfqSentOrder,
  gotoUntilButtonVisible,
  loginAs,
  press,
  rowContaining,
  skipLiveReason,
} from './fixtures';

/**
 * Путь поставщика глазами человека: увидеть новый RFQ, понять срок, ответить,
 * ошибиться, исправить, дойти до заказа, написать, подтвердить доставку.
 * Только то, что человек видит и делает: роли, подписи, видимый текст.
 * Ходы консьержа и покупателя — ровно те, без которых заказ не дойдёт до
 * поставщика; их собственные сценарии — отдельно.
 *
 * Каждый шаг ждёт следующее действие ИМЕННО этого заказа, а не «исчезновения
 * кнопки» и не общего текста состояния, который есть и в чужих строках доски.
 */

test.skip(!canRunLive, skipLiveReason);
test.describe.configure({ mode: 'serial' });

const CAPABILITY = 'Подтверждаю, что могу исполнить эту позицию и указанные условия.';

test('поставщик: от нового RFQ до подтверждения доставки', async ({ browser }) => {
  test.setTimeout(300_000);
  const { title, orderId, orderUrl, requestId } = await createRfqSentOrder(browser, {
    name: 'supplier-journey',
  });

  const supplierCtx = await browser.newContext();
  const conciergeCtx = await browser.newContext();
  const buyerCtx = await browser.newContext();
  const supplier = await supplierCtx.newPage();
  const concierge = await conciergeCtx.newPage();
  const buyer = await buyerCtx.newPage();

  try {
    await loginAs(supplier, 'supplier@demo.qajet.kz');

    // Цель: понять, что просят и до какого срока. Срок и главное действие видны сразу.
    await supplier.goto('/supplier');
    const card = rowContaining(supplier, title, 'li');
    await expect(card).toBeVisible();
    await expect(card.getByText(/Ответить до/)).toBeVisible();
    await card.getByRole('link', { name: 'Берусь, цена и срок' }).click();
    await supplier.waitForURL(/\/supplier\/rfq\//);
    const rfqUrl = supplier.url();
    await expect(supplier.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // На телефоне форма не требует горизонтальной прокрутки.
    await supplier.setViewportSize({ width: 375, height: 800 });
    const overflow = await supplier.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, 'форма КП на 375px не должна прокручиваться вбок').toBe(false);
    await supplier.setViewportSize({ width: 1280, height: 720 });

    // Ошибка: отправить пустую форму. Сообщение объясняет, что исправить.
    await supplier.getByRole('button', { name: 'Отправить КП' }).click();
    await expect(supplier.getByText('Укажите цену хотя бы по одной позиции')).toBeVisible();
    await expect(supplier).toHaveURL(rfqUrl);

    // Исправление: заполнить условия и подтвердить, что можешь исполнить.
    await supplier.getByLabel('Цена за ед., ₸').first().fill('4500');
    await supplier.getByLabel('Срок, дней').first().fill('10');
    await supplier.getByLabel('Setup fee, ₸').first().fill('0');
    await supplier.getByLabel('Мин. партия, шт.').first().fill('1');
    await supplier.getByRole('checkbox', { name: CAPABILITY }).first().check();
    await supplier.getByRole('button', { name: 'Отправить КП' }).click();
    await supplier.waitForURL('**/supplier');

    // Результат ясен: запрос ушёл из «новых», а на странице RFQ сказано, что ответ дан.
    await expect(rowContaining(supplier, title, 'li')).toHaveCount(0);
    await supplier.goto(rfqUrl);
    await expect(supplier.getByText('На этот запрос уже дан ответ')).toBeVisible();

    // Дальше работают консьерж и покупатель: без их ходов заказ не станет заказом поставщика.
    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await advanceStage(concierge, orderUrl, '→ КП получены');
    const propose = await gotoUntilButtonVisible(concierge, orderUrl, 'Предложить этот план');
    await press(concierge, propose);
    await expect(concierge.getByRole('button', { name: 'Предложить этот план' })).toHaveCount(0);

    await loginAs(buyer, 'buyer@demo.qajet.kz');
    await buyer.goto(`/buyer/requests/${requestId}`);
    await buyer.getByRole('link', { name: 'Перейти к подтверждению' }).click();
    const approve = await gotoUntilButtonVisible(
      buyer,
      `/buyer/orders/${orderId}/confirm`,
      'Подтверждаю заказ на этих условиях',
    );
    await press(buyer, approve);
    await expect(
      buyer.getByRole('button', { name: 'Подтверждаю заказ на этих условиях' }),
    ).toHaveCount(0);

    await concierge.goto(orderUrl);
    const payout = concierge.getByRole('button', { name: 'Подтвердить выплату' }).first();
    await expect(payout).toBeVisible();
    await concierge
      .getByLabel('Reference')
      .locator('visible=true')
      .first()
      .fill(`E2E-PAYOUT-${Date.now()}`);
    await press(concierge, payout);
    await advanceStage(concierge, orderUrl, '→ В производстве');

    // Заказ появился у поставщика: его видно на главной и открывается страница заказа.
    await supplier.goto('/supplier');
    // Заголовок в строке заказа склеен с названием компании, поэтому ищем по вхождению.
    await expect(
      supplier
        .getByRole('listitem')
        .filter({ hasText: title })
        .getByRole('link', { name: 'Открыть' }),
    ).toBeVisible();

    // Переписка по заказу: сообщение появляется в ленте.
    await supplier.goto(`/supplier/orders/${orderId}/messages`);
    const text = `Вопрос по срокам: нужен макет до пятницы (${Date.now()})`;
    await supplier.getByLabel('Текст сообщения').fill(text);
    await supplier.getByRole('button', { name: 'Отправить', exact: true }).click();
    // Текст есть и в превью списка диалогов, и в самом сообщении: проверяем сообщение.
    await expect(supplier.getByRole('paragraph').filter({ hasText: text })).toBeVisible();

    // Подтверждение доставки доступно только после отгрузки и исчезает после подтверждения.
    await advanceStage(concierge, orderUrl, '→ Отгружен');
    await supplier.goto(`/supplier/orders/${orderId}`);
    const confirmDelivery = supplier.getByRole('button', { name: 'Подтвердить доставку' });
    await expect(confirmDelivery).toBeVisible();
    await press(supplier, confirmDelivery);
    await supplier.reload();
    await expect(supplier.getByRole('button', { name: 'Подтвердить доставку' })).toHaveCount(0);
  } finally {
    await supplierCtx.close();
    await conciergeCtx.close();
    await buyerCtx.close();
  }
});

/**
 * Найдено ручным проходом (docs/qa/post-hardening-ux-audit.md, F1-F3). Сценарии
 * записаны заранее и пропущены: продуктовое решение по F1 ещё не принято, а
 * ассерт на нынешнее молчаливое поведение закрепил бы дефект как норму.
 */
test.describe('известные дефекты формы КП', () => {
  test.fixme('КП без подтверждения «могу исполнить» предупреждает поставщика ДО отправки (F1)', async () => {
    // Ожидание после решения: неотмеченная галочка даёт понятное предупреждение,
    // а после отправки виден статус «ждёт вашего подтверждения».
  });

  test.fixme('ошибка формы объявляется экранному читателю и не остаётся после исправления (F2)', async () => {
    // Ожидание: у сообщения role="alert"; после корректного ввода оно исчезает.
  });

  test.fixme('после отправки виден отправленный ответ и его статус (F3)', async () => {
    // Ожидание: на главной есть раздел отправленных КП со статусом.
  });
});
