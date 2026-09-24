import { expect, test } from '@playwright/test';

test('public landing opens from the production standalone server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /войти в систему/i })).toBeVisible();
});

/**
 * Посадочная за «три секунды»: кто мы и чем полезны — в первом экране, на
 * телефоне и на десктопе, без горизонтальной прокрутки.
 */
for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`посадочная ${viewport.width}px: суть и действие в первом экране`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await page.goto('/');
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toContainText('Скажите, что нужно купить');
      const cta = page.getByRole('link', { name: /Обсудить закупку/ }).first();
      for (const locator of [heading, cta]) {
        const box = await locator.boundingBox();
        expect(box && box.y + box.height <= viewport.height, 'в первом экране').toBe(true);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
}

test('посадочная: демо-видео без звука, с постером и не играет само при reduced motion', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const demo = page.getByRole('figure', { name: /Как это выглядит в продукте/ });
    await expect(demo).toBeVisible();
    const video = demo.locator('video');
    await expect(video).toHaveAttribute('poster', /qajet-demo-poster\.webp$/);
    await expect(video).toHaveAttribute('playsinline', '');
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(false);
    await page.waitForTimeout(800);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    // Управление доступно: человек сам решает, смотреть ли.
    expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(true);
  } finally {
    await context.close();
  }
});

test('посадочная: шаги показаны реальными экранами продукта', async ({ page }) => {
  await page.goto('/');
  const steps = page.getByRole('list', { name: 'Как это работает' }).getByRole('listitem');
  await expect(steps).toHaveCount(4);
  for (const name of [/Что нужно закупить/, /Подбираем исполнителей/, /Документы заказа/]) {
    await expect(page.getByRole('img', { name })).toBeVisible();
  }
  // Пример фразы — тот же, что разбирает форма заявки (landing-example.test.ts).
  await expect(
    page.getByText('150 welcome-наборов для новых сотрудников', { exact: false }).first(),
  ).toBeVisible();
});

test('service worker не предзагружает демо-видео', async ({ request }) => {
  const response = await request.get('/sw.js');
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain('qajet-demo.mp4');
});
