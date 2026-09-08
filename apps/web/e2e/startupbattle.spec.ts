import { expect, test } from '@playwright/test';

// Public pitch page: deliberately needs no Supabase session or seeded database.
test('pitch page is public and the presentation is available', async ({ page, request }) => {
  const response = await page.goto('/startupbattle');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Закупки не должны отвлекать от бизнеса.',
  );
  await expect(page).toHaveTitle(/QAJET/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /внешний отдел закупок/,
  );
  const pdf = await request.get('/startupbattle/QAJET-pitch.pdf');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByRole('link', { name: /Написать @qajet.io/ })).toHaveAttribute(
    'href',
    'https://www.instagram.com/qajet.io/',
  );
});

test('cost breakdown and product tour work with the keyboard', async ({ page }) => {
  await page.goto('/startupbattle');
  await page.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: '82 350 ₸' })).toBeVisible();
  await page.getByRole('tab', { name: 'Покупатель', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Консьерж', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toContainText('Вся очередь заказов перед глазами');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel')).toContainText('демо-базе');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Покупатель', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    const image = page.getByRole('tabpanel').getByRole('img');
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
});

for (const width of [320, 375, 768, 1440]) {
  test(`page fits a ${width}px viewport`, async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/startupbattle');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const firstBarSegment = page
      .locator('[role="img"][aria-label^="Товар:"]')
      .first()
      .locator('div')
      .first();
    await firstBarSegment.scrollIntoViewIfNeeded();
    await expect
      .poll(() => firstBarSegment.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(50);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('link', { name: 'Посмотреть продукт' }).click();
    await expect(page).toHaveURL(/#product$/);
    await expect(page.getByRole('tab', { name: 'Покупатель', exact: true })).toBeInViewport();
    await page.getByRole('link', { name: /Обсудить пилот/ }).click();
    await expect(page).toHaveURL(/#contact$/);
    await expect(page.getByRole('link', { name: /Написать @qajet.io/ })).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });
}
