'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '', label: 'Overview' },
  { href: '/traces', label: 'Traces' },
  { href: '/models', label: 'Models' },
  { href: '/swap', label: 'Model swap' },
  { href: '/datasets', label: 'Datasets' },
  { href: '/experiments', label: 'Experiments' },
  { href: '/prices', label: 'Prices' },
  { href: '/settings', label: 'Settings' },
];

export function ProjectNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/p/${slug}`;

  return (
    <nav className="scroll-x -mb-px flex gap-1 border-b border-hairline">
      {ITEMS.map((item) => {
        const href = `${base}${item.href}`;
        const active = item.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={item.label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'border-brand font-medium text-ink'
                : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
