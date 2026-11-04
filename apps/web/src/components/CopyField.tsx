'use client';

import { useState } from 'react';

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied; the value stays selectable in the
      // field, so there is nothing to recover from.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <span className="text-sm font-medium">{label}</span> : null}
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="field font-mono text-xs"
        />
        <button type="button" className="btn btn-ghost shrink-0" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="btn btn-ghost absolute right-2 top-2 px-2 py-1 text-xs"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="scroll-x m-0 rounded-lg border border-hairline bg-surface-2 p-4 pr-16 font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
