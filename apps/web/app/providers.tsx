'use client';

import { MotionProvider } from '@qajet/ui/motion';
import type { ReactNode } from 'react';

/** Единая точка для клиентских провайдеров всего приложения. */
export function Providers({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}</MotionProvider>;
}
