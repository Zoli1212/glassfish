#!/usr/bin/env node
/**
 * Generate the app icon as PNG and ICO, with no image library.
 *
 * Windows installers need a .ico; rather than add an image toolchain (and a
 * binary blob nobody can diff) the mark is drawn from the same primitives as
 * the web favicon, so the two cannot drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(here, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

const BRAND = [0x1b, 0xaf, 0x7a]; // --series-3, the same green the web app uses
const WHITE = [0xff, 0xff, 0xff];

/** Coverage of a pixel by a rounded rectangle, sampled 3x3 for smooth edges. */
function roundedRectCoverage(x, y, size, radius) {
  const inset = size * 0.04;
  const min = inset;
  const max = size - inset;
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      if (px < min || px > max || py < min || py > max) continue;
      const cx = Math.min(Math.max(px, min + radius), max - radius);
      const cy = Math.min(Math.max(py, min + radius), max - radius);
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radius * radius) hits += 1;
    }
  }
  return hits / 9;
}

function circleCoverage(x, y, cx, cy, r) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const px = x + (sx + 0.5) / 3 - cx;
      const py = y + (sy + 0.5) / 3 - cy;
      if (px * px + py * py <= r * r) hits += 1;
    }
  }
  return hits / 9;
}

function rectCoverage(x, y, left, top, right, bottom) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      if (px >= left && px <= right && py >= top && py <= bottom) hits += 1;
    }
  }
  return hits / 9;
}

function blend(target, offset, colour, alpha) {
  for (let i = 0; i < 3; i += 1) {
    target[offset + i] = Math.round(target[offset + i] * (1 - alpha) + colour[i] * alpha);
  }
  target[offset + 3] = Math.max(target[offset + 3], Math.round(alpha * 255));
}

/** The mark: a rounded green tile, an L-bar, and two dots. */
function renderRGBA(size) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  const radius = size * 0.26;

  // Proportions taken from the 32px favicon so both scale identically.
  const barLeft = size * (9 / 32);
  const barTop = size * (10.5 / 32);
  const barRight = size * (11.6 / 32);
  const barBottom = size * (21.5 / 32);
  const footRight = size * (16.7 / 32);
  const footTop = size * (19.2 / 32);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;

      const tile = roundedRectCoverage(x, y, size, radius);
      if (tile > 0) blend(pixels, offset, BRAND, tile);
      if (tile <= 0) continue;

      const stem = rectCoverage(x, y, barLeft, barTop, barRight, barBottom);
      const foot = rectCoverage(x, y, barLeft, footTop, footRight, barBottom);
      const dotBig = circleCoverage(x, y, size * (22 / 32), size * (12.5 / 32), size * (2.6 / 32));
      const dotSmall = circleCoverage(x, y, size * (22 / 32), size * (19.5 / 32), size * (1.6 / 32));

      const ink = Math.min(1, Math.max(stem, foot, dotBig, dotSmall * 0.6) * tile);
      if (ink > 0) blend(pixels, offset, WHITE, ink);
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO with PNG-compressed entries, which Windows has accepted since Vista. */
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  const payloads = [];

  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 2] = 0;
    directory[base + 3] = 0;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
    payloads.push(entry.png);
  });

  return Buffer.concat([header, directory, ...payloads]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map((size) => ({ size, png: encodePNG(size, renderRGBA(size)) }));

const icoPath = path.join(buildDir, 'icon.ico');
fs.writeFileSync(icoPath, encodeICO(entries));

const pngPath = path.join(buildDir, 'icon.png');
fs.writeFileSync(pngPath, entries[entries.length - 1].png);

console.log(`icon.ico  ${sizes.join(', ')}px  ${(fs.statSync(icoPath).size / 1024).toFixed(1)} KB`);
console.log(`icon.png  256px             ${(fs.statSync(pngPath).size / 1024).toFixed(1)} KB`);
