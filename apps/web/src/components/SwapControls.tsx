'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGE_PRESETS } from '@/lib/constants';

const VERBOSITY_OPTIONS = [
  { value: '0.75', label: 'Shorter answers (−25%)' },
  { value: '1', label: 'Same answer length' },
  { value: '1.25', label: 'Longer answers (+25%)' },
  { value: '1.5', label: 'Much longer answers (+50%)' },
];

export function SwapControls({ models }: { models: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium text-ink-2">Workload</span>
        <select
          className="field w-56"
          defaultValue={params.get('source') ?? ''}
          onChange={(event) => update('source', event.target.value)}
        >
          <option value="">All models combined</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium text-ink-2">Range</span>
        <select
          className="field w-40"
          defaultValue={params.get('range') ?? '7d'}
          onChange={(event) => update('range', event.target.value)}
        >
          {RANGE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs">
        <span
          className="font-medium text-ink-2"
          title="Tokenisation does not capture how long a model's answers are. State the assumption explicitly instead of hiding it."
        >
          Output length assumption
        </span>
        <select
          className="field w-56"
          defaultValue={params.get('verbosity') ?? '1'}
          onChange={(event) => update('verbosity', event.target.value)}
        >
          {VERBOSITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
