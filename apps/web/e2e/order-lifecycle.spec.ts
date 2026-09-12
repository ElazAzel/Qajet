import { expect, test } from '@playwright/test';
import {
  advanceStage,
  createQuotesReceivedOrder,
  gotoUntilButtonVisible,
  hasSupabaseEnv,
  loginAs,
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

test.skip(!hasSupabaseEnv, 'NEXT_PUBLIC_SUPABASE_URL не задан — нет живой Supabase-сессии для e2e');

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
      const { orderUrl, orderId } = await createQuotesReceivedOrder(browser);

      // 6. Экран сравнения — предлагает рекомендованный план
      await loginAs(concierge, 'concierge@demo.qajet.kz');
      const proposePlanButton = await gotoUntilButtonVisible(
        concierge,
        orderUrl,
        'Предложить этот план',
      );
      await proposePlanButton.click();
      await expect(concierge.getByRole('button', { name: 'Предложить этот план' })).toHaveCount(0);

      // 7. Покупатель утверждает план
      await loginAs(buyer, 'buyer@demo.qajet.kz');
      const buyerOrderUrl = `/buyer/orders/${orderId}`;
      const approvePlanButton = await gotoUntilButtonVisible(
        buyer,
        buyerOrderUrl,
        'Утвердить план',
      );
      await approvePlanButton.click();
      await expect(buyer.getByRole('button', { name: 'Утвердить план' })).toHaveCount(0);

      // 8. Консьерж проводит заказ до отгрузки
      await advanceStage(concierge, orderUrl, '→ Поставщики оплачены');
      await advanceStage(concierge, orderUrl, '→ В производстве');
      await advanceStage(concierge, orderUrl, '→ Отгружен');

      // Доставку фиксирует только поставщик. Это отдельная сессия и тот же
      // экран, который поставщик использует после исполнения заказа.
      await loginAs(supplier, 'supplier@demo.qajet.kz');
      await supplier.goto(`/supplier/orders/${orderId}`);
      await supplier.getByRole('button', { name: 'Подтвердить доставку' }).click();
      await expect(supplier.getByRole('button', { name: 'Подтвердить доставку' })).toHaveCount(0);

      // 9. Покупатель принимает поставку
      const acceptDeliveryButton = await gotoUntilButtonVisible(
        buyer,
        buyerOrderUrl,
        'Принять поставку',
      );
      await acceptDeliveryButton.click();
      await expect(buyer.getByRole('button', { name: 'Принять поставку' })).toHaveCount(0);

      // 10. Закрытие со сверкой — вариант возврата/доплаты
      await gotoUntilButtonVisible(buyer, buyerOrderUrl, 'Закрыть заказ');
      if (settlement === 'refund') {
        await buyer.getByLabel('Возврат покупателю').check();
        await buyer.getByLabel('Сумма, ₸').fill('5000');
      } else {
        await buyer.getByLabel('Доплата от покупателя').check();
        await buyer.getByLabel('Сумма, ₸').fill('7500');
      }
      await buyer.getByRole('button', { name: 'Закрыть заказ' }).click();
      await expect(buyer.getByText('Заказ закрыт')).toBeVisible();
    } finally {
      await buyerCtx.close();
      await conciergeCtx.close();
      await supplierCtx.close();
    }
  });
}
