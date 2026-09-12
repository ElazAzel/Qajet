import { expect, test } from '@playwright/test';

test('public landing opens from the production standalone server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /войти в систему/i })).toBeVisible();
});
