import { type Browser, expect, type Locator, type Page } from '@playwright/test';

/**
 * Общие приёмы для e2e-тестов, которые ведут реальные экраны через живые
 * демо-аккаунты (packages/db/src/seed/accounts.ts, пароль `qajet2026`
 * для всех) вместо прямых вызовов server action/SQL.
 */

export const PASSWORD = 'qajet2026';
export const hasSupabaseEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

/**
 * Живые сценарии создают настоящие заявки и проводят их до closed, а строки
 * финансовых фактов после этого неизменяемы. Поэтому они идут только против
 * одноразовой локальной базы (`supabase start`), а не против любого проекта,
 * на который случайно указывает окружение. Удалённый проект допускается лишь
 * явным `E2E_ALLOW_REMOTE=1` — для выделенного тестового окружения.
 */
export function isLocalSupabase(url = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export const canRunLive =
  hasSupabaseEnv && (isLocalSupabase() || process.env.E2E_ALLOW_REMOTE === '1');
export const skipLiveReason = hasSupabaseEnv
  ? 'NEXT_PUBLIC_SUPABASE_URL указывает не на локальную базу — задайте E2E_ALLOW_REMOTE=1 только для выделенного тестового окружения'
  : 'NEXT_PUBLIC_SUPABASE_URL не задан — нет живой Supabase-сессии для e2e';

/** Идентификатор прогона: все создаваемые записи получают заголовок `E2E-<runId>-<имя теста>`. */
export const RUN_ID = process.env.E2E_RUN_ID ?? Date.now().toString(36);
export const e2eTitle = (testName: string): string => `E2E-${RUN_ID}-${testName}`;

/**
 * Клик по кнопке, вызывающей server action, с ожиданием завершения.
 *
 * Во время выполнения действия кнопка перерисовывается («Перевожу…») и
 * исчезает, поэтому проверка «кнопки больше нет» проходит мгновенно, а
 * следующий `goto()` обрывает действие на полпути: заказ остаётся в прежнем
 * состоянии. Раньше это прикрывал цикл из пяти перезагрузок.
 *
 * Ждать «какой-нибудь POST server action» нельзя: на странице консьержа
 * регулярно уходят heartbeat-запросы учёта времени, тоже server action, и они
 * подойдут под любой такой фильтр. Поэтому после клика ждём сетевой тишины —
 * действие и обновление страницы завершились, — а результат вызывающий код
 * проверяет по видимому состоянию.
 */
export async function press(page: Page, locator: Locator): Promise<void> {
  await locator.click();
  await page.waitForLoadState('networkidle');
}

/**
 * Рассылка RFQ идёт по трём лучшим по оценке поставщикам, а оценка меняется от
 * накопленной нагрузки: демо-поставщик, единственный с входом в систему, иногда
 * выпадал из тройки и не видел запроса — сценарий проходил или падал на одном и
 * том же коммите. Размер рассылки — параметр экономики на экране админа
 * (agents.md §9), им и пользуется тест: рассылка идёт всем подходящим.
 */
export async function setSetting(browser: Browser, label: string, value: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, 'admin@demo.qajet.kz');
    await page.goto('/admin/settings');
    const input = page.getByLabel(label);
    // Кнопка «Применить» активна только при изменении: если значение уже стоит, менять нечего.
    if ((await input.inputValue()) === value) return;
    await input.fill(value);
    const row = input.locator('xpath=ancestor::li[1]');
    await press(page, row.getByRole('button', { name: 'Применить' }));
    await page.reload();
    await expect(page.getByLabel(label)).toHaveValue(value);
  } finally {
    await context.close();
  }
}

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
 * Открывает страницу и ждёт конкретную кнопку — без перезагрузок и пауз.
 * Раньше здесь был цикл до пяти `goto()` с `waitForTimeout(1500)` и
 * проглоченной ошибкой: он прятал причину, а не искал её. Postgres читает в
 * READ COMMITTED, поэтому запись другой роли видна следующему запросу сразу;
 * если кнопка не появилась, это настоящий дефект экрана, и тест должен
 * упасть с понятным сообщением, а не пройти со второй попытки.
 */
export async function gotoUntilButtonVisible(page: Page, url: string, label: string) {
  await page.goto(url);
  const locator = page.getByRole('button', { name: label }).first();
  await expect(locator, `кнопка «${label}» на ${url}`).toBeVisible();
  return locator;
}

export async function advanceStage(page: Page, orderUrl: string, label: string): Promise<void> {
  const button = await gotoUntilButtonVisible(page, orderUrl, label);
  await press(page, button);
  // Результат — новое состояние на странице, а не исчезновение кнопки.
  const state = label.replace('→ ', '');
  await expect(page.getByText(state, { exact: true }).first()).toBeVisible();
}

/**
 * Доводит новый заказ живым UI-путём до `quotes_received` — общая для
 * order-lifecycle.spec.ts (продолжает до closed) и 00-animation-budget.spec.ts
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
    /** Имя теста для заголовка `E2E-<runId>-<имя>`. */
    name?: string;
  } = {},
): Promise<{ orderUrl: string; orderId: string; requestId: string; title: string }> {
  const title = e2eTitle(options.name ?? 'fixture');
  await setSetting(browser, 'Поставщиков в рассылке RFQ', '20');

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
    // Форма начинается без позиций: добавляем одну из каталога явно.
    await buyer.getByRole('button', { name: 'Добавить позицию из каталога' }).click();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 30);
    await buyer.locator('#request-date').fill(deadline.toISOString().slice(0, 10));
    await buyer.getByRole('button', { name: 'Отправить заявку' }).click();
    // Покупатель сразу попадает на страницу своей закупки.
    await buyer.waitForURL(/\/buyer\/requests\/[0-9a-f-]{36}$/);
    const requestId = buyer.url().split('/').pop() as string;
    await expect(buyer.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(buyer.getByText('Получено', { exact: true })).toBeVisible();

    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await concierge.goto('/concierge');
    await rowContaining(concierge, title).getByRole('button', { name: 'Взять в работу' }).click();
    await concierge.waitForURL(/\/concierge\/orders\//);
    const orderUrl = concierge.url();
    const orderId = orderUrl.split('/').filter(Boolean).pop() as string;

    // Каждый шаг ждёт СЛЕДУЮЩЕЕ действие этого заказа, а не «исчезновения кнопки»:
    // пока server action выполняется, кнопка тоже исчезает, и уход со страницы в этот
    // момент обрывает действие (на холодном сервере CI RFQ так и не рассылался).
    await press(concierge, concierge.getByRole('button', { name: '→ Оценён' }));
    const invoice = concierge.getByRole('button', { name: 'Выставить счёт на P80' });
    await expect(invoice).toBeVisible();

    // Оценка создаёт только счёт на P80. Факт банковского перевода
    // подтверждается отдельным staff-действием; тест заполняет все поля
    // формы, чтобы не обходить completeness/RLS-путь.
    await press(concierge, invoice);
    await concierge
      .getByLabel('Фактически поступило, ₸')
      .locator('visible=true')
      .fill(String(options.prepaymentAmountKzt ?? 2_000_000_000));
    await concierge
      .getByLabel('Банковский reference')
      .locator('visible=true')
      .fill(`E2E-PRE-${Date.now()}`);
    await press(
      concierge,
      concierge.getByRole('button', { name: 'Подтвердить перевод и продолжить' }),
    );
    const sendRfq = concierge.getByRole('button', { name: '→ RFQ отправлен' });
    await expect(sendRfq).toBeVisible();
    await press(concierge, sendRfq);
    // Рассылка завершена, когда у ЭТОГО заказа появилось следующее действие.
    await expect(concierge.getByRole('button', { name: '→ КП получены' })).toBeVisible();

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
    // Без подтверждённой возможности исполнения КП не попадает в сравнение:
    // §7.2 — данные КП не додумываются, отбраковка идёт до сравнения цен.
    await supplier
      .getByRole('checkbox', {
        name: 'Подтверждаю, что могу исполнить эту позицию и указанные условия.',
      })
      .first()
      .check();
    await supplier.getByRole('button', { name: 'Отправить КП' }).click();
    await supplier.waitForURL('**/supplier?sent=*');

    await advanceStage(concierge, orderUrl, '→ КП получены');

    return { orderUrl, orderId, requestId, title };
  } finally {
    await buyerCtx.close();
    await conciergeCtx.close();
    await supplierCtx.close();
  }
}

/**
 * Доводит новую закупку до рассылки RFQ и останавливается: ответ поставщика —
 * дело вызывающего теста. Каждый шаг ждёт СВОЕГО следующего действия на той же
 * странице, а не «исчезновения кнопки»: пока server action выполняется, кнопка
 * тоже исчезает, и уход со страницы в этот момент обрывает действие (заказ
 * остаётся `prepaid` без RFQ).
 */
export async function createRfqSentOrder(
  browser: Browser,
  options: { name?: string } = {},
): Promise<{ orderUrl: string; orderId: string; requestId: string; title: string }> {
  const title = e2eTitle(options.name ?? 'rfq-sent');
  await setSetting(browser, 'Поставщиков в рассылке RFQ', '20');

  const buyerCtx = await browser.newContext();
  const conciergeCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  const concierge = await conciergeCtx.newPage();
  try {
    await loginAs(buyer, 'buyer@demo.qajet.kz');
    await buyer.goto('/buyer/requests/new');
    await buyer.locator('#request-title').fill(title);
    await buyer.getByRole('button', { name: 'Добавить позицию из каталога' }).click();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 30);
    await buyer.locator('#request-date').fill(deadline.toISOString().slice(0, 10));
    await buyer.getByRole('button', { name: 'Отправить заявку' }).click();
    await buyer.waitForURL(/\/buyer\/requests\/[0-9a-f-]{36}$/);
    const requestId = buyer.url().split('/').pop() as string;

    await loginAs(concierge, 'concierge@demo.qajet.kz');
    await concierge.goto('/concierge');
    await rowContaining(concierge, title).getByRole('button', { name: 'Взять в работу' }).click();
    await concierge.waitForURL(/\/concierge\/orders\//);
    const orderUrl = concierge.url();
    const orderId = orderUrl.split('/').filter(Boolean).pop() as string;

    await press(concierge, concierge.getByRole('button', { name: '→ Оценён' }));
    const invoice = concierge.getByRole('button', { name: 'Выставить счёт на P80' });
    await expect(invoice).toBeVisible();
    await press(concierge, invoice);
    await concierge
      .getByLabel('Фактически поступило, ₸')
      .locator('visible=true')
      .fill('2000000000');
    await concierge
      .getByLabel('Банковский reference')
      .locator('visible=true')
      .fill(`E2E-PRE-${Date.now()}`);
    await press(
      concierge,
      concierge.getByRole('button', { name: 'Подтвердить перевод и продолжить' }),
    );
    const sendRfq = concierge.getByRole('button', { name: '→ RFQ отправлен' });
    await expect(sendRfq).toBeVisible();
    await press(concierge, sendRfq);
    // Следующее действие ЭТОГО заказа: текст «RFQ отправлен» есть и в чужих строках доски.
    await expect(concierge.getByRole('button', { name: '→ КП получены' })).toBeVisible();
    return { orderUrl, orderId, requestId, title };
  } finally {
    await buyerCtx.close();
    await conciergeCtx.close();
  }
}
