import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(process.cwd());
const staticDir = resolve(appRoot, '.next', 'static');
const publicDir = resolve(appRoot, 'public');
const standaloneRoot = resolve(appRoot, '.next', 'standalone', 'apps', 'web');

for (const source of [staticDir, publicDir]) {
  if (!existsSync(source)) {
    throw new Error(`Standalone source is missing: ${source}`);
  }
}

mkdirSync(standaloneRoot, { recursive: true });
cpSync(staticDir, resolve(standaloneRoot, '.next', 'static'), { recursive: true });
cpSync(publicDir, resolve(standaloneRoot, 'public'), { recursive: true });
