import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits a self-contained server bundle with a pruned node_modules, so the
  // container ships without the full workspace install.
  output: 'standalone',
  // In a workspace the tracer must start at the monorepo root, or it misses
  // hoisted dependencies and the standalone build fails at runtime.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
