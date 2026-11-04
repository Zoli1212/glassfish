import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Glassfish Zero — LLM observability',
  description:
    'Self-hosted tracing, monitoring, cost accounting and model-swap analysis for LLM applications.',
  icons: { icon: '/favicon.svg' },
};

/**
 * Applied before paint so a dark-theme reload never flashes the light
 * surface. Reads the same key the toggle writes.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('gfz-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
