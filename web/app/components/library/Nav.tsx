import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Link } from 'react-router-dom';
import { faCaretDown, faCog, faMoon, faSignOutAlt, faSun, faTh, faUser } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';

import { Config } from '../../../config';
import { ReactGA } from '../../utils/analytics';
import { useLocalStorageContext } from '../../hooks/contexts/use-local-storage-context';
import { useSession } from '../../hooks/contexts/use-session';

export function Nav () {
  const { isNightMode, setIsNightMode } = useLocalStorageContext();
  const { session, sessionUser, setToken } = useSession();

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleNightModeClick = () => setIsNightMode(!isNightMode);

  const handleSignOutClick = () => {
    ReactGA.event({ action: 'sign out', category: 'Session' });
    setToken(null);
  };

  // The toggle must not be href="#": under the offline app's hash routing
  // that navigates to the home route, and touch devices have no hover to
  // open the menu with.
  const handleDropdownToggle = () => setDropdownOpen((open) => !open);

  if (session && !sessionUser) {
    return (
      <nav>
        <Link to="/">Pokédex Tracker</Link>
      </nav>
    );
  }

  const links = (
    <>
      <Link to="/">Pokédex Tracker</Link>
      <a className="tooltip tooltip-below" onClick={handleNightModeClick}>
        <FontAwesomeIcon icon={isNightMode ? faSun : faMoon} />
        <span className="tooltip-text">Night Mode {isNightMode ? 'Off' : 'On'}</span>
      </a>
      <a href="https://www.patreon.com/pokedextracker" rel="noopener noreferrer" target="_blank">Patreon</a>
    </>
  );

  if (session && sessionUser) {
    return (
      <nav>
        {links}
        <div className={`dropdown ${dropdownOpen ? 'open' : ''}`}>
          <a onClick={handleDropdownToggle}>{session.username} <FontAwesomeIcon icon={faCaretDown} /></a>
          <ul onClick={() => setDropdownOpen(false)}>
            <div className="dropdown-scroll">
              {sessionUser.dexes.map((dex) => <li key={dex.id}><Link to={`/u/${session.username}/${dex.slug}`}><FontAwesomeIcon icon={faTh} /> {dex.title}</Link></li>)}
            </div>
            <li><Link to={`/u/${session.username}`}><FontAwesomeIcon icon={faUser} /> Profile</Link></li>
            <li><Link to="/account"><FontAwesomeIcon icon={faCog} /> {Config.LOCAL_MODE ? 'Settings & Backup' : 'Account Settings'}</Link></li>
            {!Config.LOCAL_MODE && <li><a onClick={handleSignOutClick}><FontAwesomeIcon icon={faSignOutAlt} /> Sign Out</a></li>}
          </ul>
        </div>
      </nav>
    );
  }

  if (Config.LOCAL_MODE) {
    // The offline app has no accounts: the local profile is created
    // automatically, so login/register links make no sense here.
    return <nav>{links}</nav>;
  }

  return (
    <nav>
      {links}
      <Link to="/login">Login</Link>
      <Link to="/register">Register</Link>
    </nav>
  );
}
