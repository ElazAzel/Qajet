/** Keep each request below the configured PostgREST max_rows=1000.
 * Callers must order by a unique stable key and preserve their RLS filters.
 * Never expose partial financial totals when a page cannot be read.
 */
export async function readAllPages<T extends { id: string }>(
  fetchPage: (
    after: string | undefined,
    limit: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  let after: string | undefined;
  for (;;) {
    const { data, error } = await fetchPage(after, pageSize);
    if (error || !data) throw new Error('Не удалось загрузить данные аналитики');
    rows.push(...data);
    if (data.length < pageSize) return rows;
    const lastId = data.at(-1)?.id;
    if (!lastId || (after && lastId <= after)) {
      throw new Error('Не удалось загрузить данные аналитики');
    }
    after = lastId;
  }
}
