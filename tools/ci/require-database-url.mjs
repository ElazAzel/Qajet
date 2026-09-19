/**
 * Тесты с реальным PostgreSQL (`test:rls`) не имеют права «проходить» без базы.
 *
 * Раньше они начинались с `describe.skip`, когда `DATABASE_URL` не задан, а
 * Vitest завершался с кодом 0: 42 теста изоляции арендаторов и защиты записи
 * молча превращались в ноль проверок, и это выглядело как успех. Даже при
 * заданной переменной корневой `pnpm test` их пропускал — Turborepo не
 * пробрасывает её в задачи. Этот скрипт делает отсутствие базы явной ошибкой.
 */
if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    [
      'test:rls: DATABASE_URL не задан — тесты с реальным PostgreSQL не запускались.',
      'Поднимите локальную базу (`supabase start`, затем `pnpm --filter @qajet/db db:migrate`)',
      'и задайте DATABASE_URL, например postgresql://postgres:postgres@127.0.0.1:54322/postgres.',
      'Не указывайте боевую базу.',
    ].join('\n'),
  );
  process.exit(1);
}

try {
  const { hostname } = new URL(process.env.DATABASE_URL);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  if (!local && process.env.RLS_ALLOW_REMOTE !== '1') {
    console.error(
      `test:rls: DATABASE_URL указывает на ${hostname}, а не на локальную базу. ` +
        'Тесты создают и откатывают фикстуры; на общей или боевой базе их запускать нельзя. ' +
        'Для выделенного тестового окружения задайте RLS_ALLOW_REMOTE=1.',
    );
    process.exit(1);
  }
} catch {
  console.error('test:rls: DATABASE_URL не является корректным URL.');
  process.exit(1);
}
