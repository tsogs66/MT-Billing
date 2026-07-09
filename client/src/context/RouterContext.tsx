import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';

export interface RouterDevice {
  id: number;
  name: string;
  host: string;
  board: string;
  type: string;
  status: string;
}

interface RouterCtx {
  routers: RouterDevice[];
  current: RouterDevice | null;
  setCurrent: (r: RouterDevice) => void;
  refresh: () => void;
}

const Ctx = createContext<RouterCtx>(null as unknown as RouterCtx);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [routers, setRouters] = useState<RouterDevice[]>([]);
  const [current, setCurrent] = useState<RouterDevice | null>(null);

  const refresh = () => {
    const token = localStorage.getItem('mt_token');
    if (!token) return;
    api.get('/routers').then((r) => {
      setRouters(r.data);
      setCurrent((prev) => prev || r.data[0] || null);
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Ctx.Provider value={{ routers, current, setCurrent, refresh }}>{children}</Ctx.Provider>
  );
}

export const useRouterDevice = () => useContext(Ctx);
