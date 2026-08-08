import keyBy from 'lodash/keyBy';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';
import { useMemo } from 'react';
import { useParams } from 'react-router';

import { ReactGA } from '../../../utils/analytics';
import { duplicateKey } from '../../../utils/pokemon';
import { useCreateCapture } from '../../../hooks/queries/captures';
import { useSession } from '../../../hooks/contexts/use-session';
import { useTrackerContext } from './use-tracker';
import { useUser } from '../../../hooks/queries/users';

interface Props {
  hideDuplicateForms: boolean;
}

// Marks every duplicate occurrence of an already-caught pokemon as caught:
// catch it once in one sub-dex and this checks off its repeats in the others.
export function MarkDuplicatesButton ({ hideDuplicateForms }: Props) {
  const { username, slug } = useParams<{ username: string; slug: string }>();

  const { session } = useSession();
  const user = useUser(username).data!;
  const dex = useMemo(() => keyBy(user.dexes, 'slug')[slug], [user, slug]);

  const { captures, setCaptures } = useTrackerContext();

  const createCapturesMutation = useCreateCapture();

  // Uncaught entries whose species (+form) is caught somewhere else in the dex.
  const pokemon = useMemo(() => {
    const caughtKeys = new Set(
      captures.filter((capture) => capture.captured).map((capture) => duplicateKey(capture, hideDuplicateForms))
    );
    return captures
    .filter((capture) => !capture.captured && caughtKeys.has(duplicateKey(capture, hideDuplicateForms)))
    .map((capture) => capture.pokemon.id);
  }, [captures, hideDuplicateForms]);

  if (session?.id !== user.id) {
    return null;
  }

  const handleButtonClick = async () => {
    createCapturesMutation.reset();

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

    ReactGA.event({ action: 'mark duplicates', category: 'Duplicates' });
  };

  const isLoading = createCapturesMutation.isLoading;

  return (
    <button className="btn btn-blue" disabled={isLoading || pokemon.length === 0} onClick={handleButtonClick}>
      <span className={isLoading ? 'hidden' : ''}>Mark {pokemon.length > 0 ? `${pokemon.length} ` : ''}Duplicate{pokemon.length === 1 ? '' : 's'} Caught</span>
      {isLoading ?
        <span className="spinner">
          <FontAwesomeIcon icon={faCircleNotch} spin />
        </span> :
        null
      }
    </button>
  );
}
