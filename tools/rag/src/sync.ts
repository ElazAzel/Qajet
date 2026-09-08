import { type CorpusDoc, corpusFingerprint, loadCorpus } from './corpus.js';
import { isIndexUpToDate, openIndex, rebuildIndex } from './db.js';
import { embedBatch } from './embeddings.js';
import { generateState } from './state.js';

export interface SyncResult {
  docCount: number;
  fingerprint: string;
  changed: boolean;
}

/** Текст, который эмбеддится — заголовок задаёт сильный сигнал темы (например «§8D Комбинатор»), контент — детали. */
function embeddingText(doc: CorpusDoc): string {
  return `${doc.title}\n\n${doc.content}`;
}

/**
 * Полный цикл `pnpm rag:sync`: сгенерировать docs/state/ из фактического
 * кода репозитория, затем переиндексировать весь корпус (spec + decisions +
 * journal + свежесгенерированный state). Порядок важен: если сначала
 * проиндексировать, а потом сгенерировать state, свежие файлы состояния
 * не попадут в этот прогон индекса.
 *
 * Эмбеддинги (ADR-0004 «что осталось») пересчитываются, только когда
 * корпус реально изменился ИЛИ версия схемы индекса выросла — модель
 * эмбеддингов не бесплатна по времени (реально измерено — не доли
 * секунды на документ), гонять её на каждый `rag:sync` без надобности
 * значило бы сделать самую частую команду разработки заметно медленнее.
 */
export async function syncCorpus(): Promise<SyncResult> {
  await generateState();

  const docs = await loadCorpus();
  const fingerprint = corpusFingerprint(docs);

  const db = openIndex();
  try {
    const changed = !isIndexUpToDate(db, fingerprint);
    if (changed) {
      const embeddings = await embedBatch(docs.map(embeddingText));
      rebuildIndex(db, docs, embeddings, fingerprint);
    }
    return { docCount: docs.length, fingerprint, changed };
  } finally {
    db.close();
  }
}
