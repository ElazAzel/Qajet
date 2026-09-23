import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { canRunLive, createRfqSentOrder, loginAs, skipLiveReason } from './fixtures';

/**
 * «Поставщик молчит»: на старте поставщики не следят за сайтом, поэтому RFQ без
 * ответа перед сроком должен стать задачей консьержа, а не тихо истечь.
 *
 * Время не ждём: срок ответа именно этого заказа сдвигается служебным клиентом
 * (только локальная база и только свои записи E2E-<run>), остальное — глазами
 * консьержа.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test.skip(!canRunLive || !serviceKey, skipLiveReason);

test('консьерж: поставщик без ответа перед сроком виден в «Исключениях»', async ({ browser }) => {
  test.setTimeout(180_000);
  // Заказ доходит до «RFQ отправлен», и никто из поставщиков не отвечает.
  const { title, requestId, orderId } = await createRfqSentOrder(browser, {
    name: 'silent-supplier',
  });

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const inTwoHours = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const { data: updated, error } = await db
    .from('rfqs')
    .update({ respond_by: inTwoHours })
    .eq('request_id', requestId)
    .eq('status', 'sent')
    .select('id');
  expect(error).toBeNull();
  expect(updated?.length ?? 0, 'у заказа есть RFQ без ответа').toBeGreaterThan(0);

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'concierge@demo.qajet.kz');
    await page.goto('/concierge/exceptions');
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row.getByText('Поставщик молчит')).toBeVisible();
    await expect(row.getByText(/не ответили?:/i)).toBeVisible();
    await expect(row.getByText(/свяжитесь напрямую/i)).toBeVisible();
    await expect(row.getByRole('link')).toHaveAttribute('href', `/concierge/orders/${orderId}`);
  } finally {
    await context.close();
  }
});
