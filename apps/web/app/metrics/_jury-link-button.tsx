'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useState } from 'react';
import { generateJuryLink } from '../lib/actions/metrics-actions';

/**
 * Ссылка для жюри без входа (agents.md §9). URL собирается на клиенте
 * (`window.location.origin`) — тот же приём, что и `_share-order-button.tsx`:
 * сервер не знает, с какого домена его открыли (превью Vercel, локальный
 * dev), а ссылка обязана вести туда же.
 */
export function JuryLinkButton() {
  const [copied, setCopied] = useState(false);
  const { run, pending, error } = useAsyncAction(generateJuryLink, (result) => {
    if (!result.token) return;
    const url = `${window.location.origin}/metrics?jury=${encodeURIComponent(result.token)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" loading={pending} onClick={() => run()}>
        {copied ? 'Ссылка скопирована' : 'Ссылка для жюри'}
      </Button>
      {error && <p className="text-fine text-signal">{error}</p>}
    </div>
  );
}
