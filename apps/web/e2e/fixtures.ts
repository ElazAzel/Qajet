import { type Browser, expect, type Page } from '@playwright/test';

/**
 * Общие приёмы для e2e-тестов, которые ведут реальные экраны через живые
 * демо-аккаунты (packages/db/src/seed/accounts.ts, пароль `qajet2026`
 * для всех) вместо прямых вызовов server action/SQL.
 */

export const PASSWORD = 'qajet2026';
export const hasSupabaseEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/(buyer|supplier|concierge|admin)(\/|$)/);
}

/**
 * Строка списка/карточки, содержащая заданный текст — обёртка над XPath
 * ancestor::, чтобы не привязываться к конкретным классам разметки.
 * Название и кнопка/ссылка действия в разметке — не соседи (заголовок
 * лежит во вложенном `<div className="min-w-0">`), поэтому берём не
 * ближайшего предка вообще, а ближайшего предка, который уже содержит
 * button/ссылку — иначе `ancestor::div[1]` попадает во внутренний div
 * без действия и повисает в ожидании несуществующей кнопки внутри него.
 */
export function rowContaining(page: Page, text: string, tag: 'div' | 'li' = 'div') {
  return page
    .getByText(text, { exact: true })
    .locator(`xpath=ancestor::${tag}[.//button or .//a][1]`);
}

/**
 * Каждый шаг сценария читает состояние, которое чаще всего только что
 * записала ДРУГАЯ роль — отдельный browser context, отдельная RLS-сессия,
 * отдельный TCP-раунд-трип до Supabase (покупатель видит план, только что
 * предложенный консьержом; консьерж — КП, только что отправленное
 * поставщиком). В редких прогонах первый `goto()` после чужой записи
 * успевает раньше, чем это стало видно с текущей сессией — несколько
 * перезагрузок с паузой здесь ждут ровно то же самое, что и обычная
 * практика «читать после записи» с любой внешней БД, а не подгонка под
 * конкретный частный сбой на конкретной кнопке.
 */
export async function gotoUntilButtonVisible(page: Page, url: string, label: string, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    await page.goto(url);
    const locator = page.getByRole('button', { name: label }).first();
    if (await locator.isVisible().catch(() => false)) return locator;
    await page.waitForTimeout(1500);
  }
  throw new Error(`Кнопка «${label}» не появилась на ${url} после ${attempts} перезагрузок`);
}

export async function advanceStage(page: Page, orderUrl: string, label: string): Promise<void> {
  const button = await gotoUntilButtonVisible(page, orderUrl, label);
  await button.click();
  await expect(page.getByRole('button', { name: label })).toHaveCount(0);
}

/**
 * Доводит новый заказ живым UI-путём до `quotes_received` — общая для
 * order-lifecycle.spec.ts (продолжает до closed) и animation-budget.spec.ts
 * (которому для экрана сравнения нужна только эта стадия). Каждый вызов
 * создаёт настоящую заявку в реальной БД под уникальным заголовком
 * (`E2E fixture <ts>`) — не удаляется автоматически, см. предупреждение
 * в order-lifecycle.spec.ts.
 */
export async function createQuotesReceivedOrder(
  browser: Browser,
  options: {
    prepaymentAmountKzt?: number;
    quotePriceKzt?: number;
    setupFeeKzt?: number;
    minQty?: number;
  } = {},
): Promise<{ orderUrl: string; orderId: string; title: string }> {
  const title = `E2E fixture ${Date.now()}`;

  const buyerCtx = await browser.newContext();
  const conciergeCtx = await browser.newContext();
  const supplierCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  const concierge = await conciergeCtx.newPage();
  const supplier = await supplierCtx.newPage();

  try {
    await loginAs(buyer, 'buyer@demo.qajet.kz');
    await buyer.goto('/buyer/requests/new');
    await buyer.locator('#request-title').fill(title);
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 30);
    await buyer.locator('#request-date').fill(deadline.toISOString().slice(0, 10));
    await buyer.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(buyer.getByText('Заявка отправлена')).toBeVisible();

    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await concierge.goto('/concierge');
    await rowContaining(concierge, title).getByRole('button', { name: 'Взять в работу' }).click();
    await concierge.waitForURL(/\/concierge\/orders\//);
    const orderUrl = concierge.url();
    const orderId = orderUrl.split('/').filter(Boolean).pop() as string;

    await concierge.getByRole('button', { name: '→ Оценён' }).click();
    await expect(concierge.getByRole('button', { name: '→ Оценён' })).toHaveCount(0);

    // Оценка создаёт только счёт на P80. Факт банковского перевода
    // подтверждается отдельным staff-действием; тест заполняет все поля
    // формы, чтобы не обходить completeness/RLS-путь.
    await concierge.getByRole('button', { name: 'Выставить счёт на P80' }).click();
    await concierge
      .getByLabel('Фактически поступило, ₸')
      .fill(String(options.prepaymentAmountKzt ?? 2_000_000_000));
    await concierge.getByLabel('Банковский reference').fill(`E2E-PRE-${Date.now()}`);
    await concierge.getByRole('button', { name: 'Подтвердить перевод и продолжить' }).click();
    await expect(
      concierge.getByRole('button', { name: 'Подтвердить перевод и продолжить' }),
    ).toHaveCount(0);
    await concierge.getByRole('button', { name: '→ RFQ отправлен' }).click();
    await expect(concierge.getByRole('button', { name: '→ RFQ отправлен' })).toHaveCount(0);

    await loginAs(supplier, 'supplier@demo.qajet.kz');
    await supplier.goto('/supplier');
    await rowContaining(supplier, title, 'li')
      .getByRole('link', { name: 'Берусь, цена и срок' })
      .click();
    await supplier.waitForURL(/\/supplier\/rfq\//);
    await supplier
      .getByLabel('Цена за ед., ₸')
      .first()
      .fill(String(options.quotePriceKzt ?? 4500));
    await supplier.getByLabel('Срок, дней').first().fill('10');
    await supplier
      .getByLabel('Setup fee, ₸')
      .first()
      .fill(String(options.setupFeeKzt ?? 0));
    await supplier
      .getByLabel('Мин. партия, шт.')
      .first()
      .fill(String(options.minQty ?? 1));
    await supplier.getByRole('button', { name: 'Отправить КП' }).click();
    await supplier.waitForURL('**/supplier');

    await advanceStage(concierge, orderUrl, '→ КП получены');

    return { orderUrl, orderId, title };
  } finally {
    await buyerCtx.close();
    await conciergeCtx.close();
    await supplierCtx.close();
  }
}
