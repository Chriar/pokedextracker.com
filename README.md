# Pokédex Tracker (monorepo)

A website to track your completion of a Living Pokédex. This is a fork of
[pokedextracker.com](https://github.com/pokedextracker/pokedextracker.com) that
merges the frontend and the API into a single repository:

| Directory | What it is | Upstream |
|-----------|------------|----------|
| [`web/`](web/) | React/TypeScript frontend (webpack, sass) | [pokedextracker/pokedextracker.com](https://github.com/pokedextracker/pokedextracker.com) |
| [`api/`](api/) | Go API + PostgreSQL schema migrations | [pokedextracker/api.pokedextracker.com](https://github.com/pokedextracker/api.pokedextracker.com) |

Both were merged with their full git history (the API via `git subtree add
--prefix=api`). To pull upstream changes later:

```sh
# frontend
git fetch https://github.com/pokedextracker/pokedextracker.com master
git merge FETCH_HEAD   # frontend lives in web/, so expect path adjustments

# api
git subtree pull --prefix=api https://github.com/pokedextracker/api.pokedextracker.com master
```

## Development

The frontend expects the API on `localhost:8647` (see `web/config/local.ts`),
and the API expects Postgres on `localhost:9876`.

```sh
# 1. database
cd api && docker compose up -d postgres

# 2. migrations + API server
cd api && make db:migrate && make start

# 3. frontend (in another shell)
cd web && yarn install && NODE_ENV=local yarn start
```

## Data

The upstream API repo ships schema migrations but **no Pokémon data** — the
dataset only ever lived in the upstream production/staging databases. This fork
reconstructs a seed dataset from the public read endpoints of the live API
(games, dex types, Pokémon, dexes) so the database can be stood up from
scratch. See `tools/scrape/` once that lands.
