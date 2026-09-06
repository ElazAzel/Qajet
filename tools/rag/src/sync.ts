import { corpusFingerprint, loadCorpus } from './corpus.js';
import { getMeta, openIndex, rebuildIndex } from './db.js';
import { generateState } from './state.js';

export interface SyncResult {
  docCount: number;
  fingerprint: string;
  changed: boolean;
}

/**
 * Полный цикл `pnpm rag:sync`: сгенерировать docs/state/ из фактического
 * кода репозитория, затем переиндексировать весь корпус (spec + decisions +
 * journal + свежесгенерированный state). Порядок важен: если сначала
 * проиндексировать, а потом сгенерировать state, свежие файлы состояния
 * не попадут в этот прогон индекса.
 */
export async function syncCorpus(): Promise<SyncResult> {
  await generateState();

  const docs = await loadCorpus();
  const fingerprint = corpusFingerprint(docs);

  const db = openIndex();
  try {
    const previous = getMeta(db, 'fingerprint');
    rebuildIndex(db, docs, fingerprint);
    return { docCount: docs.length, fingerprint, changed: previous !== fingerprint };
  } finally {
    db.close();
  }
}
