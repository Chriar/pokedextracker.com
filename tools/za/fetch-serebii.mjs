#!/usr/bin/env node
// Fetches the Legends: Z-A dex listings from Serebii and writes them as JSON
// to tools/za/data/. The committed JSON is the source of truth for
// generate-za-sql.mjs; re-run this only to refresh from Serebii (e.g. after
// a game update adds entries).
//
//   Lumiose City Pokédex: https://www.serebii.net/legendsz-a/availablepokemon.shtml
//   Hyperspace Pokédex:   https://www.serebii.net/legendsz-a/hyperspacepokedex.shtml

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

const PAGES = {
  lumiose: 'https://www.serebii.net/legendsz-a/availablepokemon.shtml',
  hyperspace: 'https://www.serebii.net/legendsz-a/hyperspacepokedex.shtml',
};

// Serebii table rows look like:
//   #001 ... <img src="/legendsz-a/pokemon/small/152.png" ...> ...
//   <a href="/pokedex-sv/chikorita/">Chikorita<br /></a>
function parse (html) {
  const start = html.search(/List of /);
  const body = start === -1 ? html : html.slice(start);
  const entries = [];
  const rowRE = /#(\d{3,4})\s*<\/td>([\s\S]*?)(?=#\d{3,4}\s*<\/td>|<\/table>\s*<br)/g;
  for (const [, num, block] of body.matchAll(rowRE)) {
    const img = block.match(/\/pokemon\/small\/(\d+)(?:-(\w+))?\.png/);
    const name = block.match(/\/pokedex-sv\/[a-z0-9.\-']+\/?">([^<]+)<br/);
    if (img && name) {
      entries.push({
        dex_number: parseInt(num, 10),
        national_id: parseInt(img[1], 10),
        form_suffix: img[2] ?? null,
        name: name[1].replace(/&eacute;/g, 'é').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").trim(),
      });
    } else {
      console.warn(`unparsed row #${num}`);
    }
  }
  return entries;
}

await mkdir(DATA_DIR, { recursive: true });
for (const [label, url] of Object.entries(PAGES)) {
  const { stdout } = await execFileP('curl', ['-sS', url], { maxBuffer: 16 * 1024 * 1024 });
  const entries = parse(stdout);
  const numbers = entries.map((e) => e.dex_number);
  const missing = [];
  for (let n = 1; n <= Math.max(...numbers); n++) {
    if (!numbers.includes(n)) missing.push(n);
  }
  if (entries.length === 0 || missing.length > 0) {
    throw new Error(`${label}: parsed ${entries.length} entries, missing dex numbers: ${missing.join(',')}`);
  }
  await writeFile(join(DATA_DIR, `${label}.json`), JSON.stringify(entries, null, 1));
  console.log(`${label}: ${entries.length} entries -> tools/za/data/${label}.json`);
}
