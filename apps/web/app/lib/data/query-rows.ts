import { readAllPages } from './read-all-pages';

interface PageQuery<T> extends PromiseLike<{ data: T[] | null; error: unknown }> {
  order(column: string): PageQuery<T>;
  limit(count: number): PageQuery<T>;
  gt(column: string, value: string): PageQuery<T>;
}

/** Rebuild each page from the same user-scoped query; never use an admin client. */
export function readQueryRows<T extends { id: string }>(
  query: () => PageQuery<T>,
  idColumn = 'id',
): Promise<T[]> {
  return readAllPages((after, limit) => {
    const page = query().order(idColumn).limit(limit);
    return after ? page.gt(idColumn, after) : page;
  });
}

export async function checkedQuery<T extends { error: unknown }>(
  query: PromiseLike<T>,
): Promise<T> {
  const result = await query;
  if (result.error) throw new Error('Не удалось загрузить данные');
  return result;
}

/** Bound PostgREST URL size as well as response size. Every batch keeps RLS. */
export async function readInBatches<T>(
  ids: string[],
  fetch: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let start = 0; start < unique.length; start += 100) {
    rows.push(...(await fetch(unique.slice(start, start + 100))));
  }
  return rows;
}
