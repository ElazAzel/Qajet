'use client';

import { MotionProvider } from '@qajet/ui/motion';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { initNativeApp } from './lib/native-bridge';

/** Единая точка для клиентских провайдеров всего приложения. */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initNativeApp();
  }, []);

  return <MotionProvider>{children}</MotionProvider>;
}
