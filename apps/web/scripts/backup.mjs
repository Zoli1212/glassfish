#!/usr/bin/env node
/**
 * Consistent snapshot of the database, safe to run while the server is live.
 *
 * Uses `VACUUM INTO`, which writes a single compacted file from a consistent
 * read snapshot. Copying `glassfish.db` with `cp` is NOT equivalent: in WAL
 * mode the recent writes live in the `-wal` sidecar, so a plain copy can
 * silently lose the last minutes of ingest.
 *
 *   node scripts/backup.mjs [--db /data/glassfish.db] [--out /backups]
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const source = path.resolve(
  args.db ?? process.env.GLASSFISH_DB ?? path.join(process.cwd(), 'data', 'glassfish.db'),
);
const outDir = path.resolve(args.out ?? path.join(path.dirname(source), 'backups'));

if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(outDir, `glassfish-${stamp}.db`);

const db = new DatabaseSync(source, { readOnly: true });
try {
  // VACUUM INTO refuses to overwrite, which is the behaviour we want.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const { size } = fs.statSync(target);
console.log(`${target}  (${(size / 1024 / 1024).toFixed(2)} MB)`);

const keep = Number(args.keep ?? 14);
if (Number.isFinite(keep) && keep > 0) {
  const old = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith('glassfish-') && f.endsWith('.db'))
    .sort()
    .slice(0, -keep);
  for (const file of old) {
    fs.rmSync(path.join(outDir, file));
    console.log(`removed old backup ${file}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}
