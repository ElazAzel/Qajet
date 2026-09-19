/**
 * Сводка ворот CI в машиночитаемом виде — `PASS`, `FAIL` или `NOT RUN`.
 *
 * Зелёная галочка GitHub не различает «проверка выполнена» и «проверку
 * пропустили»: job с пропущенными шагами тоже зелёный. Здесь результат job
 * переводится в три исхода из agents.md («Release semantics»):
 *   success   → PASS
 *   failure   → FAIL
 *   skipped / cancelled → NOT RUN (доказательства нет)
 *
 * Вход: переменная NEEDS_JSON = toJSON(needs) из GitHub Actions.
 * Выход: gates.json, сводка в $GITHUB_STEP_SUMMARY, код 1 при любом FAIL.
 * `--require-all` дополнительно считает NOT RUN провалом — для релизных ворот.
 */
import { appendFileSync, writeFileSync } from 'node:fs';

const requireAll = process.argv.includes('--require-all');
const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');

const OUTCOME = { success: 'PASS', failure: 'FAIL', skipped: 'NOT RUN', cancelled: 'NOT RUN' };
const gates = Object.fromEntries(
  Object.entries(needs).map(([name, info]) => [name, OUTCOME[info.result] ?? 'NOT RUN']),
);

const commit = process.env.GITHUB_SHA ?? 'local';
writeFileSync('gates.json', `${JSON.stringify({ commit, gates }, null, 2)}\n`);

const rows = Object.entries(gates).map(([name, outcome]) => `| ${name} | ${outcome} |`);
const table = ['| Gate | Result |', '| --- | --- |', ...rows].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Gates for ${commit.slice(0, 7)}\n\n${table}\n`,
  );
}

const failed = Object.values(gates).includes('FAIL');
const notRun = Object.values(gates).includes('NOT RUN');
if (failed) process.exit(1);
if (notRun && requireAll) {
  console.error('NOT RUN блокирует релизные ворота: нет доказательства выполнения.');
  process.exit(1);
}
