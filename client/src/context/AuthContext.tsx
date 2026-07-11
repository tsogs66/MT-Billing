import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';

export interface User {
  id: number;
  username: string;
  role: string;
  permissions: string[];
  licenseActivated: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  canAccess: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

function normalizeUser(raw: any): User {
  return {
    id: raw.id,
    username: raw.username,
    role: raw.role,
    permissions: Array.isArray(raw.permissions) ? raw.permissions : ['dashboard', 'license'],
    licenseActivated: !!raw.licenseActivated,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const r = await api.get('/me');
    setUser(normalizeUser(r.data.user));
  };

  useEffect(() => {
    const token = localStorage.getItem('mt_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/me')
      .then((r) => setUser(normalizeUser(r.data.user)))
      .catch(() => localStorage.removeItem('mt_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api.post('/login', { username, password });
    localStorage.setItem('mt_token', r.data.token);
    setUser(normalizeUser(r.data.user));
  };

  const logout = () => {
    localStorage.removeItem('mt_token');
    setUser(null);
  };

  const canAccess = (permission: string) => {
    if (!user) return false;
    // Until licensed, only dashboard + license menus
    if (!user.licenseActivated) {
      return permission === 'dashboard' || permission === 'license';
    }
    if (user.permissions.includes('*')) return true;
    return user.permissions.includes(permission);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, refresh, canAccess }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
