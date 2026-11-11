#!/usr/bin/env node
/**
 * Stage the dashboard's standalone build into the desktop package.
 *
 * Next's `output: 'standalone'` emits a pruned server bundle, but leaves the
 * static assets and public files outside it — copying only the standalone
 * directory produces an app that boots and then serves an unstyled page.
 * This script does the same three copies the Dockerfile does, so the desktop
 * build and the container build cannot drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, '..');
const repoRoot = path.join(desktopDir, '..', '..');
const webDir = path.join(repoRoot, 'apps', 'web');
const standalone = path.join(webDir, '.next', 'standalone');
const target = path.join(desktopDir, 'server');

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

if (!fs.existsSync(standalone) || process.argv.includes('--rebuild')) {
  console.log('Building the dashboard…');
  run('npm', ['run', 'build', '--workspace=@glassfish-zero/web'], repoRoot);
}

if (!fs.existsSync(standalone)) {
  console.error(
    `\nNo standalone build at ${standalone}.\n` +
      "Check that next.config.mjs still sets output: 'standalone'.",
  );
  process.exit(1);
}

console.log(`Staging into ${target}`);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

fs.cpSync(standalone, target, { recursive: true });
fs.cpSync(
  path.join(webDir, '.next', 'static'),
  path.join(target, 'apps', 'web', '.next', 'static'),
  { recursive: true },
);
fs.cpSync(path.join(webDir, 'public'), path.join(target, 'apps', 'web', 'public'), {
  recursive: true,
});

const entry = path.join(target, 'apps', 'web', 'server.js');
if (!fs.existsSync(entry)) {
  console.error(`\nStaging produced no entry point at ${entry}.`);
  process.exit(1);
}

// A data directory inside the package would be shipped to every user and
// then shadow the per-user one; the app writes to userData instead.
fs.rmSync(path.join(target, 'apps', 'web', 'data'), { recursive: true, force: true });

const size = directorySize(target);
console.log(`Staged ${(size / 1024 / 1024).toFixed(1)} MB`);

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}
