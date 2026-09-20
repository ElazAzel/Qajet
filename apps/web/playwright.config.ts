import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Next.js сам грузит `.env.local` для процесса `next dev`/`next start`
 * (webServer ниже), но сам процесс `playwright test` — обычный node-скрипт,
 * `.env.local` для него не существует. Без него `NEXT_PUBLIC_SUPABASE_URL`
 * не виден на верхнем уровне этого файла, и логика скип-условия в спеке
 * решила бы, что живой Supabase-сессии нет, даже когда она есть.
 */
for (const line of existsSync('.env.local') ? readFileSync('.env.local', 'utf8').split('\n') : []) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const [, key, value] = match;
  if (key && value !== undefined && !(key in process.env)) process.env[key] = value;
}

/**
 * Сквозной сценарий — agents.md фаза 7 чек-лист: «pnpm e2e — сквозной
 * сценарий от заявки до closed, в двух вариантах: с возвратом и с
 * доплатой». Требует живую Supabase-сессию (те же demo-аккаунты, что и
 * ручная проверка в предыдущих сессиях) — без `NEXT_PUBLIC_SUPABASE_URL`
 * тесты сами себя пропускают (см. e2e/order-lifecycle.spec.ts), тем же
 * приёмом, что и `packages/db/src/__tests__/supplier-isolation.test.ts`
 * пропускается без `DATABASE_URL`.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` — необязательный оверрайд пути к бинарю
 * Chromium для песочниц, где браузеры уже лежат на диске в нестандартном
 * месте и `playwright install` недоступен/не нужен. В обычной установке
 * не задан — Playwright использует управляемый им бинарь.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  // Один воркер: бюджет кадров на экране сравнения меряет реальную отрисовку, и
  // параллельный тяжёлый сценарий на той же машине давал ложные 116 мс против 100.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Без предела одно незакликиваемое действие (элемент есть в DOM, но не
    // проходит проверку actionability — например под ещё идущей motion-
    // анимацией входа) молча съедает весь бюджет теста вместо того, чтобы
    // упасть с понятной причиной за разумное время.
    actionTimeout: 20_000,
    // Песочница разработки маршрутизирует весь исходящий HTTPS через
    // локальный прокси (см. /root/.ccr/README.md) — сам Chromium не читает
    // HTTPS_PROXY из окружения (это делают только Node-инструменты), без
    // явной передачи браузер пытается открыть сокет напрямую и не достаёт
    // до Supabase. За пределами этой песочницы HTTPS_PROXY обычно не задан
    // — тогда это поле просто undefined и Playwright запускает браузер как
    // обычно, без прокси.
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }
      : undefined,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // `pnpm start` (production-режим Next), не `pnpm dev`: живой прогон трёх
  // параллельных ролей (покупатель/консьерж/поставщик) под `next dev`
  // ловил недетерминированный сбой — HMR/webpack-рекомпиляция при заходе
  // одной роли на ещё не скомпилированный маршрут может прервать ВЫПОЛНЯЮЩИЙСЯ
  // server action другой роли: auth-логи Supabase подтверждали, что вход
  // прошёл успешно на сервере, а клиент получал назад 200 без редиректа —
  // страница входа перерисовывалась как есть. В production-сборке маршруты
  // уже скомпилированы, класс сбоя не воспроизводится. Ровно поэтому
  // `turbo.json` уже объявляет e2e как `dependsOn: ["build"]`.
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          // Standalone-сервер не несёт `.next/static`/`public` (Next их туда
          // не копирует; это явный шаг — Vercel делает его в своём билдере,
          // локально нужно выполнить копирование), без копии сервер
          // поднимется, но отдаст 404 на все ассеты и chunk'и.
          command:
            'node scripts/prepare-standalone.mjs && ' +
            `node ${process.env.NEXT_DIST_DIR || '.next'}/standalone/apps/web/server.js`,
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
