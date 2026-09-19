import { expect, test } from '@playwright/test';
import {
  advanceStage,
  canRunLive,
  createQuotesReceivedOrder,
  gotoUntilButtonVisible,
  loginAs,
  press,
  skipLiveReason,
} from './fixtures';

/**
 * Сквозной сценарий — agents.md фаза 7 чек-лист: заявка → закрытие,
 * в двух вариантах (возврат/доплата). Ведёт заказ через реальные экраны
 * трёх ролей (покупатель, консьерж, поставщик) теми же формами и кнопками,
 * что и живой пользователь — ни одного прямого вызова server action или
 * SQL в обход UI. Доводит заявку до `quotes_received` через
 * `createQuotesReceivedOrder()` (e2e/fixtures.ts, общий фрагмент с
 * animation-budget.spec.ts), дальше — утверждение и закрытие сами.
 *
 * Требует живую Supabase-сессию с демо-аккаунтами (см.
 * packages/db/src/seed/accounts.ts, пароль `qajet2026` для всех) —
 * без `NEXT_PUBLIC_SUPABASE_URL` тест пропускает себя сам, тем же приёмом,
 * что и packages/db/src/__tests__/supplier-isolation.test.ts.
 *
 * Честно про побочный эффект: каждый прогон создаёт настоящую заявку и
 * проводит её до closed в реальной БД (заголовок помечен `E2E … <ts>`,
 * чтобы отличать от демо-данных) — тестовые строки не удаляются
 * автоматически, сервисного ключа с правом bypass RLS в окружении нет
 * (тот же открытый пункт, что и отсутствие `DATABASE_URL` в CI для теста
 * изоляции поставщиков — см. README «Известные ограничения»). Периодическая
 * очистка — вручную, как это делалось в ходе разработки.
 */

test.skip(!canRunLive, skipLiveReason);

test.describe.configure({ mode: 'serial' });

for (const settlement of ['refund', 'surcharge'] as const) {
  const settlementLabel = settlement === 'refund' ? 'возврат' : 'доплата';

  test(`сквозной сценарий: заявка → закрытие (${settlementLabel})`, async ({ browser }) => {
    // ~15 полных навигаций по трём ролям — тест реально укладывается
    // в ~1.5-2 минуты локально, конфигурационного 60с таймаута мало.
    test.setTimeout(180_000);

    const buyerCtx = await browser.newContext();
    const buyer = await buyerCtx.newPage();
    const conciergeCtx = await browser.newContext();
    const concierge = await conciergeCtx.newPage();
    const supplierCtx = await browser.newContext();
    const supplier = await supplierCtx.newPage();

    try {
      const { orderUrl, orderId, requestId } = await createQuotesReceivedOrder(browser, {
        name: `lifecycle-${settlement}`,
        prepaymentAmountKzt: settlement === 'refund' ? 2_000_000_000 : 1_000_000,
        quotePriceKzt: settlement === 'refund' ? 4_500 : 1_000_000,
      });

      // 6. Экран сравнения — предлагает рекомендованный план
      await loginAs(concierge, 'concierge@demo.qajet.kz');
      const proposePlanButton = await gotoUntilButtonVisible(
        concierge,
        orderUrl,
        'Предложить этот план',
      );
      await press(concierge, proposePlanButton);
      await expect(concierge.getByRole('button', { name: 'Предложить этот план' })).toHaveCount(0);

      // 7. Покупатель открывает экран условий и утверждает конкретную версию
      await loginAs(buyer, 'buyer@demo.qajet.kz');
      const buyerOrderUrl = `/buyer/requests/${requestId}`;
      await buyer.goto(buyerOrderUrl);
      await buyer.getByRole('link', { name: 'Перейти к подтверждению' }).click();
      await buyer.waitForURL(new RegExp(`/buyer/orders/${orderId}/confirm`));
      const approvePlanButton = await gotoUntilButtonVisible(
        buyer,
        `/buyer/orders/${orderId}/confirm`,
        'Подтверждаю заказ на этих условиях',
      );
      await press(buyer, approvePlanButton);
      await expect(
        buyer.getByRole('button', { name: 'Подтверждаю заказ на этих условиях' }),
      ).toHaveCount(0);

      // 8. Консьерж проводит заказ до отгрузки
      await loginAs(concierge, 'concierge@demo.qajet.kz');
      await concierge.goto(orderUrl);
      const payoutButton = concierge.getByRole('button', { name: 'Подтвердить выплату' }).first();
      await expect(payoutButton).toBeVisible();
      await concierge
        .getByLabel('Reference')
        .locator('visible=true')
        .first()
        .fill(`E2E-PAYOUT-${Date.now()}`);
      await press(concierge, payoutButton);
      await expect(concierge.getByRole('button', { name: 'Подтвердить выплату' })).toHaveCount(0);
      await advanceStage(concierge, orderUrl, '→ В производстве');
      await advanceStage(concierge, orderUrl, '→ Отгружен');

      // Доставку фиксирует только поставщик. Это отдельная сессия и тот же
      // экран, который поставщик использует после исполнения заказа.
      await loginAs(supplier, 'supplier@demo.qajet.kz');
      await supplier.goto(`/supplier/orders/${orderId}`);
      await press(supplier, supplier.getByRole('button', { name: 'Подтвердить доставку' }));
      await expect(supplier.getByRole('button', { name: 'Подтвердить доставку' })).toHaveCount(0);

      // 9. Покупатель принимает поставку
      const acceptDeliveryButton = await gotoUntilButtonVisible(
        buyer,
        buyerOrderUrl,
        'Принять поставку',
      );
      await press(buyer, acceptDeliveryButton);
      await expect(buyer.getByRole('button', { name: 'Принять поставку' })).toHaveCount(0);

      // 10. Staff фиксирует требуемый возврат/доплату, покупатель закрывает
      // заказ после того, как факт операции попал в payment_facts.
      await loginAs(concierge, 'concierge@demo.qajet.kz');
      await concierge.goto(orderUrl);
      const settlementButton = concierge.getByRole('button', {
        name: settlement === 'refund' ? 'Подтвердить возврат' : 'Подтвердить доплату',
      });
      await expect(settlementButton).toBeVisible();
      await concierge
        .getByLabel('Банковский reference')
        .locator('visible=true')
        .fill(`E2E-SETTLEMENT-${Date.now()}`);
      await press(concierge, settlementButton);
      await expect(
        concierge.getByRole('button', {
          name: settlement === 'refund' ? 'Подтвердить возврат' : 'Подтвердить доплату',
        }),
      ).toHaveCount(0);

      await gotoUntilButtonVisible(buyer, buyerOrderUrl, 'Подтвердить сверку и закрыть');
      await press(buyer, buyer.getByRole('button', { name: 'Подтвердить сверку и закрыть' }));
      await expect(buyer.getByText('Заказ закрыт', { exact: true })).toBeVisible();
    } finally {
      await buyerCtx.close();
      await conciergeCtx.close();
      await supplierCtx.close();
    }
  });
}
