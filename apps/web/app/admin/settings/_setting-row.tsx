'use client';

import { useAsyncAction } from '@qajet/ui/hooks';
import { Button } from '@qajet/ui/primitives';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { updateSetting } from '../../lib/actions/settings-actions';
import { formatDate, NUMERIC_DATE } from '../../lib/dates';
import type { SettingValue } from '../../lib/settings-catalog';

export function SettingRow({ setting }: { setting: SettingValue }) {
  const router = useRouter();
  const [draft, setDraft] = useState(setting.value === null ? '' : String(setting.value));
  const dirty = draft !== (setting.value === null ? '' : String(setting.value));

  const { run, pending, error } = useAsyncAction(async () => {
    const parsed = Number(draft);
    const result = await updateSetting(setting.key, parsed);
    if (result.ok) router.refresh();
    return result;
  });

  return (
    <li className="flex flex-col gap-3 border-rule border-t py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:pr-6">
        <p className="text-sm font-semibold text-ink">{setting.label}</p>
        <p className="mt-1 text-fine text-muted">{setting.hint}</p>
        <p className="mt-1 text-micro text-muted">
          <code>{setting.key}</code>
          {setting.updatedAt && ` · изменён ${formatDate(setting.updatedAt, NUMERIC_DATE)}`}
        </p>
        {error && <p className="mt-1 text-fine text-danger">{error}</p>}
      </div>

      <div className="flex shrink-0 items-end gap-2">
        <label className="w-32">
          <span className="mb-1 block text-micro text-muted">
            {setting.min}–{setting.max} {setting.unit}
          </span>
          <input
            type="number"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={setting.label}
            className="w-full rounded-control bg-page px-3 py-2 text-sm text-ink"
          />
        </label>
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          size="sm"
          disabled={!dirty}
          loading={pending}
          onClick={run}
        >
          Применить
        </Button>
      </div>
    </li>
  );
}
