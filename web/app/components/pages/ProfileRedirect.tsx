import { Redirect } from 'react-router-dom';

import { Config } from '../../../config';
import { useSession } from '../../hooks/contexts/use-session';

export function ProfileRedirect () {
  const { session } = useSession();

  if (session) {
    // If we have a session, redirect to the logged-in user's profile page.
    return <Redirect to={`/u/${session.username}`} />;
  }

  if (Config.LOCAL_MODE) {
    // The offline app signs into the local profile automatically; that
    // happens an instant after first render, so just wait for it.
    return <div className="loading">Loading...</div>;
  }

  // The user is not logged in yet, so we redirect them to the login page.
  return <Redirect to="/login" />;
}
