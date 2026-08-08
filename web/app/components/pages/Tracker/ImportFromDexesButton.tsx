import keyBy from 'lodash/keyBy';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';

import { API } from '../../../utils/api';
import { ReactGA } from '../../../utils/analytics';
import { useCreateCapture } from '../../../hooks/queries/captures';
import { useSession } from '../../../hooks/contexts/use-session';
import { useTrackerContext } from './use-tracker';
import { useUser } from '../../../hooks/queries/users';

import type { Capture } from '../../../types';

// On a HOME dex, imports progress from every other dex the user owns: any
// species+form caught anywhere else gets marked caught here too. Shiny dexes
// only import from other shiny dexes (and vice versa).
export function ImportFromDexesButton () {
  const { username, slug } = useParams<{ username: string; slug: string }>();

  const { session } = useSession();
  const user = useUser(username).data!;
  const dex = useMemo(() => keyBy(user.dexes, 'slug')[slug], [user, slug]);

  const { captures, setCaptures } = useTrackerContext();

  const createCapturesMutation = useCreateCapture();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);

  const otherDexes = useMemo(() => {
    return user.dexes.filter((d) => d.id !== dex.id && d.shiny === dex.shiny);
  }, [user, dex]);

  if (session?.id !== user.id || dex.game.game_family.id !== 'home' || otherDexes.length === 0) {
    return null;
  }

  const key = (capture: Capture) => `${capture.pokemon.national_id}:${capture.pokemon.form || ''}`;

  const handleButtonClick = async () => {
    setImporting(true);
    setImported(null);
    createCapturesMutation.reset();

    try {
      const caughtKeys = new Set<string>();
      for (const other of otherDexes) {
        const otherCaptures = await API.get<Capture[]>(`/users/${username}/dexes/${other.slug}/captures`);
        for (const capture of otherCaptures) {
          if (capture.captured) {
            caughtKeys.add(key(capture));
          }
        }
      }

      const pokemon = captures
      .filter((capture) => !capture.captured && caughtKeys.has(key(capture)))
      .map((capture) => capture.pokemon.id);

      if (pokemon.length > 0) {
        setCaptures((prev) => prev.map((cap) => {
          if (!pokemon.includes(cap.pokemon.id)) {
            return cap;
          }
          return { ...cap, pending: true, captured: false };
        }));

        await createCapturesMutation.mutateAsync({
          username: user.username,
          slug,
          payload: { dex: dex.id, pokemon },
        });

        setCaptures((prev) => prev.map((cap) => {
          if (!pokemon.includes(cap.pokemon.id)) {
            return cap;
          }
          return { ...cap, pending: false, captured: true };
        }));
      }

      setImported(pokemon.length);
      ReactGA.event({ action: 'import from dexes', category: 'Captures' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="form-group">
      <button className="btn btn-blue" disabled={importing} onClick={handleButtonClick}>
        <span className={importing ? 'hidden' : ''}>
          {imported === null ? 'Import Caught From Other Dexes' : `Imported ${imported} Pokémon!`}
        </span>
        {importing ?
          <span className="spinner">
            <FontAwesomeIcon icon={faCircleNotch} spin />
          </span> :
          null
        }
      </button>
    </div>
  );
}
