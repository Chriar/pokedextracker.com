// Local mode: a client-side implementation of the Pokédex Tracker API backed
// by the bundled dataset (/data/db.json) and localStorage. Enabled via
// Config.LOCAL_MODE — utils/api.ts routes every request here instead of the
// network. Accounts, dexes, and captures are device-local; there is no sync.
//
// The read endpoints faithfully port the Go API's logic (location filtering
// by dex type, evolution family assembly) so the UI behaves identically.

import { localStorage } from '../utils/local-storage';

import type { Capture, Dex, DexType, Evolution, EvolutionPokemon, Game, GameFamily, Pokemon, User } from '../types';

// --- bundled dataset ------------------------------------------------------

interface RawDexType {
  id: number;
  name: string;
  description: string | null;
  game_family_id: string;
  order: number;
  tags: string[];
  base_dex_type_id: number | null;
}

interface RawPokemon {
  id: number;
  national_id: number;
  name: string;
  game_family_id: string;
  form: string | null;
  national_order: number;
  evolution_family_id: number | null;
}

interface RawDexTypePokemon {
  dex_type_id: number;
  pokemon_id: number;
  box: string | null;
  order: number;
  dex_number: number;
}

interface RawLocation {
  game_id: string;
  pokemon_id: number;
  values: string[];
}

interface RawEvolution {
  evolving_pokemon_id: number;
  evolved_pokemon_id: number;
  evolution_family_id: number;
  stage: number;
  trigger: string;
  level: number | null;
  candy_count: number | null;
  stone: string | null;
  held_item: string | null;
  notes: string | null;
}

interface RawGame {
  id: string;
  name: string;
  game_family_id: string;
  order: number;
}

interface DB {
  gameFamiliesById: Record<string, GameFamily>;
  games: RawGame[];
  gamesById: Record<string, RawGame>;
  dexTypes: RawDexType[];
  dexTypesById: Record<number, RawDexType>;
  pokemonById: Record<number, RawPokemon>;
  dtpByDexType: Record<number, RawDexTypePokemon[]>;
  locationsByPokemon: Record<number, RawLocation[]>;
  evolutionsByFamily: Record<number, RawEvolution[]>;
}

let dbPromise: Promise<DB> | null = null;

function loadDB (): Promise<DB> {
  dbPromise = dbPromise || fetch('data/db.json').then((res) => res.json()).then((raw) => {
    const db: DB = {
      gameFamiliesById: {},
      games: raw.games,
      gamesById: {},
      dexTypes: raw.dex_types,
      dexTypesById: {},
      pokemonById: {},
      dtpByDexType: {},
      locationsByPokemon: {},
      evolutionsByFamily: {},
    };

    for (const gf of raw.game_families) db.gameFamiliesById[gf.id] = gf;
    for (const g of raw.games) db.gamesById[g.id] = g;
    for (const dt of raw.dex_types) db.dexTypesById[dt.id] = dt;
    for (const p of raw.pokemon) db.pokemonById[p.id] = p;
    for (const row of raw.dex_types_pokemon) {
      (db.dtpByDexType[row.dex_type_id] ||= []).push(row);
    }
    for (const rows of Object.values(db.dtpByDexType)) {
      rows.sort((a, b) => a.order - b.order);
    }
    for (const loc of raw.locations) {
      (db.locationsByPokemon[loc.pokemon_id] ||= []).push(loc);
    }
    for (const evo of raw.evolutions) {
      (db.evolutionsByFamily[evo.evolution_family_id] ||= []).push(evo);
    }

    return db;
  });
  return dbPromise;
}

// --- device-local state ---------------------------------------------------

interface LocalDex {
  id: number;
  title: string;
  slug: string;
  shiny: boolean;
  game_id: string;
  dex_type_id: number;
  date_created: string;
  date_modified: string;
}

interface LocalState {
  user: {
    id: number;
    username: string;
    friend_code_3ds: string | null;
    friend_code_switch: string | null;
    date_created: string;
  } | null;
  nextDexId: number;
  dexes: LocalDex[];
  captures: Record<number, number[]>; // dex id -> captured pokemon ids
}

const STATE_KEY = 'localdex-state';

function loadState (): LocalState {
  const raw = localStorage.getItem(STATE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as LocalState;
    } catch {
      // fall through to a fresh state
    }
  }
  return { user: null, nextDexId: 1, dexes: [], captures: {} };
}

function saveState (state: LocalState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// --- error type matching utils/api.ts handling ----------------------------

export class LocalAPIError extends Error {
  public response: { status: number };

  constructor (message: string, status = 400) {
    super(message);
    this.response = { status };
  }
}

// --- serializers ----------------------------------------------------------

function serializeGame (db: DB, game: RawGame): Game {
  return { id: game.id, name: game.name, order: game.order, game_family: db.gameFamiliesById[game.game_family_id] };
}

function serializeDexType (dt: RawDexType): DexType {
  return {
    id: dt.id,
    name: dt.name,
    description: dt.description ?? undefined,
    game_family_id: dt.game_family_id,
    order: dt.order,
    tags: dt.tags || [],
    base_dex_type_id: dt.base_dex_type_id ?? undefined,
  };
}

function serializeDex (db: DB, state: LocalState, dex: LocalDex): Dex {
  const dt = db.dexTypesById[dex.dex_type_id];
  const total = (db.dtpByDexType[dex.dex_type_id] || []).length;
  const caught = (state.captures[dex.id] || []).length;
  return {
    id: dex.id,
    user_id: state.user!.id,
    title: dex.title,
    slug: dex.slug,
    shiny: dex.shiny,
    game: serializeGame(db, db.gamesById[dex.game_id]),
    dex_type: serializeDexType(dt),
    regional: dt.tags.includes('regional'),
    caught,
    total,
    date_created: dex.date_created,
    date_modified: dex.date_modified,
  };
}

function serializeUser (db: DB, state: LocalState): User {
  const u = state.user!;
  return {
    id: u.id,
    username: u.username,
    friend_code_3ds: u.friend_code_3ds,
    friend_code_switch: u.friend_code_switch,
    dexes: state.dexes.map((d) => serializeDex(db, state, d)),
    donated: false,
    date_created: u.date_created,
    date_modified: u.date_created,
  };
}

function makeToken (state: LocalState): string {
  const u = state.user!;
  const payload = {
    id: u.id,
    username: u.username,
    friend_code_3ds: u.friend_code_3ds,
    friend_code_switch: u.friend_code_switch,
    date_created: u.date_created,
    date_modified: u.date_created,
  };
  // Shaped like a JWT so utils/state.ts tokenToUser() can decode the payload.
  return `local.${btoa(JSON.stringify(payload))}.local`;
}

// --- read endpoints -------------------------------------------------------

function listGames (db: DB): Game[] {
  return db.games
  .filter((g) => db.gameFamiliesById[g.game_family_id].published)
  .sort((a, b) => a.order - b.order)
  .map((g) => serializeGame(db, g));
}

function listDexTypes (db: DB): DexType[] {
  return db.dexTypes
  .filter((dt) => db.gameFamiliesById[dt.game_family_id].published)
  .sort((a, b) => {
    return db.gameFamiliesById[a.game_family_id].order - db.gameFamiliesById[b.game_family_id].order ||
      a.order - b.order ||
      a.id - b.id;
  })
  .map((dt) => serializeDexType(dt));
}

const EXPANSION_RE = /^(.*)_expansion_pass$/;

function retrievePokemon (db: DB, id: number, dexTypeId: number): Pokemon {
  const p = db.pokemonById[id];
  if (!p) throw new LocalAPIError('pokemon not found', 404);
  const dexType = db.dexTypesById[dexTypeId];
  if (!dexType) throw new LocalAPIError('dex type not found', 404);
  const dexTypeFamily = db.gameFamiliesById[dexType.game_family_id];

  const dtp = (db.dtpByDexType[dexTypeId] || []).find((row) => row.pokemon_id === id);

  // Locations, filtered the same way the Go API filters them.
  const regional = dexType.tags.includes('regional') || dexType.tags.includes('game national');
  const locations = (db.locationsByPokemon[id] || [])
  .map((loc) => ({ loc, game: db.gamesById[loc.game_id] }))
  .filter(({ game }) => {
    const locFamily = db.gameFamiliesById[game.game_family_id];
    if (regional) {
      const m = EXPANSION_RE.exec(dexType.game_family_id);
      if (m && game.game_family_id === m[1]) return true;
      return game.game_family_id === dexType.game_family_id;
    }
    return dexTypeFamily.generation >= locFamily.generation;
  })
  .sort((a, b) => {
    const fa = db.gameFamiliesById[a.game.game_family_id];
    const fb = db.gameFamiliesById[b.game.game_family_id];
    return fb.order - fa.order || a.game.order - b.game.order;
  })
  .map(({ loc, game }) => ({ game: serializeGame(db, game), value: loc.values, values: loc.values }));

  return {
    id: p.id,
    national_id: p.national_id,
    name: p.name,
    game_family: db.gameFamiliesById[p.game_family_id],
    form: p.form,
    box: dtp?.box ?? null,
    dex_number: dtp ? dtp.dex_number : -1,
    locations,
    evolution_family: buildEvolutionFamily(db, p, dexType),
  };
}

function buildEvolutionFamily (db: DB, p: RawPokemon, dexType: RawDexType): Pokemon['evolution_family'] {
  const dexTypeFamilyOrder = db.gameFamiliesById[dexType.game_family_id].order;
  const inDexType = new Set((db.dtpByDexType[dexType.id] || []).map((row) => row.pokemon_id));

  const rows = (p.evolution_family_id !== null ? db.evolutionsByFamily[p.evolution_family_id] || [] : [])
  .filter((e) => {
    const evolving = db.pokemonById[e.evolving_pokemon_id];
    const evolved = db.pokemonById[e.evolved_pokemon_id];
    return db.gameFamiliesById[evolving.game_family_id].order <= dexTypeFamilyOrder &&
        db.gameFamiliesById[evolved.game_family_id].order <= dexTypeFamilyOrder &&
        inDexType.has(e.evolving_pokemon_id) && inDexType.has(e.evolved_pokemon_id);
  })
  .sort((a, b) => {
    const aKey = a.trigger === 'breed' ? db.pokemonById[a.evolving_pokemon_id].national_id : db.pokemonById[a.evolved_pokemon_id].national_id;
    const bKey = b.trigger === 'breed' ? db.pokemonById[b.evolving_pokemon_id].national_id : db.pokemonById[b.evolved_pokemon_id].national_id;
    return aKey - bKey ||
        (a.trigger < b.trigger ? 1 : a.trigger > b.trigger ? -1 : 0) ||
        db.pokemonById[a.evolved_pokemon_id].national_order - db.pokemonById[b.evolved_pokemon_id].national_order;
  });

  const stages: EvolutionPokemon[][] = [];
  const evolutions: Evolution[][] = [];

  const toMember = (rp: RawPokemon) => ({ id: rp.id, national_id: rp.national_id, name: rp.name, form: rp.form });

  for (const e of rows) {
    const i = e.stage - 1;
    while (i + 1 >= stages.length) stages.push([]);

    let first = db.pokemonById[e.evolving_pokemon_id];
    let second = db.pokemonById[e.evolved_pokemon_id];
    if (e.trigger === 'breed') [first, second] = [second, first];

    if (!stages[i].some((m) => m.id === first.id)) stages[i].push(toMember(first));
    if (!stages[i + 1].some((m) => m.id === second.id)) stages[i + 1].push(toMember(second));

    while (i >= evolutions.length) evolutions.push([]);
    evolutions[i].push({
      trigger: e.trigger,
      ...(e.level !== null ? { level: e.level } : {}),
      ...(e.candy_count !== null ? { candy_count: e.candy_count } : {}),
      ...(e.stone !== null ? { stone: e.stone } : {}),
      ...(e.held_item !== null ? { held_item: e.held_item } : {}),
      ...(e.notes !== null ? { notes: e.notes } : {}),
    });
  }

  while (stages.length > 0 && stages[0].length === 0) stages.shift();
  while (evolutions.length > 0 && evolutions[0].length === 0) evolutions.shift();

  if (stages.length === 0) stages.push([toMember(p)]);

  return { pokemon: stages, evolutions };
}

function listCaptures (db: DB, state: LocalState, slug: string): Capture[] {
  const dex = state.dexes.find((d) => d.slug === slug);
  if (!dex) throw new LocalAPIError('dex not found', 404);
  const captured = new Set(state.captures[dex.id] || []);

  return (db.dtpByDexType[dex.dex_type_id] || []).map((row) => {
    const p = db.pokemonById[row.pokemon_id];
    return {
      dex_id: dex.id,
      captured: captured.has(p.id),
      pokemon: {
        id: p.id,
        national_id: p.national_id,
        name: p.name,
        game_family: db.gameFamiliesById[p.game_family_id],
        form: p.form,
        box: row.box,
        dex_number: row.dex_number,
      },
    };
  });
}

// --- write endpoints ------------------------------------------------------

function ensureUser (state: LocalState, username: string): LocalState {
  if (!state.user) {
    state.user = {
      id: 1,
      username,
      friend_code_3ds: null,
      friend_code_switch: null,
      date_created: new Date().toISOString(),
    };
  }
  return state;
}

function createDex (db: DB, state: LocalState, payload: { title: string; slug: string; shiny: boolean; game: string; dex_type: number }): LocalDex {
  if (!payload.title || !payload.slug) throw new LocalAPIError('title is required');
  if (state.dexes.some((d) => d.slug === payload.slug)) {
    throw new LocalAPIError('too_many_dexes: you already have a dex with this URL');
  }
  if (!db.gamesById[payload.game] || !db.dexTypesById[payload.dex_type]) {
    throw new LocalAPIError('unknown game or dex type');
  }
  const now = new Date().toISOString();
  const dex: LocalDex = {
    id: state.nextDexId++,
    title: payload.title,
    slug: payload.slug,
    shiny: payload.shiny,
    game_id: payload.game,
    dex_type_id: payload.dex_type,
    date_created: now,
    date_modified: now,
  };
  state.dexes.push(dex);
  return dex;
}

// --- router ---------------------------------------------------------------

export async function localAPI (method: string, path: string, payload?: any): Promise<any> {
  const db = await loadDB();
  const state = loadState();

  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/games') return listGames(db);
  if (method === 'GET' && path === '/dex-types') return listDexTypes(db);

  if ((m = path.match(/^\/pokemon\/(\d+)$/)) && method === 'GET') {
    return retrievePokemon(db, parseInt(m[1], 10), parseInt(payload?.dex_type, 10));
  }

  if (method === 'POST' && path === '/sessions') {
    // Any credentials work: this is a single-profile local app. The first
    // login creates the profile.
    ensureUser(state, payload.username);
    if (state.user!.username.toLowerCase() !== String(payload.username).toLowerCase()) {
      throw new LocalAPIError(`this device already has a local profile (${state.user!.username}); use that username`, 401);
    }
    saveState(state);
    return { token: makeToken(state) };
  }

  if (method === 'POST' && path === '/users') {
    if (state.user) {
      throw new LocalAPIError(`this device already has a local profile (${state.user.username}); log in as that user instead`, 422);
    }
    ensureUser(state, payload.username);
    state.user!.friend_code_3ds = payload.friend_code_3ds || null;
    state.user!.friend_code_switch = payload.friend_code_switch || null;
    createDex(db, state, payload);
    saveState(state);
    return { token: makeToken(state) };
  }

  if ((m = path.match(/^\/users\/([^/]+)$/))) {
    if (method === 'GET') {
      if (!state.user || state.user.username.toLowerCase() !== m[1].toLowerCase()) {
        throw new LocalAPIError('user not found', 404);
      }
      return serializeUser(db, state);
    }
    if (method === 'POST') {
      if (!state.user) throw new LocalAPIError('user not found', 404);
      if (payload.friend_code_3ds !== undefined) state.user.friend_code_3ds = payload.friend_code_3ds || null;
      if (payload.friend_code_switch !== undefined) state.user.friend_code_switch = payload.friend_code_switch || null;
      // password changes are meaningless locally and are accepted as a no-op
      saveState(state);
      return { token: makeToken(state) };
    }
  }

  if ((m = path.match(/^\/users\/([^/]+)\/dexes$/)) && method === 'POST') {
    const dex = createDex(db, state, payload);
    saveState(state);
    return serializeDex(db, state, dex);
  }

  if ((m = path.match(/^\/users\/([^/]+)\/dexes\/([^/]+)$/))) {
    const dex = state.dexes.find((d) => d.slug === m![2]);
    if (method === 'GET') {
      if (!dex) throw new LocalAPIError('dex not found', 404);
      return serializeDex(db, state, dex);
    }
    if (method === 'POST') {
      if (!dex) throw new LocalAPIError('dex not found', 404);
      if (payload.slug && payload.slug !== dex.slug && state.dexes.some((d) => d.slug === payload.slug)) {
        throw new LocalAPIError('you already have a dex with this URL');
      }
      if (payload.title !== undefined) dex.title = payload.title;
      if (payload.slug !== undefined) dex.slug = payload.slug;
      if (payload.shiny !== undefined) dex.shiny = payload.shiny;
      if (payload.game !== undefined) dex.game_id = payload.game;
      if (payload.dex_type !== undefined && payload.dex_type !== dex.dex_type_id) {
        dex.dex_type_id = payload.dex_type;
        // Captures of pokemon that aren't part of the new dex type are dropped.
        const valid = new Set((db.dtpByDexType[dex.dex_type_id] || []).map((row) => row.pokemon_id));
        state.captures[dex.id] = (state.captures[dex.id] || []).filter((id) => valid.has(id));
      }
      dex.date_modified = new Date().toISOString();
      saveState(state);
      return serializeDex(db, state, dex);
    }
    if (method === 'DELETE') {
      if (!dex) throw new LocalAPIError('dex not found', 404);
      state.dexes = state.dexes.filter((d) => d.id !== dex.id);
      delete state.captures[dex.id];
      saveState(state);
      return serializeDex(db, state, dex);
    }
  }

  if ((m = path.match(/^\/users\/([^/]+)\/dexes\/([^/]+)\/captures$/)) && method === 'GET') {
    return listCaptures(db, state, m[2]);
  }

  if (path === '/captures' && (method === 'POST' || method === 'DELETE')) {
    const dex = state.dexes.find((d) => d.id === payload.dex);
    if (!dex) throw new LocalAPIError('dex not found', 404);
    const set = new Set(state.captures[dex.id] || []);
    for (const id of payload.pokemon as number[]) {
      if (method === 'POST') set.add(id);
      else set.delete(id);
    }
    state.captures[dex.id] = [...set];
    saveState(state);
    return (payload.pokemon as number[]).map((id) => ({ dex_id: dex.id, captured: method === 'POST', pokemon: { id } }));
  }

  throw new LocalAPIError(`local mode does not implement ${method} ${path}`, 404);
}
