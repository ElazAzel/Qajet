import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import type { CorpusDoc } from './corpus.js';
import { INDEX_DB_PATH, INDEX_DIR } from './paths.js';

/**
 * Индекс корпуса — гибрид FTS5 (BM25) + `sqlite-vec` (векторный KNN),
 * оба через встроенный `node:sqlite`. Векторный слой — ADR-0004, «что
 * осталось»: реализован в этой сессии, проверено, что `sqlite-vec`
 * реально грузится как загружаемое расширение через `db.allowExtension`
 * (та неопределённость, из-за которой векторный слой откладывался).
 *
 * `node:sqlite` помечен Node как экспериментальный API. Это приемлемо здесь:
 * индекс — инструмент разработки, не часть рантайма продукта (agents.md §2
 * запрещает внешние вызовы и LLM в рантайме основного сценария, но ничего
 * не говорит про инструменты сборки).
 *
 * Честная деталь реализации: `node:sqlite`'s параметр-биндинг не работает
 * с `vec0`-таблицами, когда в одном вызове `.run()` смешаны INTEGER-rowid
 * и BLOB (падает с «Only integers are allows for primary key values» —
 * проверено эмпирически в этой сессии). Обход — rowid всегда наш
 * собственный внутренний счётчик (никогда не пользовательский ввод),
 * поэтому он инлайнится в текст SQL как проверенное целое число, а BLOB
 * остаётся единственным биндингом.
 */

const SCHEMA_VERSION = '2'; // v2 — добавлен документный vec0-индекс (D.3)

export function openIndex(): DatabaseSync {
  mkdirSync(INDEX_DIR, { recursive: true });
  const db = new DatabaseSync(INDEX_DB_PATH, { allowExtension: true });
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title,
      content,
      content='documents',
      content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
      INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
      embedding float[384]
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

/**
 * Полная перезапись индекса, включая эмбеддинги. Корпус мал (сотни
 * секций) — инкрементальность не нужна, а `documents`/`documents_vec`
 * обязаны использовать один и тот же rowid для одного документа (так их
 * можно JOIN'ить в search.ts), поэтому rowid здесь — явный индекс
 * массива (1-based), а не то, что молча назначит SQLite.
 */
export function rebuildIndex(
  db: DatabaseSync,
  docs: CorpusDoc[],
  embeddings: readonly Float32Array[],
  fingerprint: string,
): void {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM documents');
    db.exec('DELETE FROM documents_vec');
    const insertDoc = db.prepare(
      'INSERT INTO documents (rowid, id, source, title, path, content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    docs.forEach((doc, i) => {
      const rowid = i + 1;
      insertDoc.run(rowid, doc.id, doc.source, doc.title, doc.path, doc.content, doc.updatedAt);

      const vec = embeddings[i];
      if (!vec) return;
      if (!Number.isInteger(rowid) || rowid <= 0) {
        throw new Error(`Ожидался положительный целый rowid, получено ${rowid}`);
      }
      // rowid инлайнится намеренно — см. комментарий в начале файла.
      const insertVec = db.prepare(
        `INSERT INTO documents_vec (rowid, embedding) VALUES (${rowid}, ?)`,
      );
      insertVec.run(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
    });
    const setMeta = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    setMeta.run('fingerprint', fingerprint);
    setMeta.run('schema_version', SCHEMA_VERSION);
    setMeta.run('synced_at', new Date().toISOString());
    setMeta.run('doc_count', String(docs.length));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** true, если индекс уже собран этой ровно версией схемы на этом отпечатке корпуса — иначе нужен rebuildIndex(). */
export function isIndexUpToDate(db: DatabaseSync, fingerprint: string): boolean {
  return (
    getMeta(db, 'fingerprint') === fingerprint && getMeta(db, 'schema_version') === SCHEMA_VERSION
  );
}

export function indexPathForLog(): string {
  return path.relative(process.cwd(), INDEX_DB_PATH);
}
