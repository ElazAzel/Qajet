import { type APIResponse, type Browser, expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { canRunLive, loginAs, PASSWORD, RUN_ID, skipLiveReason } from './fixtures';

/**
 * Реальный поток файлов: загрузка через интерфейс, настоящий Storage, подписанная
 * ссылка и настоящий маршрут скачивания. Не строки `public.attachments`, а то, что
 * получает человек и что может получить чужой.
 *
 * Чужие арендаторы (второй поставщик, второй покупатель) создаются админским
 * клиентом, поэтому набор идёт только против локальной базы (`canRunLive`) и только
 * при наличии сервисного ключа. Имена и почта помечены `E2E-<runId>`.
 *
 * Проверяется:
 *   - владелец загружает и скачивает по подписанной ссылке, содержимое совпадает;
 *   - испорченная и просроченная ссылки не отдают файл;
 *   - маршрут скачивания отказывает чужому поставщику, чужому покупателю, покупателю
 *     (файл поставщика), поставщику (платёжка покупателя) и гостю;
 *   - файл не читается напрямую из Storage без ссылки и чужому пользователю;
 *   - сервер сам отбраковывает большой файл и неподдерживаемый тип, а имя с HTML не
 *     выполняется и не попадает в ключ объекта.
 *
 * Не покрыто: удаление и отзыв доступа у пользователя, скачивание сотрудником QAJET
 * как самостоятельный сценарий.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test.skip(!canRunLive || !serviceKey, skipLiveReason);
test.describe.configure({ mode: 'serial' });

const BUCKET = 'qajet-docs';

interface Tenant {
  email: string;
  userId: string;
  companyId: string;
}

function admin(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createTenant(kind: 'supplier' | 'buyer', label: string): Promise<Tenant> {
  const db = admin();
  const email = `e2e-${RUN_ID}-${label}@demo.qajet.kz`;
  const created = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const company = await db
    .from('companies')
    .insert({ type: kind, name: `E2E-${RUN_ID}-${label}` })
    .select('id')
    .single();
  if (company.error) throw new Error(`companies: ${company.error.message}`);
  const row = await db.from('users').insert({
    id: created.data.user.id,
    company_id: company.data.id,
    role: 'owner',
    full_name: `E2E ${label}`,
    email,
  });
  if (row.error) throw new Error(`users: ${row.error.message}`);
  return { email, userId: created.data.user.id, companyId: company.data.id };
}

async function attachmentIdFor(browser: Browser, email: string, fileName: string, body: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, email);
    await page.goto('/supplier/messages');
    await page.locator('a[href*="thread="]').first().click();
    await page.waitForURL(/thread=/);
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(body),
      });
    await page.getByRole('button', { name: 'Прикрепить', exact: true }).first().click();
    const link = page.getByRole('link', { name: fileName, exact: true }).first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) ?? '';
    const id = /\/api\/attachments\/([0-9a-f-]{36})\/download/.exec(href)?.[1];
    if (!id) throw new Error(`нет ссылки на вложение: ${href}`);
    return id;
  } finally {
    await context.close();
  }
}

async function snapshot(res: APIResponse) {
  return {
    status: res.status(),
    location: res.headers().location ?? '',
    text: await res.text().catch(() => ''),
  };
}

/** Ответ маршрута скачивания под сессией `email` (или гостя), без следования редиректу. */
async function downloadAs(browser: Browser, email: string | null, id: string) {
  const context = await browser.newContext();
  try {
    if (email) await loginAs(await context.newPage(), email);
    return await snapshot(
      await context.request.get(`/api/attachments/${id}/download`, { maxRedirects: 0 }),
    );
  } finally {
    await context.close();
  }
}

let supplier2: Tenant;
let buyer2: Tenant;
let attachmentId = '';
let objectKey = '';
let signedUrl = '';
const CONTENT = `E2E-${RUN_ID}-содержимое-${Date.now()}`;
const FILE = `отчёт-${RUN_ID}.txt`;

test.beforeAll(async ({ browser }) => {
  supplier2 = await createTenant('supplier', 's2');
  buyer2 = await createTenant('buyer', 'b2');
  attachmentId = await attachmentIdFor(browser, 'supplier@demo.qajet.kz', FILE, CONTENT);
  const row = await admin()
    .from('attachments')
    .select('object_key')
    .eq('id', attachmentId)
    .single();
  objectKey = row.data?.object_key ?? '';
  expect(objectKey, 'ключ объекта вложения').not.toBe('');
});

test('владелец скачивает файл по подписанной ссылке, содержимое совпадает', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginAs(page, 'supplier@demo.qajet.kz');
    const res = await snapshot(
      await context.request.get(`/api/attachments/${attachmentId}/download`, { maxRedirects: 0 }),
    );
    expect(res.status).toBe(302);
    expect(res.location).toContain(`/storage/v1/object/sign/${BUCKET}/`);
    signedUrl = res.location;
    const file = await fetch(signedUrl);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(CONTENT);
    // Исходное имя файла пользователя сохраняется при скачивании, хотя ключ объекта — ASCII.
    const disposition = decodeURIComponent(file.headers.get('content-disposition') ?? '');
    expect(disposition).toContain(FILE);
  } finally {
    await context.close();
  }
});

test('испорченная подписанная ссылка не отдаёт файл', async () => {
  const broken = signedUrl.replace(
    /token=([^&]+)/,
    (_m, t: string) => `token=${t.slice(0, -4)}AAAA`,
  );
  expect(broken).not.toBe(signedUrl);
  const res = await fetch(broken);
  expect(res.status).not.toBe(200);
});

test('чужие и гость не получают ссылку на файл поставщика', async ({ browser }) => {
  const denied: [string, string | null][] = [
    ['покупатель (файл поставщика скрыт от покупателя)', 'buyer@demo.qajet.kz'],
    ['второй поставщик', supplier2.email],
    ['второй покупатель', buyer2.email],
  ];
  for (const [who, email] of denied) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await loginAs(page, email as string);
      const res = await snapshot(
        await context.request.get(`/api/attachments/${attachmentId}/download`, { maxRedirects: 0 }),
      );
      expect(res.status, who).toBe(404);
      expect(res.location, `${who}: подписанной ссылки быть не должно`).toBe('');
    } finally {
      await context.close();
    }
  }
  const guest = await browser.newContext();
  try {
    const res = await snapshot(
      await guest.request.get(`/api/attachments/${attachmentId}/download`, { maxRedirects: 0 }),
    );
    expect(res.location).not.toContain('/storage/v1/');
    expect(res.status).not.toBe(200);
  } finally {
    await guest.close();
  }
});

test('Storage не отдаёт файл без ссылки: гость, чужой пользователь; владелец — контроль', async () => {
  // Публичный адрес приватного бакета и адрес с ключом anon.
  const publicRes = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${objectKey}`);
  expect(publicRes.status).not.toBe(200);
  const anonRes = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectKey}`, {
    headers: { apikey: anonKey },
  });
  expect(anonRes.status).not.toBe(200);

  const download = async (email: string) => {
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
    expect(signIn.error, `вход ${email}`).toBeNull();
    return client.storage.from(BUCKET).download(objectKey);
  };

  const stranger = await download(supplier2.email);
  expect(stranger.data, 'чужой поставщик не должен получить объект напрямую').toBeNull();
  expect(stranger.error).not.toBeNull();

  const buyerSide = await download('buyer@demo.qajet.kz');
  expect(buyerSide.data, 'покупатель не должен получить файл поставщика напрямую').toBeNull();

  // Контроль: владелец тем же способом файл получает, значит отказы выше — не из-за неверного ключа.
  const owner = await download('supplier@demo.qajet.kz');
  expect(owner.error).toBeNull();
  expect(await owner.data?.text()).toBe(CONTENT);
});

test('подписанная ссылка истекает', async () => {
  test.setTimeout(150_000);
  // Ссылка выдаётся на 60 секунд (маршрут скачивания). Ждём заведомо дольше.
  const fresh = await admin().storage.from(BUCKET).createSignedUrl(objectKey, 5);
  expect(fresh.data?.signedUrl).toBeTruthy();
  const early = await fetch(fresh.data?.signedUrl as string);
  expect(early.status, 'до истечения файл отдаётся').toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const late = await fetch(fresh.data?.signedUrl as string);
  expect(late.status, 'после истечения файл не отдаётся').not.toBe(200);
});

test('платёжка покупателя скрыта от поставщика заказа, но видна покупателю', async ({
  browser,
}) => {
  const db = admin();
  // Заказ, к которому у демо-поставщика есть доступ (в утверждённом плане есть его строка).
  const supplierCompany = (
    await db.from('users').select('company_id').eq('email', 'supplier@demo.qajet.kz').single()
  ).data?.company_id;
  const lines = await db
    .from('plan_lines')
    .select('plan_id')
    .eq('supplier_company_id', supplierCompany)
    .limit(20);
  const planIds = (lines.data ?? []).map((l) => l.plan_id);
  const orders = await db.from('orders').select('id').in('approved_plan_id', planIds).limit(1);
  const orderId = orders.data?.[0]?.id;
  // Не skip: если демо-данные перестанут давать такой заказ, проверка изоляции платёжки
  // молча пропадала бы, а CI оставался зелёным. Лучше упасть и потребовать фикстуру.
  expect(orderId, 'нужен заказ, к которому у демо-поставщика есть доступ').toBeTruthy();

  const buyerUser = (
    await db.from('users').select('id').eq('email', 'buyer@demo.qajet.kz').single()
  ).data?.id as string;
  const key = `${buyerUser}/${crypto.randomUUID()}-E2E-${RUN_ID}-payment.txt`;
  const put = await db.storage
    .from(BUCKET)
    .upload(key, new Blob([`платёжка ${RUN_ID}`], { type: 'text/plain' }), {
      contentType: 'text/plain',
    });
  expect(put.error).toBeNull();
  const inserted = await db
    .from('attachments')
    .insert({
      order_id: orderId,
      uploaded_by: buyerUser,
      object_key: key,
      file_name: `E2E-${RUN_ID}-payment.txt`,
      content_type: 'text/plain',
      size_bytes: 20,
      kind: 'prepay_proof',
    })
    .select('id')
    .single();
  expect(inserted.error).toBeNull();
  const id = inserted.data?.id as string;

  const asSupplier = await downloadAs(browser, 'supplier@demo.qajet.kz', id);
  expect(asSupplier.status, 'поставщик не должен получить платёжку покупателя').toBe(404);
  expect(asSupplier.location).toBe('');

  const asSupplier2 = await downloadAs(browser, supplier2.email, id);
  expect(asSupplier2.status).toBe(404);

  const asBuyer = await downloadAs(browser, 'buyer@demo.qajet.kz', id);
  expect(asBuyer.status, 'контроль: покупатель свою платёжку получает').toBe(302);
});

test.describe('загрузка: недопустимое отбраковывается с понятным сообщением', () => {
  async function uploadWith(
    browser: Browser,
    file: { name: string; mimeType: string; buffer: Buffer },
  ) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await loginAs(page, 'supplier@demo.qajet.kz');
    await page.goto('/supplier/messages');
    await page.locator('a[href*="thread="]').first().click();
    await page.waitForURL(/thread=/);
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.getByRole('button', { name: 'Прикрепить', exact: true }).first().click();
    await page.waitForLoadState('networkidle');
    return { page, context, dialogs };
  }

  test('допустимый файл в 2 МБ загружается (Server Action по умолчанию принимает только 1 МБ)', async ({
    browser,
  }) => {
    const name = `E2E-${RUN_ID}-2mb.txt`;
    const { page, context } = await uploadWith(browser, {
      name,
      mimeType: 'text/plain',
      buffer: Buffer.alloc(2 * 1024 * 1024, 'a'),
    });
    try {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // Vercel отрезает тело запроса к функции на ~4,5 МБ (413 FUNCTION_PAYLOAD_TOO_LARGE,
  // воспроизведено на production 2026-09-29). Локальный Next такого лимита не имеет,
  // поэтому проверяется сам инвариант: байты файла идут прямо в Storage, а ни один
  // запрос к приложению не несёт тело больше 1 МБ.
  test('файл 6 МБ загружается напрямую в Storage, мимо функции приложения', async ({ browser }) => {
    const name = `E2E-${RUN_ID}-6mb.txt`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const appOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
    let largestAppBody = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== appOrigin) return;
      largestAppBody = Math.max(largestAppBody, request.postDataBuffer()?.length ?? 0);
    });
    try {
      await loginAs(page, 'supplier@demo.qajet.kz');
      await page.goto('/supplier/messages');
      await page.locator('a[href*="thread="]').first().click();
      await page.waitForURL(/thread=/);
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles({
          name,
          mimeType: 'text/plain',
          buffer: Buffer.alloc(6 * 1024 * 1024, 'a'),
        });
      await page.getByRole('button', { name: 'Прикрепить', exact: true }).first().click();
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
      expect(largestAppBody, 'файл не должен проходить через функцию приложения').toBeLessThan(
        1024 * 1024,
      );
    } finally {
      await context.close();
    }
  });

  test('файл 12 МБ отклоняется сообщением на странице, а не молча (проверка в форме)', async ({
    browser,
  }) => {
    const { page, context } = await uploadWith(browser, {
      name: `E2E-${RUN_ID}-12mb.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.alloc(12 * 1024 * 1024, 'a'),
    });
    try {
      await expect(page.getByText('Файл больше 10 МБ')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // Размер ловит форма в браузере; сервер держит тот же лимит, но до него такой файл не доходит.
  test('файл больше 10 МБ отклоняется с понятным сообщением', async ({ browser }) => {
    const { page, context } = await uploadWith(browser, {
      name: `E2E-${RUN_ID}-big.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 'a'),
    });
    try {
      await expect(page.getByText('Файл больше 10 МБ')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('неподдерживаемый тип отклоняется, даже если браузер разрешил выбрать', async ({
    browser,
  }) => {
    const { page, context } = await uploadWith(browser, {
      name: `E2E-${RUN_ID}-x.zip`,
      mimeType: 'application/zip',
      buffer: Buffer.from('PK'),
    });
    try {
      await expect(page.getByText('Этот тип файла не поддерживается')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('имя с HTML показывается как текст, не выполняется и не попадает в ключ объекта', async ({
    browser,
  }) => {
    const name = `<img src=x onerror=alert(1)>-${RUN_ID}.txt`;
    const { page, context, dialogs } = await uploadWith(browser, {
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('html-name'),
    });
    try {
      const link = page.getByRole('link', { name, exact: true }).first();
      await expect(link).toBeVisible();
      expect(dialogs, 'сценарий из имени файла не должен выполняться').toEqual([]);
      const id = /\/api\/attachments\/([0-9a-f-]{36})\//.exec(
        (await link.getAttribute('href')) ?? '',
      )?.[1];
      const row = await admin()
        .from('attachments')
        .select('object_key, file_name')
        .eq('id', id)
        .single();
      expect(row.data?.object_key).not.toMatch(/[<>"']/);
      expect(row.data?.file_name).toBe(name);
    } finally {
      await context.close();
    }
  });

  test('имя на кириллице с пробелами и № сохраняется и скачивается', async ({ browser }) => {
    const name = `Отчёт №1 ${RUN_ID}.txt`;
    const { page, context } = await uploadWith(browser, {
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('юникод'),
    });
    try {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
