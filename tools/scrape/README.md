# Seed-data scraper

The upstream API repo ships schema migrations but **no Pokémon data** — the
dataset only ever lived in upstream's production database. These scripts
reconstruct it from the live site's public read endpoints (the same JSON the
frontend consumes) and turn it into a SQL seed for the local database.

## Usage

```sh
# 1. Scrape the live API into a resumable on-disk cache (~10–30 min, polite
#    rate limits; re-running skips everything already cached).
node tools/scrape/scrape.mjs

# 2. Turn the cache into a seed file at api/seeds/data.sql.
node tools/scrape/generate-sql.mjs

# 3. Load it (postgres must be up and migrated first).
cd api && make db:migrate && make db:seed
```

Requires network access to `pokedextracker.com` and a `curl` binary (requests
shell out to curl so proxy/CA environment configuration is honored).

`scrape.mjs` needs at least one public profile that owns a dex of every dex
type to achieve full coverage — it starts from `--seed-users ashketchum10`
(the upstream showcase account) and walks the public users list for anything
still missing. Any dex types left uncovered are reported at the end and their
Pokémon lists will be missing from the seed.

## What can't be scraped exactly

Two internal columns aren't exposed by the API and are synthesized (see the
header comment in `generate-sql.mjs` for details): `pokemon.national_order`
(only affects ordering of branched evolutions) and evolution (evolving →
evolved) pairings for branched families, which use index alignment and are
flagged in the output when ambiguous. Everything else — games, dex types,
Pokémon, forms, dex numbers, box layouts, locations — round-trips exactly.
