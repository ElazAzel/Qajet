/**
 * Подключает версионированные git-хуки из каталога .githooks.
 *
 * Запускается из `prepare`, то есть при каждом `pnpm install`. Поэтому он
 * обязан молча ничего не делать там, где хуки не нужны или невозможны: в CI, в
 * сборке Vercel и в любой копии без .git. Простой `git config` в `prepare`
 * упал бы в такой среде, и вместе с `pnpm install` упала бы выкладка.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || process.env.VERCEL || !existsSync('.git')) process.exit(0);

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // Хуки — удобство разработчика, а не условие установки: без них всё работает.
}
