#!/usr/bin/env node
// Scrapes Sword/Shield weather-conditional spawn data from Serebii:
//
//  - /swordshield/weather.shtml: which console date forces each weather, per
//    region (Wild Area / Isle of Armor / Crown Tundra) — the "date skip".
//  - /pokearth/galar/<area>.shtml: every area's wild spawns grouped by
//    weather (sections anchored #thunderstorm, #snowstorm, ... plus
//    #allweather for weather-independent spawns), with per-game sub-blocks.
//
// Writes data/weather-dates.json and data/spawns.json. Pages cache under
// cache/ and re-runs skip anything cached.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE = join(ROOT, 'cache');
const DATA = join(ROOT, 'data');

const CONCURRENCY = 4;
let inFlight = 0;
const waiters = [];

async function fetchPage (url, cacheName) {
  const file = join(CACHE, cacheName);
  try {
    await access(file);
    return readFile(file, 'latin1');
  } catch { /* not cached */ }

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

// --- weather date table ---------------------------------------------------

const WEATHER_ANCHORS = {
  normalweather: 'Normal Weather',
  overcast: 'Overcast',
  raining: 'Raining',
  thunderstorm: 'Thunderstorm',
  snowing: 'Snowing',
  snowstorm: 'Snowstorm',
  sandstorm: 'Sandstorm',
  intensesun: 'Intense Sun',
  fog: 'Fog',
};

const weatherPage = await fetchPage('https://www.serebii.net/swordshield/weather.shtml', 'weather.shtml');
const tableStart = weatherPage.indexOf('Wild Area Date');
const DATE_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s/;
const dates = {};
// The page's tables aren't well-formed, so instead of trusting table
// boundaries, only accept rows whose first three cells are dates or blank,
// whose last cell is a known weather, and never overwrite an earlier row.
for (const row of weatherPage.slice(tableStart).matchAll(/<tr>(.*?)<\/tr>/gs)) {
  const cells = [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]);
  if (cells.length !== 4) continue;
  const clean = (html) => html.split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>|&nbsp;/g, '').trim()).filter(Boolean);
  const weather = clean(cells[3])[0];
  // Prefer a date that exists every year (Serebii lists Feb 29th first for
  // Wild Area fog).
  const pick = (options) => options.find((d) => d !== 'February 29th') || options[0] || null;
  const regionDates = [pick(clean(cells[0])), pick(clean(cells[1])), pick(clean(cells[2]))];
  if (!weather || !Object.values(WEATHER_ANCHORS).includes(weather)) continue;
  if (!regionDates.every((d) => d === null || DATE_RE.test(d))) continue;
  if (dates[weather]) continue;
  dates[weather] = { wild: regionDates[0], ioa: regionDates[1], ct: regionDates[2] };
}
console.log('weather dates:', Object.keys(dates).length, 'weathers');

// --- area list ------------------------------------------------------------

const index = await fetchPage('https://www.serebii.net/pokearth/galar/', 'galar-index.shtml');
const areas = [...index.matchAll(/<option value="\/pokearth\/galar\/([^"]+)\.shtml">([^<]+)<\/option>/g)]
  .map(([, slug, name]) => ({ slug, name: name.trim() }))
  .filter(({ name }) => !name.startsWith('Pok'));
console.log('areas:', areas.length);

// --- per-area spawn parsing -----------------------------------------------

function parseArea (page) {
  // Locate every weather section start (and allweather), then attribute the
  // pokemon sprites between one anchor and the next to that weather. Game
  // sub-headers inside a section switch which game the sprites belong to.
  const anchors = [];
  for (const anchor of Object.keys(WEATHER_ANCHORS).concat('allweather')) {
    // The nav table at the top also links to #anchor; the real section start
    // is the <a name="..."> tag.
    const re = new RegExp(`<a name="${anchor}">`, 'g');
    let m;
    while ((m = re.exec(page)) !== null) anchors.push({ anchor, index: m.index });
  }
  anchors.sort((a, b) => a.index - b.index);
  if (anchors.length === 0) return null; // no dynamic weather in this area

  const result = {}; // weatherAnchor -> { sword: Set, shield: Set }
  anchors.forEach(({ anchor, index }, i) => {
    const end = i + 1 < anchors.length ? anchors[i + 1].index : page.length;
    const section = page.slice(index, end);

    const bucket = (result[anchor] ||= { sword: new Set(), shield: new Set() });
    // Walk game headers and sprites in document order.
    const tokens = [...section.matchAll(/Pok&eacute;mon Sword & Shield|Pok&eacute;mon Sword|Pok&eacute;mon Shield|\/pokemon\/small\/(\d+)(?:-\w+)?\.png/g)];
    let scope = ['sword', 'shield'];
    for (const token of tokens) {
      if (token[1] !== undefined) {
        for (const game of scope) bucket[game].add(parseInt(token[1], 10));
      } else if (token[0] === 'Pok&eacute;mon Sword & Shield') {
        scope = ['sword', 'shield'];
      } else if (token[0] === 'Pok&eacute;mon Sword') {
        scope = ['sword'];
      } else {
        scope = ['shield'];
      }
    }
  });

  return result;
}

const spawns = {};
let done = 0;
await Promise.all(areas.map(async ({ slug, name }) => {
  const page = await fetchPage(`https://www.serebii.net/pokearth/galar/${slug}.shtml`, `area-${slug.replace(/[^a-z0-9]/g, '_')}.shtml`);
  const parsed = parseArea(page);
  if (parsed) {
    spawns[name] = Object.fromEntries(
      Object.entries(parsed).map(([weather, games]) => [weather, { sword: [...games.sword].sort((a, b) => a - b), shield: [...games.shield].sort((a, b) => a - b) }])
    );
  }
  done++;
  if (done % 20 === 0) console.log(`${done}/${areas.length}`);
}));

console.log('areas with weather spawns:', Object.keys(spawns).length);
await mkdir(DATA, { recursive: true });
await writeFile(join(DATA, 'weather-dates.json'), JSON.stringify(dates, null, 1));
await writeFile(join(DATA, 'spawns.json'), JSON.stringify(spawns, null, 1));
console.log('wrote data/weather-dates.json and data/spawns.json');
