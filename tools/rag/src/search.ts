import { openIndex } from './db.js';
import { embedText } from './embeddings.js';

export interface SearchHit {
  id: string;
  source: string;
  title: string;
  path: string;
  /** Фрагмент с подсветкой совпадения — `<b>…</b>` вокруг найденных слов, если найден полнотекстовым поиском; иначе начало документа. */
  snippet: string;
  rank: number;
}

const FTS_POOL_SIZE_MULTIPLIER = 4;
const VEC_POOL_SIZE_MULTIPLIER = 4;
/** Стандартная константа Reciprocal Rank Fusion — сглаживает вклад позиции в топе, не даёт первому месту задавить остальное слияние. */
const RRF_K = 60;

interface RawRow {
  id: string;
  source: string;
  title: string;
  path: string;
  content: string;
}

/**
 * Гибридный поиск по корпусу (agents.md, ADR, журнал, сгенерированное
 * состояние) — BM25 (FTS5, точные термы) слит с векторным KNN
 * (`sqlite-vec`, семантическая близость на перефразированных запросах,
 * ADR-0004 «что осталось») через Reciprocal Rank Fusion: каждый источник
 * даёт ранжированный список, документ получает `1/(RRF_K + позиция)` от
 * каждого списка, где встретился, — простой и устойчивый способ слить
 * два принципиально разных скора (BM25-ранг и косинусное расстояние) без
 * подбора весов вручную.
 */
export async function searchCorpus(query: string, limit = 8): Promise<SearchHit[]> {
  const db = openIndex();
  try {
    const poolSize = limit * FTS_POOL_SIZE_MULTIPLIER;

    const ftsRows = db
      .prepare(
        `SELECT
           d.id AS id,
           d.source AS source,
           d.title AS title,
           d.path AS path,
           snippet(documents_fts, 1, '**', '**', '…', 12) AS snippet
         FROM documents_fts
         JOIN documents d ON d.rowid = documents_fts.rowid
         WHERE documents_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(toFtsQuery(query), poolSize) as unknown as (RawRow & { snippet: string })[];

    const queryEmbedding = await embedText(query);
    const vecPoolSize = limit * VEC_POOL_SIZE_MULTIPLIER;
    const vecRows = db
      .prepare(
        `SELECT
           d.id AS id,
           d.source AS source,
           d.title AS title,
           d.path AS path,
           d.content AS content
         FROM documents_vec
         JOIN documents d ON d.rowid = documents_vec.rowid
         WHERE documents_vec.embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(
        Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength),
        vecPoolSize,
      ) as unknown as RawRow[];

    const scoreById = new Map<string, number>();
    const hitById = new Map<string, SearchHit>();

    ftsRows.forEach((row, i) => {
      scoreById.set(row.id, (scoreById.get(row.id) ?? 0) + 1 / (RRF_K + i + 1));
      if (!hitById.has(row.id)) {
        hitById.set(row.id, {
          id: String(row.id),
          source: String(row.source),
          title: String(row.title),
          path: String(row.path),
          snippet: String(row.snippet),
          rank: i,
        });
      }
    });

    vecRows.forEach((row, i) => {
      scoreById.set(row.id, (scoreById.get(row.id) ?? 0) + 1 / (RRF_K + i + 1));
      if (!hitById.has(row.id)) {
        hitById.set(row.id, {
          id: String(row.id),
          source: String(row.source),
          title: String(row.title),
          path: String(row.path),
          snippet: `${String(row.content).slice(0, 200).trim()}…`,
          rank: i,
        });
      }
    });

    return [...scoreById.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id], mergedRank) => {
        const hit = hitById.get(id);
        if (!hit) throw new Error(`hitById не содержит ${id} — это разошлось с scoreById`);
        return { ...hit, rank: mergedRank };
      });
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
