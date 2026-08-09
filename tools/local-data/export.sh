#!/usr/bin/env bash
# Exports the seeded local database into web/public/data/db.json — the static
# dataset consumed by the frontend's local mode (no API server needed).
set -euo pipefail

PORT="${DATABASE_PORT:-9876}"
USER="${DATABASE_USER:-pokedex_tracker_admin}"
DB="${DEVELOPMENT_DATABASE_NAME:-pokedex_tracker}"
OUT="${1:-web/public/data/db.json}"

mkdir -p "$(dirname "$OUT")"

psql -h localhost -p "$PORT" -U "$USER" -d "$DB" -t -A <<'SQL' > "$OUT"
SELECT json_build_object(
  'game_families', (SELECT json_agg(row_to_json(t)) FROM (SELECT id, generation, regional_total, national_total, regional_support, national_support, "order", published FROM game_families ORDER BY "order") t),
  'games',         (SELECT json_agg(row_to_json(t)) FROM (SELECT id, name, game_family_id, "order" FROM games ORDER BY "order") t),
  'dex_types',     (SELECT json_agg(row_to_json(t)) FROM (SELECT id, name, description, game_family_id, "order", tags, base_dex_type_id FROM dex_types ORDER BY id) t),
  'pokemon',       (SELECT json_agg(row_to_json(t)) FROM (SELECT id, national_id, name, game_family_id, form, national_order, evolution_family_id FROM pokemon ORDER BY id) t),
  'dex_types_pokemon', (SELECT json_agg(row_to_json(t)) FROM (SELECT dex_type_id, pokemon_id, box, "order", dex_number FROM dex_types_pokemon ORDER BY dex_type_id, "order") t),
  'locations',     (SELECT json_agg(row_to_json(t)) FROM (SELECT game_id, pokemon_id, "values" FROM locations ORDER BY pokemon_id, game_id) t),
  'evolutions',    (SELECT json_agg(row_to_json(t)) FROM (SELECT evolving_pokemon_id, evolved_pokemon_id, evolution_family_id, stage, trigger, level, candy_count, stone, held_item, notes FROM evolutions ORDER BY evolution_family_id, stage) t)
);
SQL

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
