import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';

interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('mt_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/me')
      .then((r) => setUser(r.data.user))
      .catch(() => localStorage.removeItem('mt_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api.post('/login', { username, password });
    localStorage.setItem('mt_token', r.data.token);
    setUser(r.data.user);
  };

  const logout = () => {
    localStorage.removeItem('mt_token');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
