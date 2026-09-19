#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendJournalEntry } from './journal.js';
import { REPO_ROOT, STATE_DIR } from './paths.js';
import { searchCorpus } from './search.js';

/**
 * MCP-сервер накопленного контекста QAJET. Подключается в .mcp.json —
 * любая сессия Claude Code в этом репозитории получает доступ к спеке,
 * ADR, журналу и реестру состояния без ручного вставления файлов в чат.
 *
 * Все данные читаются из tools/rag/.index/corpus.sqlite и docs/state/ —
 * оба генерируются `pnpm rag:sync`. Сервер их не пересобирает сам:
 * если индекс устарел, инструмент qajet_search честно вернёт то, что
 * в индексе есть, а SessionStart-хук отдельно вызывает rag:sync.
 */

const server = new McpServer({ name: 'qajet-rag', version: '0.0.0' });

server.registerTool(
  'qajet_search',
  {
    title: 'Поиск по спецификации и решениям QAJET',
    description:
      'Гибридный поиск (BM25 + векторная семантическая близость) по полной спецификации, ' +
      'ADR (docs/decisions) и журналу разработки (docs/journal). Используй перед тем, ' +
      'как менять логику заказов, оплат, ролей или поставщиков — полная спецификация остаётся ' +
      'источником истины проекта.',
    inputSchema: {
      query: z.string().describe('Что искать, обычным языком — не нужен синтаксис FTS5'),
      limit: z.number().int().min(1).max(20).optional(),
    },
  },
  async ({ query, limit }) => {
    const hits = await searchCorpus(query, limit ?? 8);
    if (hits.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Ничего не найдено. Если это неожиданно, индекс мог устареть — запусти `pnpm rag:sync`.',
          },
        ],
      };
    }
    const text = hits
      .map((h) => `## [${h.source}] ${h.title}  (${h.path})\n${h.snippet.replace(/\*\*/g, '**')}`)
      .join('\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'qajet_ledger',
  {
    title: 'Реестр состояния QAJET',
    description:
      'Текущий чек-лист фаз реализации (docs/state/ledger.md) — какие фазы плана ' +
      'подтверждены наличием кода, а не просто обещаны в чате. Читай перед тем, как ' +
      'говорить, что уже сделано.',
    inputSchema: {},
  },
  async () => {
    const text = await readFile(path.join(STATE_DIR, 'ledger.md'), 'utf8').catch(
      () => 'docs/state/ledger.md ещё не сгенерирован — запусти `pnpm rag:sync`.',
    );
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'qajet_log',
  {
    title: 'Запись в журнал разработки QAJET',
    description:
      'Добавляет короткую запись в docs/journal/<сегодня>.md — что сделано, что ' +
      'сломалось, что отложено. Пиши сюда после значимого шага, чтобы следующая ' +
      'сессия не теряла контекст.',
    inputSchema: {
      message: z.string().min(1).describe('Короткая запись, одно-два предложения'),
    },
  },
  async ({ message }) => {
    const filePath = await appendJournalEntry(message);
    return {
      content: [{ type: 'text', text: `Записано: ${path.relative(REPO_ROOT, filePath)}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
