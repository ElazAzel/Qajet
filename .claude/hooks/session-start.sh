#!/bin/bash
# SessionStart hook — QAJET.
#
# ЧИТАЮЩИЙ хук: он только сообщает, где мы находимся, и ничего не меняет.
#
# Раньше здесь выполнялись `pnpm install` и `pnpm rag:sync`. Это означало, что
# простое открытие сессии перезаписывало сгенерированные файлы в репозитории —
# побочный эффект, которого никто не просил, и который мог попасть в коммит.
# Теперь про устаревший индекс мы предупреждаем, а решение запустить
# `pnpm rag:sync` принимает человек.
#
# Установка зависимостей тоже стала явным действием: см. сообщение ниже.
set -uo pipefail

cd "$CLAUDE_PROJECT_DIR" || exit 0

echo "===== QAJET · ориентация на старт сессии ====="

# --- Git ---------------------------------------------------------------
branch=$(git branch --show-current 2>/dev/null || echo '(detached)')
head=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
echo "Ветка:  $branch"
echo "HEAD:   $head"

upstream=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)
if [ -n "$upstream" ]; then
  counts=$(git rev-list --left-right --count "$upstream...HEAD" 2>/dev/null || true)
  if [ -n "$counts" ]; then
    behind=$(echo "$counts" | cut -f1)
    ahead=$(echo "$counts" | cut -f2)
    if [ "$behind" != "0" ] || [ "$ahead" != "0" ]; then
      echo "Против $upstream: отстаём на $behind, опережаем на $ahead"
    fi
  fi
fi

dirty=$(git status --short 2>/dev/null)
if [ -n "$dirty" ]; then
  echo
  echo "Незакоммиченные изменения:"
  echo "$dirty" | head -20
  extra=$(echo "$dirty" | wc -l)
  [ "$extra" -gt 20 ] && echo "  … ещё $((extra - 20))"
else
  echo "Рабочее дерево чистое."
fi

echo
echo "Последние коммиты:"
git log -5 --oneline 2>/dev/null | sed 's/^/  /'

# --- Готовность релиза -------------------------------------------------
if [ -f docs/release/readiness.json ] && command -v node >/dev/null 2>&1; then
  echo
  node -e '
    try {
      const r = require("./docs/release/readiness.json");
      console.log("Готовность: " + r.status + " (проверено " + r.verifiedAt + ", sha " + (r.sourceSha || r.baseSha || "?").slice(0,7) + ")");
      const bad = Object.entries(r.gates || {}).filter(([, v]) =>
        /^(fail|not-run|pending|external|skipped|partial|code-fixed)/i.test(String(v)));
      if (bad.length) {
        console.log("Незакрытые гейты:");
        for (const [k, v] of bad) console.log("  - " + k + ": " + String(v).split(":")[0]);
      }
    } catch { /* читающий хук никогда не ломает сессию */ }
  ' 2>/dev/null
fi

# --- Индекс RAG (только проверка) --------------------------------------
echo
if [ ! -d node_modules ]; then
  echo "node_modules отсутствует. Зависимости больше не ставятся автоматически:"
  echo "  pnpm install"
elif command -v pnpm >/dev/null 2>&1; then
  if pnpm rag:check >/dev/null 2>&1; then
    echo "Индекс RAG актуален."
  else
    echo "ПРЕДУПРЕЖДЕНИЕ: индекс RAG отстал от кода."
    echo "  docs/state/ может вводить в заблуждение. Запустите при необходимости:"
    echo "  pnpm rag:sync"
  fi
else
  echo "pnpm не найден в PATH — состояние индекса RAG неизвестно."
fi

echo
echo "Наличие файла не равно рабочей функции."
echo "Уровни: FILE EXISTS → IMPLEMENTATION PRESENT → VERIFIED → PRODUCTION OPERATIONAL"
echo "=============================================="
exit 0
