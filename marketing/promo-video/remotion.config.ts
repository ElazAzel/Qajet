/**
 * Конфиг Remotion CLI (studio / render / still).
 * При рендере через Node.js API этот файл не применяется.
 * Все опции: https://remotion.dev/docs/config
 */

import { Config } from '@remotion/cli/config';

Config.setRspack(true);
// Промежуточные кадры в JPEG с высоким качеством: на мягких градиентах
// фона качество по умолчанию (80) даёт заметный бандинг.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
// Стандартный для соцсетей и плееров цветовой профиль: tv-range yuv420p, BT.709.
// Без этого MP4 выходит в full-range bt470bg, и после перекодирования
// платформой цвета могут слегка «поплыть».
Config.setPixelFormat('yuv420p');
Config.setColorSpace('bt709');
