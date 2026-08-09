import classNames from 'classnames';

import { padding } from './formatting';

import type { Capture, Dex } from '../types';

export const BOX_SIZE = 30;

// The key that decides whether two dex entries are "the same pokemon" for
// duplicate filtering: same species, and (unless forms are collapsed too) the
// same form. Dexes that combine several regional dexes list a pokemon once
// per sub-dex, so everything after the first occurrence is a duplicate.
export function duplicateKey (capture: Capture, collapseForms: boolean) {
  return collapseForms ? `${capture.pokemon.national_id}` : `${capture.pokemon.national_id}:${capture.pokemon.form || ''}`;
}

export function dedupeCaptures<T extends Capture> (captures: T[], collapseForms: boolean): T[] {
  const seen = new Set<string>();
  return captures.filter((capture) => {
    const key = duplicateKey(capture, collapseForms);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function groupBoxes (captures: Capture[]) {
  let lastBoxName: string | null = null;
  let lastBoxIndex = 0;

  return captures.reduce<Capture[][]>((all, capture) => {
    let boxIndex = all[lastBoxIndex].length === BOX_SIZE ? lastBoxIndex + 1 : lastBoxIndex;

    if (capture.pokemon.box !== lastBoxName) {
      boxIndex++;
    }

    lastBoxName = capture.pokemon.box;
    lastBoxIndex = boxIndex;

    all[boxIndex] = all[boxIndex] || [];
    all[boxIndex].push(capture);
    return all;
  }, [[]]);
}

interface Pokemon {
  national_id: number;
  form: string | null;
}

export function iconClass ({ national_id: nationalId, form }: Pokemon, dex: Dex) {
  const classes = {
    'color-shiny': dex.shiny,
    [`form-${form}`]: Boolean(form),
    [`game-family-${dex.dex_type.game_family_id}`]: true,
  };

  return classNames('pkicon', `pkicon-${padding(nationalId, 3)}`, classes);
}
