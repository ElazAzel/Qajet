import { expect, test } from '@playwright/test';

test('invalid public RFQ link fails closed instead of returning an application error', async ({
  page,
}) => {
  const response = await page.goto('/rfq/respond/not-a-token');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
});
