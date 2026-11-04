'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'gfz-theme';

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setTheme(stored);
      apply(stored);
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const options: { id: Theme; label: string; glyph: string }[] = [
    { id: 'light', label: 'Light theme', glyph: '☀' },
    { id: 'dark', label: 'Dark theme', glyph: '☾' },
    { id: 'system', label: 'Follow system theme', glyph: '◐' },
  ];

  return (
    <div
      className="inline-flex items-center gap-px rounded-md border border-hairline-strong p-px"
      role="group"
      aria-label="Theme"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => choose(option.id)}
          aria-pressed={theme === option.id}
          title={option.label}
          className={`rounded-[5px] px-2 py-1 text-xs leading-none ${
            theme === option.id ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2'
          }`}
        >
          <span aria-hidden>{option.glyph}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
