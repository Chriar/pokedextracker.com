#!/usr/bin/env node
// Fetches per-species Legends: Z-A location data from Serebii's Gen-9 dex
// pages and writes tools/za/data/locations.json:
//
//   { "<national_id>": { "za": ["Wild Zone 3", ...], "md": ["Hyperspace Lumiose - ...", ...] } }
//
// "za" comes from the row labeled "Legends: Z-A" (class fooza) and "md" from
// "Legends: Z-A Mega Dimension" (class foozamd), parsed only inside the
// Locations table. Species slugs are taken from the dex listing pages so odd
// names (Mr. Mime, Farfetch'd, Flabébé) resolve correctly.
//
// Pages are cached under tools/za/cache/ and re-runs skip anything cached.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE = join(ROOT, 'cache');
const DATA = join(ROOT, 'data');

const LISTINGS = [
  'https://www.serebii.net/legendsz-a/availablepokemon.shtml',
  'https://www.serebii.net/legendsz-a/hyperspacepokedex.shtml',
];

const CONCURRENCY = 4;
let inFlight = 0;
const waiters = [];

async function fetchPage (url, cacheName) {
  const file = join(CACHE, cacheName);
  try {
    await access(file);
    return readFile(file, 'latin1');
  } catch { /* not cached yet */ }

  while (inFlight >= CONCURRENCY) await new Promise((resolve) => waiters.push(resolve));
  inFlight++;
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const { stdout } = await execFileP('curl', ['-sS', '--fail', '--retry', '3', '--max-time', '60', url], { maxBuffer: 32 * 1024 * 1024, encoding: 'latin1' });
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, stdout, 'latin1');
    return stdout;
  } finally {
    inFlight--;
    const next = waiters.shift();
    if (next) next();
  }
}

function stripTags (html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&eacute;/g, 'é')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Splits a location cell into values: <br>-separated segments; labeled
// segments ("Fixed: X") stay whole, plain lists split on commas.
function cellToValues (cellHTML) {
  const values = [];
  for (const segment of stripTags(cellHTML).split('\n')) {
    const text = segment.trim().replace(/,\s*$/, '');
    if (!text) continue;
    if (text.includes(': ')) {
      values.push(text);
    } else {
      values.push(...text.split(/,\s+/).map((v) => v.trim()).filter(Boolean));
    }
  }
  return values;
}

function parseLocations (page) {
  const start = page.indexOf('<h2>Locations</h2>');
  if (start === -1) return {};
  const end = page.indexOf('<a name="location"', start);
  const table = page.slice(start, end === -1 ? undefined : end);

  const result = {};
  const rowRE = /<td class="foo(za|zamd)"[^>]*>[^<]*<\/td>\s*<td class="fooinfo"[^>]*>(.*?)<\/td>/gs;
  let m;
  while ((m = rowRE.exec(table)) !== null) {
    result[m[1] === 'za' ? 'za' : 'md'] = cellToValues(m[2]);
  }
  return result;
}

// --- collect species slugs from the two listing pages ---------------------

const slugByNationalId = {};

// Every species with a Gen-9 dex page — not just the Z-A dex listings.
// Pokemon can be obtainable in Z-A without a dex entry (post-dex legendaries
// like Xerneas/Yveltal/Zygarde/Hoopa), and their location rows live on the
// same pages. The index's first species block is national numbering, so the
// first occurrence of each slug carries its national id.
const svIndex = await fetchPage('https://www.serebii.net/pokedex-sv/', 'pokedex-sv-index.shtml');
const seenSlugs = new Set();
for (const [, slug, num] of svIndex.matchAll(/<option value="\/pokedex-sv\/([a-z0-9.\-']+)\/?"[^>]*>\s*(\d+)/g)) {
  if (seenSlugs.has(slug)) continue;
  seenSlugs.add(slug);
  slugByNationalId[parseInt(num, 10)] = slug;
}

// The Z-A dex listings double as a sanity source for slugs (and would catch
// any species the index dropdown misses).
for (const url of LISTINGS) {
  const page = await fetchPage(url, url.split('/').pop());
  const entries = [...page.matchAll(/#\d{3,4}\s*<\/td>(.*?)(?=#\d{3,4}\s*<\/td>|<\/table>\s*<br)/gs)];
  for (const [, block] of entries) {
    const img = /\/pokemon\/small\/(\d+)(?:-\w+)?\.png/.exec(block);
    const link = /<a href="\/pokedex-sv\/([a-z0-9.\-']+)\/?">/.exec(block);
    if (img && link) slugByNationalId[parseInt(img[1], 10)] = link[1];
  }
}
console.log(`species slugs: ${Object.keys(slugByNationalId).length}`);

// --- fetch each species page and parse ------------------------------------

const locations = {};
let done = 0;
const ids = Object.keys(slugByNationalId);
await Promise.all(ids.map(async (nationalId) => {
  const slug = slugByNationalId[nationalId];
  const page = await fetchPage(`https://www.serebii.net/pokedex-sv/${slug}/`, `pokedex-sv-${slug}.html`);
  const parsed = parseLocations(page);
  if (parsed.za || parsed.md) locations[nationalId] = parsed;
  done++;
  if (done % 50 === 0) console.log(`${done}/${ids.length}`);
}));

// Most species legitimately have no Z-A data; only warn for species that are
// actually in the Z-A dex listings.
const dexListIds = new Set();
for (const url of LISTINGS) {
  const page = await fetchPage(url, url.split('/').pop());
  for (const m of page.matchAll(/\/pokemon\/small\/(\d+)(?:-\w+)?\.png/g)) {
    dexListIds.add(m[1].replace(/^0+/, ''));
  }
}
const missing = ids.filter((id) => dexListIds.has(String(parseInt(id, 10))) && !locations[id]);
if (missing.length > 0) {
  console.log(`WARNING: no Z-A locations parsed for ${missing.length} dex-listed species: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? '…' : ''}`);
}
console.log(`species with Z-A location data: ${Object.keys(locations).length} (${Object.keys(locations).filter((id) => !dexListIds.has(String(parseInt(id, 10)))).length} outside the dex listings)`);

await mkdir(DATA, { recursive: true });
await writeFile(join(DATA, 'locations.json'), JSON.stringify(locations, null, 1));
console.log(`wrote ${join(DATA, 'locations.json')} (${Object.keys(locations).length} species)`);
