import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CorpusDoc } from './corpus.js';
import { INDEX_DB_PATH, INDEX_DIR } from './paths.js';

/**
 * Индекс корпуса — SQLite FTS5 (BM25), через встроенный `node:sqlite`.
 *
 * `node:sqlite` помечен Node как экспериментальный API. Это приемлемо здесь:
 * индекс — инструмент разработки, не часть рантайма продукта (agents.md §2
 * запрещает внешние вызовы и LLM в рантайме основного сценария, но ничего
 * не говорит про инструменты сборки). Он не требует нативной компиляции
 * (в отличие от better-sqlite3), что делает `pnpm i` устойчивее на разных
 * машинах, и это перевесило риск нестабильности experimental-флага для
 * этой конкретной роли.
 *
 * Векторный поиск (sqlite-vec + локальные эмбеддинги) в этой сборке
 * СОЗНАТЕЛЬНО не реализован — см. docs/decisions/0004-rag-fts-first.md.
 * Схема ниже спроектирована так, чтобы добавить его позже без миграции:
 * `documents.id` уже стабильный внешний ключ.
 */

export function openIndex(): DatabaseSync {
  mkdirSync(INDEX_DIR, { recursive: true });
  const db = new DatabaseSync(INDEX_DB_PATH);
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

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

/** Полная перезапись индекса. Корпус мал (сотни секций) — инкрементальность не нужна. */
export function rebuildIndex(db: DatabaseSync, docs: CorpusDoc[], fingerprint: string): void {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM documents');
    const insert = db.prepare(
      'INSERT INTO documents (id, source, title, path, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const doc of docs) {
      insert.run(doc.id, doc.source, doc.title, doc.path, doc.content, doc.updatedAt);
    }
    const setMeta = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    setMeta.run('fingerprint', fingerprint);
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

export function indexPathForLog(): string {
  return path.relative(process.cwd(), INDEX_DB_PATH);
}
