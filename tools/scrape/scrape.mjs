#!/usr/bin/env node
// Scrapes the public read endpoints of a live Pokédex Tracker API and caches
// every response as JSON on disk. The upstream project never open-sourced its
// Pokémon dataset (it only ever lived in their production database), so this
// reconstructs it from the same responses the frontend consumes:
//
//   /games                                → game_families + games
//   /dex-types                            → dex_types
//   /users/:username                      → find one dex per dex type
//   /users?limit&offset                   → widen the search if needed
//   /users/:username/dexes/:slug/captures → dex_types_pokemon rows
//   /pokemon/:id                          → pokemon + locations + evolutions
//
// The cache is resumable: re-running skips anything already on disk. Requests
// go through `curl` (not Node fetch) so HTTPS_PROXY / system CA config are
// honored in any environment.
//
// Usage:
//   node tools/scrape/scrape.mjs \
//     [--base https://pokedextracker.com/api] \
//     [--cache tools/scrape/cache] \
//     [--seed-users ashketchum10] \
//     [--max-user-fetches 500] \
//     [--concurrency 4]

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const args = process.argv.slice(2);
function flag (name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const BASE = (flag('base', 'https://pokedextracker.com/api')).replace(/\/$/, '');
const CACHE = flag('cache', 'tools/scrape/cache');
const SEED_USERS = flag('seed-users', 'ashketchum10').split(',').filter(Boolean);
const MAX_USER_FETCHES = parseInt(flag('max-user-fetches', '500'), 10);
const CONCURRENCY = parseInt(flag('concurrency', '4'), 10);
const USER_AGENT = 'pokedextracker-fork-seed-scraper (one-time dataset reconstruction; github fork of pokedextracker)';
const PROBE_404_RUN = 25;

let inFlight = 0;
const waiters = [];
async function slot () {
  if (inFlight >= CONCURRENCY) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  inFlight++;
}
function release () {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

async function exists (path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Fetches BASE + path and caches the parsed JSON at CACHE/<cachePath>. A 404
// is cached as a `<cachePath>.404` marker so resumed runs skip it too.
// Returns the parsed JSON, or null on 404.
async function get (path, cachePath) {
  const file = join(CACHE, cachePath);
  const marker = `${file}.404`;

  if (await exists(file)) {
    return JSON.parse(await readFile(file, 'utf8'));
  }
  if (await exists(marker)) {
    return null;
  }

  await slot();
  try {
    // Space requests out a little even when a slot is free.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const url = `${BASE}${path}`;
    for (let attempt = 1; ; attempt++) {
      let stdout;
      try {
        ({ stdout } = await execFileP('curl', [
          '-sS',
          '--max-time', '60',
          '-H', `User-Agent: ${USER_AGENT}`,
          '-w', '\n%{http_code}',
          url,
        ], { maxBuffer: 64 * 1024 * 1024 }));
      } catch (err) {
        if (attempt >= 5) throw new Error(`curl failed for ${url}: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }

      const idx = stdout.lastIndexOf('\n');
      const status = parseInt(stdout.slice(idx + 1), 10);
      const body = stdout.slice(0, idx);

      if (status === 404) {
        await mkdir(dirname(marker), { recursive: true });
        await writeFile(marker, '');
        return null;
      }
      if (status >= 200 && status < 300) {
        const parsed = JSON.parse(body);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(parsed, null, 2));
        return parsed;
      }
      if (attempt >= 5) {
        throw new Error(`${url} returned ${status} after ${attempt} attempts`);
      }
      // Back off harder on 429/5xx.
      await new Promise((resolve) => setTimeout(resolve, (status === 429 ? 5000 : 2000) * attempt));
    }
  } finally {
    release();
  }
}

function log (...parts) {
  console.log(new Date().toISOString(), ...parts);
}

const games = await get('/games', 'games.json');
log(`games: ${games.length}`);

const dexTypes = await get('/dex-types', 'dex-types.json');
log(`dex types: ${dexTypes.length}`);

// --- Find one dex per dex type -------------------------------------------
// dexmap.json: dexTypeId -> { username, slug, total }
const dexmapFile = join(CACHE, 'dexmap.json');
const dexmap = (await exists(dexmapFile)) ? JSON.parse(await readFile(dexmapFile, 'utf8')) : {};

function recordDexes (user) {
  for (const dex of user.dexes || []) {
    const typeId = dex.dex_type?.id;
    if (typeId && !dexmap[typeId]) {
      dexmap[typeId] = { username: user.username, slug: dex.slug, total: dex.total };
    }
  }
}

const uncovered = () => dexTypes.filter((dt) => !dexmap[dt.id]);

for (const username of SEED_USERS) {
  const user = await get(`/users/${username}`, `users/${username}.json`);
  if (user) recordDexes(user);
}
log(`dex types covered by seed users: ${dexTypes.length - uncovered().length}/${dexTypes.length}`);

// Widen the search through the public users list until everything is covered
// or we hit the fetch budget. The list endpoint may or may not embed dexes;
// handle both shapes.
let userFetches = 0;
let offset = 0;
while (uncovered().length > 0 && userFetches < MAX_USER_FETCHES) {
  const page = await get(`/users?limit=100&offset=${offset}`, `user-pages/${offset}.json`);
  userFetches++;
  if (!page || page.length === 0) break;
  offset += page.length;

  for (const user of page) {
    if (uncovered().length === 0 || userFetches >= MAX_USER_FETCHES) break;
    if (user.dexes) {
      recordDexes(user);
    } else if (user.username) {
      const full = await get(`/users/${user.username}`, `users/${user.username}.json`);
      userFetches++;
      if (full) recordDexes(full);
    }
  }
}
await writeFile(dexmapFile, JSON.stringify(dexmap, null, 2));

if (uncovered().length > 0) {
  log(`WARNING: no dex found for ${uncovered().length} dex types:`);
  for (const dt of uncovered()) {
    log(`  - ${dt.id} ${dt.game_family_id} / ${dt.name} (tags: ${dt.tags.join(',')})`);
  }
  log('their dex_types_pokemon rows will be missing from the seed; re-run with more --seed-users to fill them in');
}

// --- Captures per dex type ------------------------------------------------
const pokemonIds = new Set();
await Promise.all(Object.entries(dexmap).map(async ([typeId, { username, slug }]) => {
  const captures = await get(`/users/${username}/dexes/${slug}/captures`, `captures/${typeId}.json`);
  for (const capture of captures || []) {
    pokemonIds.add(capture.pokemon.id);
  }
}));
log(`pokemon ids seen in captures: ${pokemonIds.size}`);

// --- Pokemon details ------------------------------------------------------
// Fetch every id seen in captures, plus every id below the max (ids are a
// serial column, so the space is dense), plus probe past the max until we hit
// a long run of 404s.
const maxSeen = Math.max(...pokemonIds, 0);
for (let id = 1; id <= maxSeen; id++) pokemonIds.add(id);

const ids = [...pokemonIds].sort((a, b) => a - b);
let fetched = 0;
await Promise.all(ids.map(async (id) => {
  await get(`/pokemon/${id}`, `pokemon/${id}.json`);
  fetched++;
  if (fetched % 250 === 0) log(`pokemon: ${fetched}/${ids.length}`);
}));

let probeId = maxSeen;
let misses = 0;
while (misses < PROBE_404_RUN) {
  probeId++;
  const found = await get(`/pokemon/${probeId}`, `pokemon/${probeId}.json`);
  misses = found === null ? misses + 1 : 0;
}
log(`probed up to pokemon id ${probeId}`);

log('done; cache is complete. next: node tools/scrape/generate-sql.mjs');
