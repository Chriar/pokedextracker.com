#!/usr/bin/env node
// Turns the cache written by scrape.mjs into api/seeds/data.sql — a full seed
// of every data table in the API's schema (users/dexes/captures stay empty).
//
// Two columns can't be read back off the wire and are reconstructed:
//
//  - pokemon.evolution_family_id: synthesized as the smallest pokemon id in
//    the family (each /pokemon/:id response embeds the full family member
//    list, so grouping is exact even though upstream's numeric ids differ).
//  - pokemon.national_order: synthesized as the rank within the game family
//    ordered by (national_id, base form first, form name). Upstream only uses
//    it as an ordering tie-break for branched evolutions, so a differing
//    value at worst reorders two branches of an evolution tree.
//
// Evolution rows also need their (evolving, evolved) pairing re-derived,
// since the API serializes evolutions without pokemon ids. Pairing uses index
// alignment against the family's stage arrays (exact for linear families;
// for branched families it relies on both arrays being built in the same
// order, which holds for the upstream query's ordering). Ambiguous families
// are listed in the run summary for manual review.
//
// Usage:
//   node tools/scrape/generate-sql.mjs \
//     [--cache tools/scrape/cache] \
//     [--out api/seeds/data.sql]

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
function flag (name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const CACHE = flag('cache', 'tools/scrape/cache');
const OUT = flag('out', 'api/seeds/data.sql');

const readJSON = async (path) => JSON.parse(await readFile(join(CACHE, path), 'utf8'));

const games = await readJSON('games.json');
const dexTypes = await readJSON('dex-types.json');
const dexmap = await readJSON('dexmap.json');

const pokemonFiles = (await readdir(join(CACHE, 'pokemon'))).filter((f) => f.endsWith('.json'));
const pokemon = [];
for (const file of pokemonFiles) {
  pokemon.push(await readJSON(join('pokemon', file)));
}
pokemon.sort((a, b) => a.id - b.id);

const capturesByDexType = {};
for (const typeId of Object.keys(dexmap)) {
  try {
    capturesByDexType[typeId] = await readJSON(join('captures', `${typeId}.json`));
  } catch {
    console.warn(`missing captures for dex type ${typeId}; skipping`);
  }
}

// --- SQL helpers ----------------------------------------------------------

function lit (value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function arrayLit (values) {
  if (!values || values.length === 0) return "'{}'::text[]";
  return `ARRAY[${values.map(lit).join(',')}]::text[]`;
}

const chunks = [];
function insert (table, columns, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    chunks.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${batch.map((row) => `(${row.join(',')})`).join(',\n')};`);
  }
}

// --- game_families + games ------------------------------------------------

const familiesById = {};
for (const game of games) {
  familiesById[game.game_family.id] = game.game_family;
}
const families = Object.values(familiesById).sort((a, b) => a.order - b.order);

insert('game_families', ['id', 'generation', 'regional_total', 'national_total', 'regional_support', 'national_support', '"order"', 'published'],
  families.map((f) => [lit(f.id), lit(f.generation), lit(f.regional_total), lit(f.national_total), lit(f.regional_support), lit(f.national_support), lit(f.order), lit(f.published)]));

insert('games', ['id', 'name', 'game_family_id', '"order"'],
  games.map((g) => [lit(g.id), lit(g.name), lit(g.game_family.id), lit(g.order)]));

// --- dex_types (bases before customization variants, for the self-FK) -----

const orderedDexTypes = [...dexTypes].sort((a, b) => (a.base_dex_type_id ? 1 : 0) - (b.base_dex_type_id ? 1 : 0) || a.id - b.id);
insert('dex_types', ['id', 'name', 'description', 'game_family_id', '"order"', 'tags', 'base_dex_type_id'],
  orderedDexTypes.map((dt) => [lit(dt.id), lit(dt.name), lit(dt.description ?? null), lit(dt.game_family_id), lit(dt.order), arrayLit(dt.tags), lit(dt.base_dex_type_id ?? null)]));

// --- pokemon --------------------------------------------------------------

// evolution_family_id: smallest member id, or own id for family-less pokemon.
const familyIdByPokemon = {};
for (const p of pokemon) {
  const members = (p.evolution_family?.pokemon || []).flat().map((m) => m.id);
  familyIdByPokemon[p.id] = members.length > 0 ? Math.min(...members) : p.id;
}

// national_order: rank within game family by (national_id, base form first).
const byFamily = {};
for (const p of pokemon) {
  (byFamily[p.game_family.id] ||= []).push(p);
}
const nationalOrder = {};
for (const group of Object.values(byFamily)) {
  group
    .slice()
    .sort((a, b) => a.national_id - b.national_id || (a.form === null ? -1 : b.form === null ? 1 : a.form.localeCompare(b.form)))
    .forEach((p, i) => { nationalOrder[p.id] = i + 1; });
}

insert('pokemon', ['id', 'national_id', 'name', 'game_family_id', 'form', 'national_order', 'evolution_family_id'],
  pokemon.map((p) => [lit(p.id), lit(p.national_id), lit(p.name), lit(p.game_family.id), lit(p.form), lit(nationalOrder[p.id]), lit(familyIdByPokemon[p.id])]));

// --- evolutions -----------------------------------------------------------

const evolutionRows = new Map();
const ambiguousFamilies = new Set();
const seenFamilies = new Set();

for (const p of pokemon) {
  const family = p.evolution_family;
  if (!family || family.evolutions.length === 0) continue;
  const familyId = familyIdByPokemon[p.id];
  if (seenFamilies.has(familyId)) continue;
  seenFamilies.add(familyId);

  family.evolutions.forEach((stageEvolutions, i) => {
    const from = family.pokemon[i] || [];
    const to = family.pokemon[i + 1] || [];

    stageEvolutions.forEach((evo, j) => {
      // The serializer swaps the pair for breed triggers so the baby renders
      // at the earlier stage: JSON `from` holds the evolved (baby) and `to`
      // holds the evolving (parent). Undo that swap here.
      let evolvingSide = from;
      let evolvedSide = to;
      if (evo.trigger === 'breed') {
        [evolvingSide, evolvedSide] = [to, from];
      }

      const pick = (side) => {
        if (side.length === 1) return side[0];
        if (side.length === stageEvolutions.length) return side[j];
        ambiguousFamilies.add(familyId);
        return side[Math.min(j, side.length - 1)];
      };

      // For breed rows the "evolved" (baby) is what JSON stage i holds, so
      // resolve each side against its own array, not by j-index symmetry.
      const evolving = evo.trigger === 'breed' ? pick(evolvingSide) : pick(from);
      const evolved = evo.trigger === 'breed' ? pick(evolvedSide) : pick(to);
      if (!evolving || !evolved) {
        ambiguousFamilies.add(familyId);
        return;
      }

      const key = `${evolving.id}:${evolved.id}`;
      if (!evolutionRows.has(key)) {
        evolutionRows.set(key, [
          lit(evolving.id), lit(evolved.id), lit(familyId), lit(i + 1),
          lit(evo.trigger), lit(evo.level ?? null), lit(evo.candy_count ?? null),
          lit(evo.stone ?? null), lit(evo.held_item ?? null), lit(evo.notes ?? null),
        ]);
      }
    });
  });
}

insert('evolutions', ['evolving_pokemon_id', 'evolved_pokemon_id', 'evolution_family_id', 'stage', 'trigger', 'level', 'candy_count', 'stone', 'held_item', 'notes'],
  [...evolutionRows.values()]);

// --- locations ------------------------------------------------------------

const locationRows = [];
for (const p of pokemon) {
  for (const loc of p.locations || []) {
    locationRows.push([lit(loc.game.id), lit(p.id), lit((loc.values || []).join('; ')), arrayLit(loc.values)]);
  }
}
insert('locations', ['game_id', 'pokemon_id', 'value', '"values"'], locationRows);

// --- dex_types_pokemon ----------------------------------------------------

const dtpRows = [];
for (const [typeId, captures] of Object.entries(capturesByDexType)) {
  captures.forEach((capture, i) => {
    dtpRows.push([lit(Number(typeId)), lit(capture.pokemon.id), lit(capture.pokemon.box), lit(i), lit(capture.pokemon.dex_number)]);
  });
}
insert('dex_types_pokemon', ['dex_type_id', 'pokemon_id', 'box', '"order"', 'dex_number'], dtpRows);

// --- game_family_dex_numbers (legacy table, only read by old migrations) --

const gfdnRows = [];
for (const dt of dexTypes.filter((dt) => dt.name === 'Regional')) {
  for (const capture of capturesByDexType[dt.id] || []) {
    gfdnRows.push([lit(dt.game_family_id), lit(capture.pokemon.id), lit(capture.pokemon.dex_number)]);
  }
}
insert('game_family_dex_numbers', ['game_family_id', 'pokemon_id', 'dex_number'], gfdnRows);

// --- assemble -------------------------------------------------------------

const sql = [
  '-- Generated by tools/scrape/generate-sql.mjs — do not edit by hand.',
  '-- Reconstructed from the public read endpoints of the live Pokédex Tracker API.',
  'BEGIN;',
  'TRUNCATE game_family_dex_numbers, dex_types_pokemon, locations, evolutions, captures, dexes, pokemon, dex_types, games, game_families, boxes RESTART IDENTITY CASCADE;',
  ...chunks,
  "SELECT setval('pokemon_id_seq', (SELECT MAX(id) FROM pokemon));",
  "SELECT setval('dex_types_id_seq', (SELECT MAX(id) FROM dex_types));",
  'COMMIT;',
].join('\n\n');

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, sql);

console.log(`wrote ${OUT}`);
console.log(`  game_families:     ${families.length}`);
console.log(`  games:             ${games.length}`);
console.log(`  dex_types:         ${dexTypes.length} (${Object.keys(capturesByDexType).length} with pokemon lists)`);
console.log(`  pokemon:           ${pokemon.length}`);
console.log(`  evolutions:        ${evolutionRows.size}`);
console.log(`  locations:         ${locationRows.length}`);
console.log(`  dex_types_pokemon: ${dtpRows.length}`);
if (ambiguousFamilies.size > 0) {
  console.log(`  WARNING: ${ambiguousFamilies.size} evolution families needed ambiguous pairing; review family ids: ${[...ambiguousFamilies].sort((a, b) => a - b).join(', ')}`);
}
