import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tools/rag/src/paths.ts → корень репозитория на три уровня выше.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../..');

export const AGENTS_MD_PATH = path.join(REPO_ROOT, 'agents.md');
export const DECISIONS_DIR = path.join(REPO_ROOT, 'docs/decisions');
export const JOURNAL_DIR = path.join(REPO_ROOT, 'docs/journal');
export const STATE_DIR = path.join(REPO_ROOT, 'docs/state');
export const INDEX_DIR = path.join(REPO_ROOT, 'tools/rag/.index');
export const INDEX_DB_PATH = path.join(INDEX_DIR, 'corpus.sqlite');
export const APPS_DIR = path.join(REPO_ROOT, 'apps');
export const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');
