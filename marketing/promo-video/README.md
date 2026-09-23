# QAJET: промо-ролик (Remotion)

15 секунд, 1920×1080, 30 fps, ровно 450 кадров. Сцены: интро, демо интерфейса, аутро.

Все цены, поставщики, составы и сроки в ролике — **заглушки** (`src/content.ts`).
Это не реальные сделки. Метрики, клиенты и отзывы в ролик не добавляются.

Проект лежит вне pnpm workspace (`apps/*`, `packages/*`, `tools/*`): не попадает
в turbo typecheck/build и в сборку Vercel, зависимости у него свои (`bun.lock`).
Код в `src/` проверяет корневой `pnpm lint` (biome).

## Команды

```bash
cd marketing/promo-video
bun install                       # или npm i

npx remotion studio               # превью в браузере (то же: bun run dev)
bun run typecheck                 # tsc

# Финальный рендер: H.264, CRF 18 (то же: bun run render)
npx remotion render QajetDemo out/qajet-demo.mp4 --codec=h264 --crf=18
```

`remotion.config.ts` дополнительно задаёт `yuv420p` + BT.709: такой профиль ждут
Instagram, Telegram и LinkedIn. Файлы из `out/` в git не попадают.

Remotion сам скачивает Chrome Headless Shell при первом рендере. Если загрузка
заблокирована, укажите свой бинарник: `--browser-executable=/путь/к/headless_shell`.

## Где что менять

| Что | Где |
| --- | --- |
| Тексты, цены, поставщики, текст запроса | `src/content.ts` |
| Цвета, радиусы, тени, шрифт | `src/theme.ts` (там же токены живого сайта для замены) |
| Длительности сцен и переходов | `TIMING` в `src/MainSequence.tsx` (формула суммы в комментарии) |
| Ключевые кадры внутри сцен | `INTRO_KEYFRAMES`, `DEMO_KEYFRAMES`, `OUTRO_KEYFRAMES` |
| Логотип (SVG/PNG вместо текста) | `src/components/Logo.tsx` |
| Раскладка макета и точки кликов | `LAYOUT` в `src/scenes/ProductDemo.tsx` |

## Реальный скриншот вместо макета

1. Снимите экран приложения во вьюпорте **1640×860** (размер вкладки в ролике).
2. Положите файл в `public/screens/app.png`.
3. В `src/scenes/ProductDemo.tsx` поставьте `USE_SCREENSHOT = true` и впишите
   в `SCREENSHOT.searchClick` / `selectClick` пиксельные координаты кнопок на скриншоте.

Курсор, ripple и тост работают поверх скриншота. Анимация карточек
остаётся только у сверстанного макета.

## Структура

```
src/
  index.ts              registerRoot
  Root.tsx              <Composition id="QajetDemo">
  MainSequence.tsx      TransitionSeries, TIMING, общий фон, луп фона
  theme.ts, content.ts
  lib/motion.ts         clamp, easing, spring, motion blur по скорости, нажатие кнопки
  scenes/               Intro, ProductDemo, Outro
  components/           Logo, BrowserFrame, Cursor, ProposalCard, Toast,
                        GradientBackground, AnimatedText
```

## Remotion agent skills

В репозиторий не коммитятся, версия зафиксирована в `skills-lock.json`. Установка:

```bash
npx skills add remotion-dev/skills -a claude-code --copy -y \
  --skill remotion-best-practices --skill remotion-markup \
  --skill remotion-create --skill remotion-render --skill remotion-studio
```

## Лицензия Remotion

Remotion бесплатен для физлиц и компаний до 3 сотрудников. Для компании больше
этого нужна платная Company License: https://www.remotion.pro/license
