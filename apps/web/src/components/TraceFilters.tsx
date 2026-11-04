'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGE_PRESETS } from '@/lib/constants';

export function TraceFilters({ models }: { models: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change invalidates the current page offset.
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <form
      className="mb-5 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        update('q', String(data.get('q') ?? ''));
      }}
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-xs">
        <span className="font-medium text-ink-2">Search name or trace id</span>
        <input name="q" defaultValue={params.get('q') ?? ''} className="field" placeholder="support-reply" />
      </label>

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium text-ink-2">Range</span>
        <select
          className="field w-32"
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
        <span className="font-medium text-ink-2">Status</span>
        <select
          className="field w-32"
          defaultValue={params.get('status') ?? 'all'}
          onChange={(event) => update('status', event.target.value === 'all' ? '' : event.target.value)}
        >
          <option value="all">All</option>
          <option value="ok">Succeeded</option>
          <option value="error">Failed</option>
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="font-medium text-ink-2">Model</span>
        <select
          className="field w-52"
          defaultValue={params.get('model') ?? ''}
          onChange={(event) => update('model', event.target.value)}
        >
          <option value="">Any model</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="btn btn-ghost">
        Apply
      </button>
    </form>
  );
}
