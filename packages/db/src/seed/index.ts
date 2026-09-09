import { runSeed } from './run.js';

/**
 * `pnpm db:seed` — только вставка (agents.md §13). Если база уже заполнена,
 * нужен `pnpm db:reset`: он сносит демо-данные и зовёт этот же `runSeed()`.
 */
runSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('pnpm db:seed упал:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
