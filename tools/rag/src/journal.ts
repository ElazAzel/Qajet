import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JOURNAL_DIR } from './paths.js';

/** Запись в журнал сессии за сегодня. Один файл на день, записи копятся. */
export async function appendJournalEntry(message: string): Promise<string> {
  await mkdir(JOURNAL_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(JOURNAL_DIR, `${date}.md`);
  const time = new Date().toISOString().slice(11, 16);

  if (!existsSync(filePath)) {
    await writeFile(filePath, `# Журнал ${date}\n\n`, 'utf8');
  }
  await appendFile(filePath, `- **${time}** ${message}\n`, 'utf8');
  return filePath;
}
