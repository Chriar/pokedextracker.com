import { createContext, useContext, useEffect, useMemo } from 'react';

import { Config } from '../../../config';
import { ensureLocalSession } from '../../local/local-api';
import { tokenToUser } from '../../utils/state';
import type { SetLocalStorageFn } from '../use-local-storage';
import { useLocalStorage } from '../use-local-storage';

import type { ReactNode } from 'react';
import type { Session, User } from '../../types';
import { useUser } from '../queries/users';

interface SessionContextState {
  session: Session | null;
  sessionUser: User | null;
  setToken: SetLocalStorageFn<string | null>;
}

const SessionContext = createContext<SessionContextState>({
  session: null,
  sessionUser: null,
  setToken: () => {},
});

interface Props {
  children: ReactNode;
}

export const SessionProvider = ({ children }: Props) => {
  const [token, setToken] = useLocalStorage<string | null>('token', { defaultValue: null });
  const session = useMemo(() => tokenToUser(token), [token]);
  const { data: sessionUser } = useUser(session?.username);

  // The offline app is accountless: create/load the local profile and sign
  // in automatically.
  useEffect(() => {
    if (Config.LOCAL_MODE && !token) {
      setToken(ensureLocalSession());
    }
  }, [token, setToken]);

  const contextValue = useMemo<SessionContextState>(() => ({
    session,
    sessionUser: sessionUser || null,
    setToken,
  }), [
    session,
    sessionUser,
    setToken,
  ]);

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  return useContext(SessionContext);
};
