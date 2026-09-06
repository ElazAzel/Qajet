#!/bin/bash
# SessionStart hook — QAJET.
#
# Гарантирует, что зависимости стоят, обновляет RAG-индекс разработки
# (tools/rag: agents.md по секциям + ADR + журнал + сгенерированный
# docs/state/) и печатает реестр состояния фаз, чтобы сессия сразу видела,
# что в репозитории уже реально есть, а не полагалась на память чата.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

if [ ! -d node_modules ] || [ ! -d apps/web/node_modules ]; then
  echo "[session-start] node_modules не найден — устанавливаю зависимости (pnpm install)…" >&2
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prefer-offline
  else
    echo "[session-start] pnpm не найден в PATH. Установите pnpm и запустите вручную:" >&2
    echo "  pnpm install && pnpm rag:sync" >&2
    exit 0
  fi
fi

if ! pnpm rag:sync; then
  echo "[session-start] pnpm rag:sync не выполнился — реестр состояния может быть устаревшим." >&2
  exit 0
fi

if [ -f docs/state/ledger.md ]; then
  echo "===== docs/state/ledger.md (актуально на старт сессии) ====="
  cat docs/state/ledger.md
  echo "=============================================================="
fi
