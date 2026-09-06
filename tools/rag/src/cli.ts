#!/usr/bin/env node
import { corpusFingerprint, loadCorpus } from './corpus.js';
import { getMeta, openIndex } from './db.js';
import { appendJournalEntry } from './journal.js';
import { searchCorpus } from './search.js';
import { syncCorpus } from './sync.js';

const [, , command, ...rest] = process.argv;

async function main() {
  switch (command) {
    case 'sync': {
      const result = await syncCorpus();
      console.log(
        `Индекс пересобран: ${result.docCount} документов, ` +
          `отпечаток ${result.fingerprint.slice(0, 12)}` +
          (result.changed ? ' (корпус изменился)' : ' (без изменений)'),
      );
      break;
    }

    case 'search': {
      const query = rest.join(' ').trim();
      if (!query) {
        console.error('Использование: pnpm rag:search <запрос>');
        process.exitCode = 1;
        return;
      }
      const hits = searchCorpus(query);
      if (hits.length === 0) {
        console.log('Ничего не найдено. Возможно, индекс не собран: pnpm rag:sync');
        return;
      }
      for (const hit of hits) {
        console.log(`[${hit.source}] ${hit.title}  (${hit.path})`);
        console.log(`  ${hit.snippet.replace(/\n+/g, ' ').slice(0, 220)}`);
      }
      break;
    }

    case 'check': {
      const docs = await loadCorpus();
      const currentFingerprint = corpusFingerprint(docs);
      const db = openIndex();
      const indexedFingerprint = getMeta(db, 'fingerprint');
      db.close();

      if (indexedFingerprint === currentFingerprint) {
        console.log('Индекс актуален.');
      } else {
        console.error('Индекс RAG отстал от кода. Запустите `pnpm rag:sync` перед коммитом.');
        process.exitCode = 1;
      }
      break;
    }

    case 'log': {
      const message = rest.join(' ').trim();
      if (!message) {
        console.error('Использование: pnpm rag:log <текст записи>');
        process.exitCode = 1;
        return;
      }
      const filePath = await appendJournalEntry(message);
      console.log(`Записано в ${filePath}`);
      break;
    }

    default: {
      console.error('Неизвестная команда. Доступно: sync | search <запрос> | check | log <текст>');
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
