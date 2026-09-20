import { expect, test } from '@playwright/test';
import { canRunLive, createQuotesReceivedOrder, loginAs, skipLiveReason } from './fixtures';

/**
 * Бюджет анимаций на экране сравнения — agents.md фаза 7 чек-лист и
 * план «Движение»: «бюджет 60fps проверяется отдельным Playwright-тестом
 * на экране сравнения». Это самый насыщенный движением экран продукта
 * (Reveal + Stagger на карточках плана, BarGrow на каждой полосе) —
 * если где-то в приложении JS-поток блокируется настолько, что кадры
 * начинают выпадать, здесь это обнаружится раньше всего.
 *
 * Замерять литеральные «60.000 fps» в headless Chromium внутри
 * контейнера бессмысленно — это не представляет реальное устройство и
 * не то, от чего зависит ощущение продукта. Настоящий сигнал —
 * ОТСУТСТВИЕ длинных пауз между кадрами (jank): один провал длиннее
 * нескольких кадров подряд означает, что что-то в рендере блокирует
 * поток, а не что видеокарта медленная.
 *
 * ИМЯ ФАЙЛА НЕ МЕНЯТЬ (префикс 00-): Playwright идёт по файлам в алфавитном порядке, а
 * замер кадров чувствителен к состоянию общего CI-раннера и сервера. Пока этот тест
 * шёл первым, он проходил в каждом из девяти прогонов CI; когда новые спецификации
 * (доступность и др.) сдвинули его на девятнадцатое место, он упал в двух из четырёх
 * прогонов (100.0 и 133.3 мс при среднем 19 мс). Порог не менялся: причина в порядке,
 * а не в анимации.
 */

test.skip(!canRunLive, skipLiveReason);

const ANIMATION_WINDOW_MS = 2000;
// Стагг-хореография (packages/ui/motion/tokens.ts): шаг 60мс, самая долгая
// анимация — BarGrow на "deliberate" 420мс. Три карточки плана со сдвигом
// друг за другом укладываются в разумный запас внутри окна замера.
const MAX_FRAME_GAP_MS = 100;
const MIN_FRAMES_EXPECTED = 20;

test('экран сравнения консьержа держит кадры без jank во время входной анимации', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const { orderUrl } = await createQuotesReceivedOrder(browser);
  await loginAs(page, 'concierge@demo.qajet.kz');

  // Записывает временные метки каждого кадра с самого первого рендера —
  // addInitScript выполняется до любого скрипта страницы, поэтому ловит
  // входную анимацию с момента появления первого пикселя, а не с
  // произвольной точки после того, как тест успел среагировать.
  await page.addInitScript(() => {
    const frames: number[] = [];
    function tick(t: number) {
      frames.push(t);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    (window as unknown as { __e2eFrames: number[] }).__e2eFrames = frames;
  });

  await page.goto(orderUrl);
  await expect(page.getByRole('button', { name: 'Предложить этот план' }).first()).toBeVisible();
  await page.waitForTimeout(ANIMATION_WINDOW_MS);

  const frames = await page.evaluate(
    () => (window as unknown as { __e2eFrames: number[] }).__e2eFrames,
  );

  expect(
    frames.length,
    `ожидали хотя бы ${MIN_FRAMES_EXPECTED} кадров за ${ANIMATION_WINDOW_MS}мс — получили ${frames.length}, страница почти не рендерилась`,
  ).toBeGreaterThanOrEqual(MIN_FRAMES_EXPECTED);

  const gaps = frames.slice(1).map((t, i) => t - (frames[i] ?? t));
  const maxGap = Math.max(...gaps);
  const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;

  expect(
    maxGap,
    `самый длинный промежуток между кадрами — ${maxGap.toFixed(1)}мс (бюджет ${MAX_FRAME_GAP_MS}мс), средний — ${avgGap.toFixed(1)}мс — где-то в рендере входной анимации блокируется поток дольше нескольких кадров подряд`,
  ).toBeLessThan(MAX_FRAME_GAP_MS);
});
