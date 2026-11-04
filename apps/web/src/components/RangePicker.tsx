'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGE_PRESETS } from '@/lib/constants';

/** Time-range filter. Sits in one row above the charts it governs. */
export function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function choose(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', id);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      className="inline-flex items-center gap-px rounded-md border border-hairline-strong p-px"
      role="group"
      aria-label="Time range"
    >
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => choose(preset.id)}
          aria-pressed={current === preset.id}
          className={`rounded-[5px] px-2.5 py-1 text-xs ${
            current === preset.id
              ? 'bg-surface-3 font-medium text-ink'
              : 'text-ink-2 hover:bg-surface-2'
          }`}
        >
          {preset.id}
        </button>
      ))}
    </div>
  );
}
