import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * apps/web несёт два независимых набора тестов: Playwright e2e (`e2e/`,
 * свой раннер — `pnpm e2e`, `playwright.config.ts`) и обычные юниты
 * Vitest рядом с кодом (`app/lib/*.test.ts`). Без явного `exclude`
 * Vitest по умолчанию подхватывает и `e2e/*.spec.ts` тоже — те
 * используют объект `test` из `@playwright/test`, не из Vitest, и
 * падают с "test.skip() can only be called inside test, describe block
 * or fixture".
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Пакет server-only бросает при импорте вне Server Component; в юнит-тестах он не нужен.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
  },
});
