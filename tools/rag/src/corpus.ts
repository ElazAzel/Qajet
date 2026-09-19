import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AGENTS_MD_PATH, DECISIONS_DIR, JOURNAL_DIR, STATE_DIR } from './paths.js';

/**
 * Один документ индекса. `source` определяет, как документ был получен —
 * это то, что показывается в результатах поиска, чтобы «нашлось в §8D
 * полной спеки и «нашлось в ADR-0003» читались по-разному.
 */
export interface CorpusDoc {
  id: string;
  source: 'spec' | 'decision' | 'journal' | 'state';
  title: string;
  /** Путь относительно корня репозитория — для перехода из результата поиска. */
  path: string;
  content: string;
  updatedAt: string;
}

/**
 * Нарезка полной спеки по заголовкам ## и ###. Верхнеуровневые заголовки #
 * не режут корпус отдельно — это заголовок всего документа, а не раздел.
 * Каждая секция включает вложенный текст до следующего заголовка того же
 * уровня или выше — так §8A…§8G не растворяются в одном гигантском §8.
 */
export function sliceAgentsMd(markdown: string): CorpusDoc[] {
  const lines = markdown.split('\n');
  const headerRe = /^(#{2,3})\s+(.*)$/;

  type Section = { level: number; title: string; startLine: number };
  const sections: Section[] = [];

  lines.forEach((line, i) => {
    const m = headerRe.exec(line);
    if (m) {
      const [, hashes, title] = m;
      sections.push({ level: (hashes ?? '').length, title: (title ?? '').trim(), startLine: i });
    }
  });

  const docs: CorpusDoc[] = [];
  sections.forEach((current, i) => {
    // Конец секции — следующий заголовок ТОГО ЖЕ уровня или выше (меньшее
    // число #). Более глубокий заголовок (### внутри ##) остаётся частью
    // родительской секции — иначе поиск по §8D не находил бы контекст §8.
    const next = sections.slice(i + 1).find((s) => s.level <= current.level);
    const end = next?.startLine ?? lines.length;
    const body = lines.slice(current.startLine, end).join('\n').trim();
    const slug = slugify(current.title);
    docs.push({
      id: `spec:${slug}`,
      source: 'spec',
      title: current.title,
      path: 'docs/product/qajet-master-spec.md',
      content: body,
      updatedAt: new Date(0).toISOString(), // перезаписывается mtime файла в syncCorpus
    });
  });
  return docs;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

async function readMarkdownDir(dir: string, source: CorpusDoc['source']): Promise<CorpusDoc[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const docs: CorpusDoc[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(dir, entry);
    const [content, fileStat] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
    const firstLine = content.split('\n', 1)[0] ?? entry;
    docs.push({
      id: `${source}:${entry}`,
      source,
      title: firstLine.replace(/^#+\s*/, '').trim() || entry,
      path: path.relative(path.join(dir, '..', '..'), filePath),
      content,
      updatedAt: fileStat.mtime.toISOString(),
    });
  }
  return docs;
}

/** Весь корпус: полная спека по секциям + ADR + журнал + сгенерированное состояние. */
export async function loadCorpus(): Promise<CorpusDoc[]> {
  const agentsMd = await readFile(AGENTS_MD_PATH, 'utf8');
  const agentsMdStat = await stat(AGENTS_MD_PATH);
  const specDocs = sliceAgentsMd(agentsMd).map((doc) => ({
    ...doc,
    updatedAt: agentsMdStat.mtime.toISOString(),
  }));

  const [decisions, journal, state] = await Promise.all([
    readMarkdownDir(DECISIONS_DIR, 'decision'),
    readMarkdownDir(JOURNAL_DIR, 'journal'),
    readMarkdownDir(STATE_DIR, 'state'),
  ]);

  return [...specDocs, ...decisions, ...journal, ...state];
}

/** Хеш корпуса — чтобы `rag:check` мог сказать «индекс устарел» без пересборки. */
export function corpusFingerprint(docs: CorpusDoc[]): string {
  const hash = createHash('sha256');
  for (const doc of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(doc.id);
    hash.update(' ');
    hash.update(doc.content);
    hash.update(' ');
  }
  return hash.digest('hex');
}
