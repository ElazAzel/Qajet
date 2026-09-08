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
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
  },
});
