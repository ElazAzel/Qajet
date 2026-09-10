import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgArray, type PgTable } from 'drizzle-orm/pg-core';

/**
 * Сериализация строк Drizzle в текст SQL — общая для `db:dump-sql` и
 * `db:dump-demo-order`. Имена колонок берутся из самой схемы
 * (`getTableColumns`), а не из camelCase→snake_case-конвертера: ровно на
 * самодельном конвертере прошлая версия этого инструмента дала
 * `buyer_score1_to5` вместо настоящего `buyer_score_1_5`, потому что схема
 * переопределяет имя колонки явно.
 */

export function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

export type ColumnKind = 'json' | 'array' | 'scalar';

/**
 * Форму литерала решает тип КОЛОНКИ, а не тип значения: `settings.value` —
 * jsonb, и число 23 в неё нельзя вставить голым `23` («column is of type
 * jsonb but expression is of type integer»), нужно `'23'::jsonb`.
 */
export function literal(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return 'null';
  if (kind === 'json') return `${quote(JSON.stringify(value))}::jsonb`;
  if (kind === 'array') {
    if (!Array.isArray(value)) throw new Error(`ожидался массив, получено ${typeof value}`);
    return `array[${value.map((v) => quote(String(v))).join(', ')}]::text[]`;
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return `${quote(value.toISOString())}::timestamptz`;
  if (typeof value === 'string') return quote(value);
  throw new Error(`не знаю, как записать значение типа ${typeof value} в скалярную колонку`);
}

export function insertStatements(
  table: PgTable,
  rows: readonly Record<string, unknown>[],
  batchSize = 25,
): string[] {
  if (rows.length === 0) return [];
  const columns = getTableColumns(table);
  // Набор колонок объединяется по всем строкам: часть полей необязательна и
  // в отдельных строках отсутствует — вставлять надо единым списком.
  const used = Object.keys(columns).filter((key) => rows.some((r) => r[key] !== undefined));
  const columnNames = used.map((key) => `"${columns[key]?.name}"`).join(', ');
  const kindOf = new Map<string, ColumnKind>(
    used.map((key) => {
      const column = columns[key];
      if (is(column, PgArray)) return [key, 'array'];
      if (column?.columnType === 'PgJsonb' || column?.columnType === 'PgJson') return [key, 'json'];
      return [key, 'scalar'];
    }),
  );

  const out: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const values = rows
      .slice(i, i + batchSize)
      .map((row) => `(${used.map((k) => literal(row[k], kindOf.get(k) ?? 'scalar')).join(', ')})`)
      .join(',\n  ');
    out.push(`insert into "${getTableName(table)}" (${columnNames}) values\n  ${values};`);
  }
  return out;
}
