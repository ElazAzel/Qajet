import { openIndex } from './db.js';

export interface SearchHit {
  id: string;
  source: string;
  title: string;
  path: string;
  /** Фрагмент с подсветкой совпадения — `<b>…</b>` вокруг найденных слов. */
  snippet: string;
  rank: number;
}

/**
 * Поиск по корпусу (agents.md, ADR, журнал, сгенерированное состояние).
 * BM25-ранжирование даёт FTS5 сам (`ORDER BY rank`, меньше — релевантнее).
 * `snippet()` возвращает короткий фрагмент вокруг совпадения, а не весь
 * документ — секции agents.md могут быть длинными.
 */
export function searchCorpus(query: string, limit = 8): SearchHit[] {
  const db = openIndex();
  try {
    const rows = db
      .prepare(
        `SELECT
           d.id AS id,
           d.source AS source,
           d.title AS title,
           d.path AS path,
           snippet(documents_fts, 1, '**', '**', '…', 12) AS snippet,
           documents_fts.rank AS rank
         FROM documents_fts
         JOIN documents d ON d.rowid = documents_fts.rowid
         WHERE documents_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(toFtsQuery(query), limit);
    // node:sqlite типизирует значения строки как SQLOutputValue (union по
    // всем возможным типам SQLite) — колонки запроса известны точно, поэтому
    // явно сужаем через unknown, а не полагаемся на структурную совместимость.
    return (rows as unknown as SearchHit[]).map((row) => ({
      id: String(row.id),
      source: String(row.source),
      title: String(row.title),
      path: String(row.path),
      snippet: String(row.snippet),
      rank: Number(row.rank),
    }));
  } finally {
    db.close();
  }
}

/**
 * FTS5 по умолчанию трактует пробел как AND между термами и падает на
 * специальных символах запроса пользователя. Оборачиваем каждое слово в
 * кавычки и склеиваем через OR — вменяемое поведение по умолчанию для
 * человека, который просто печатает вопрос, а не пишет FTS5-синтаксис.
 */
function toFtsQuery(raw: string): string {
  const words = raw
    .split(/\s+/)
    .map((w) => w.replace(/"/g, ''))
    .filter(Boolean);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w}"`).join(' OR ');
}
