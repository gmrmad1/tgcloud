import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  getClient, getMe, logout as tgLogout,
  loadCredentials, loadSession, saveCredentials,
} from '../services/telegram.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [creds, setCreds]     = useState(null); // { apiId, apiHash }

  // On mount: if we have saved creds + session, reconnect silently
  useEffect(() => {
    (async () => {
      try {
        const saved = loadCredentials();
        const session = loadSession();
        if (saved && session) {
          const client = await getClient(saved.apiId, saved.apiHash, session);
          const me = await getMe();
          setCreds(saved);
          setUser(me);
        }
      } catch {
        // Session expired or invalid — stay logged out
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback((apiId, apiHash, user) => {
    saveCredentials(apiId, apiHash);
    setCreds({ apiId, apiHash });
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try { await tgLogout(); } catch {}
    setUser(null);
    setCreds(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, creds, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
