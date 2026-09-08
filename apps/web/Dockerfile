# syntax=docker/dockerfile:1
#
# Переносимость (agents.md фаза 8, ADR-0002): образ должен собираться и
# запускаться где угодно, без рантайм-зависимостей от Vercel. Контекст
# сборки — КОРЕНЬ репозитория (docker-compose.yml вызывает этот Dockerfile
# с `context: ../..`), не apps/web — это pnpm workspace, apps/web зависит
# от workspace:* пакетов (@qajet/engine, @qajet/ui, @qajet/pd), которые
# должны физически лежать рядом при `pnpm install`, а не резолвиться из
# npm-реестра (там их и не существует).
#
# node:*-slim (glibc), не *-alpine (musl): `next/og` (ImageResponse,
# apps/web/app/icons/[size]/route.tsx — брендовые иконки) тянет
# native-модули сборки текста/растеризации, у которых на musl исторически
# нестабильные прероллы бинарей — на этом слоя экономить не стоит.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/pd/package.json packages/pd/package.json
COPY tools/rag/package.json tools/rag/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .
# .env.local из хоста не должен просочиться в образ — конфигурация образа
# идёт только через переменные окружения контейнера (docker-compose.yml).
RUN rm -f apps/web/.env.local
RUN pnpm --filter @qajet/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# `.next/standalone` — не только apps/web: корневой node_modules (pnpm-хранилище)
# и packages/{ui,engine,pd} (transpilePackages, нужны как исходники, не только
# как зависимость) — копируем целиком, сохраняя структуру монорепо, а не
# только подпапку apps/web (там node_modules — символические ссылки в
# корневое хранилище, без него они битые).
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
