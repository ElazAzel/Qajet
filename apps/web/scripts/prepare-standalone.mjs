import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(process.cwd());
// Тот же каталог, что у next.config.ts: сборку можно увести в сторону, когда
// прежний `.next` занят чужим процессом (на Windows это антивирус и индексатор).
const distDir = process.env.NEXT_DIST_DIR || '.next';
const staticDir = resolve(appRoot, distDir, 'static');
const publicDir = resolve(appRoot, 'public');
const standaloneRoot = resolve(appRoot, distDir, 'standalone', 'apps', 'web');

for (const source of [staticDir, publicDir]) {
  if (!existsSync(source)) {
    throw new Error(`Standalone source is missing: ${source}`);
  }
}

mkdirSync(standaloneRoot, { recursive: true });
// Каталог назначения тоже зависит от distDir: standalone-сервер несёт его в
// своём конфиге и ищет статику именно там. Если положить в `.next`, когда
// сборка шла в другой каталог, сервер поднимется, но отдаст 404 на все стили
// и чанки — страница отрисуется без оформления, и тесты упадут в неожиданных
// местах, а не на отсутствующем файле.
cpSync(staticDir, resolve(standaloneRoot, distDir, 'static'), { recursive: true });
cpSync(publicDir, resolve(standaloneRoot, 'public'), { recursive: true });
