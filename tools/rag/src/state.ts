import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APPS_DIR, PACKAGES_DIR, REPO_ROOT, STATE_DIR } from './paths.js';

/**
 * Всё в этом файле генерируется из фактического состояния репозитория —
 * файловой системы, package.json — а не переписывается вручную. Так
 * docs/state/ не может «соврать»: если файл существует, пункт отмечен
 * готовым; если нет — не отмечен, сколько бы ни было сказано в чате.
 */

const GENERATED_HEADER =
  '<!-- Сгенерировано `pnpm rag:sync`. Не редактировать руками — правки потеряются ' +
  'при следующей синхронизации. Источник фактов: файловая система репозитория. -->\n\n';

const ROUTE_FILES = new Set([
  'page.tsx',
  'page.ts',
  'layout.tsx',
  'layout.ts',
  'route.ts',
  'route.tsx',
  'manifest.ts',
  'sw.ts',
  'icon.tsx',
  'apple-icon.tsx',
]);

interface RouteEntry {
  segment: string;
  kind: string;
  file: string;
}

async function walkAppDir(dir: string, baseSegment: string, out: RouteEntry[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('_') || entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      const nextSegment =
        entry.startsWith('(') || entry.startsWith('@')
          ? baseSegment // группы маршрутов и параллельные слоты не меняют URL
          : `${baseSegment}/${entry}`;
      await walkAppDir(full, nextSegment, out);
    } else if (ROUTE_FILES.has(entry)) {
      out.push({
        segment: baseSegment || '/',
        kind: entry.replace(/\.tsx?$/, ''),
        file: path.relative(REPO_ROOT, full),
      });
    }
  }
}

async function generateRoutes(): Promise<string> {
  const appDir = path.join(APPS_DIR, 'web/app');
  const entries: RouteEntry[] = [];
  await walkAppDir(appDir, '', entries);
  entries.sort((a, b) => a.segment.localeCompare(b.segment) || a.kind.localeCompare(b.kind));

  const bySegment = new Map<string, RouteEntry[]>();
  for (const e of entries) {
    const list = bySegment.get(e.segment) ?? [];
    list.push(e);
    bySegment.set(e.segment, list);
  }

  const lines: string[] = [
    GENERATED_HEADER.trim(),
    '',
    '# Инвентарь маршрутов apps/web',
    '',
    `Найдено файлов маршрутизации: ${entries.length}. Сегментов: ${bySegment.size}.`,
    '',
    '| Маршрут | Файлы |',
    '| --- | --- |',
  ];
  for (const [segment, files] of bySegment) {
    const cell = files.map((f) => `\`${f.kind}\``).join(', ');
    lines.push(`| \`${segment || '/'}\` | ${cell} |`);
  }
  return `${lines.join('\n')}\n`;
}

interface WorkspacePackage {
  name: string;
  dir: string;
  hasSrc: boolean;
}

async function readWorkspacePackages(root: string): Promise<WorkspacePackage[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const packages: WorkspacePackage[] = [];
  for (const entry of entries) {
    const pkgJsonPath = path.join(root, entry, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8')) as { name?: string };
    packages.push({
      name: pkgJson.name ?? entry,
      dir: path.relative(REPO_ROOT, path.join(root, entry)).split(path.sep).join('/'),
      hasSrc: existsSync(path.join(root, entry, 'src')),
    });
  }
  return packages;
}

async function generatePackages(): Promise<string> {
  const [apps, packages, tools] = await Promise.all([
    readWorkspacePackages(APPS_DIR),
    readWorkspacePackages(PACKAGES_DIR),
    readWorkspacePackages(path.join(REPO_ROOT, 'tools')),
  ]);

  const section = (title: string, items: WorkspacePackage[]) => [
    `## ${title}`,
    '',
    ...(items.length === 0
      ? ['_пусто_']
      : items.map((p) => `- \`${p.name}\` — \`${p.dir}\`${p.hasSrc ? '' : ' (нет src/)'}`)),
    '',
  ];

  return `${[
    GENERATED_HEADER.trim(),
    '',
    '# Пакеты монорепо',
    '',
    ...section('apps/', apps),
    ...section('packages/', packages),
    ...section('tools/', tools),
  ].join('\n')}\n`;
}

interface PhaseCheck {
  phase: number;
  title: string;
  /** Хотя бы один из путей должен существовать, чтобы фаза считалась начатой. */
  evidencePaths: string[];
}

const PHASES: PhaseCheck[] = [
  {
    phase: 0,
    title: 'Фундамент: монорепо, токены, оболочки, PWA, RAG',
    evidencePaths: [
      'apps/web/app/globals.css',
      'packages/ui/src/shell/index.ts',
      'apps/web/app/sw.ts',
      'tools/rag/src/cli.ts',
    ],
  },
  {
    phase: 1,
    title: 'Данные и доступ: схема Drizzle, RLS, Supabase Auth',
    // Policies живут не в отдельной директории, а как pgPolicy() внутри тех
    // же файлов схемы — так их видно рядом с таблицей, которую они защищают.
    evidencePaths: ['packages/db/src/schema', 'apps/web/app/login/actions.ts'],
  },
  {
    phase: 2,
    title: 'Движок: estimate, match, combine, leadtime, tax',
    evidencePaths: ['packages/engine/src/estimate', 'packages/engine/src/combine'],
  },
  {
    phase: 3,
    title: 'Сид: демо-данные, 15 поставщиков, 24 заказа',
    evidencePaths: ['packages/db/src/seed'],
  },
  {
    phase: 4,
    title: 'Сквозная вертикаль консьержа + экран сравнения',
    evidencePaths: ['apps/web/app/concierge/orders'],
  },
  {
    phase: 5,
    title: 'Остальные роли целиком (покупатель, поставщик, админ)',
    evidencePaths: ['apps/web/app/buyer/requests', 'apps/web/app/supplier/orders'],
  },
  {
    phase: 6,
    title: 'Измеримость и право: /metrics, /admin/learning, PII',
    evidencePaths: ['apps/web/app/metrics', 'apps/web/app/admin/learning', 'packages/pd'],
  },
  {
    phase: 7,
    title: 'Нативные оболочки и полировка: Tauri, Capacitor',
    evidencePaths: ['apps/desktop', 'apps/mobile'],
  },
  {
    phase: 8,
    title: 'Переносимость: docker-compose, runbook переезда',
    evidencePaths: ['docker-compose.yml'],
  },
];

async function generateLedger(): Promise<string> {
  const lines: string[] = [
    GENERATED_HEADER.trim(),
    '',
    '# Реестр состояния QAJET',
    '',
    'Чек-лист фаз из плана реализации. Пункт отмечен, если в репозитории',
    'есть хотя бы один из подтверждающих путей — это факт кода, не мнение чата.',
    '',
  ];

  for (const phase of PHASES) {
    const done = phase.evidencePaths.some((p) => existsSync(path.join(REPO_ROOT, p)));
    lines.push(`- [${done ? 'x' : ' '}] **Фаза ${phase.phase}.** ${phase.title}`);
  }

  lines.push('', '## Открытые решения без реализации', '');
  lines.push(
    '- Казахстанский ДЦ для персональных данных (agents.md §11.1) — `packages/pd` спроектирован под это, бэкенд не переключён.',
  );

  return `${lines.join('\n')}\n`;
}

export async function generateState(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  const [routes, packages, ledger] = await Promise.all([
    generateRoutes(),
    generatePackages(),
    generateLedger(),
  ]);
  await Promise.all([
    writeFile(path.join(STATE_DIR, 'routes.md'), routes, 'utf8'),
    writeFile(path.join(STATE_DIR, 'packages.md'), packages, 'utf8'),
    writeFile(path.join(STATE_DIR, 'ledger.md'), ledger, 'utf8'),
  ]);
}
