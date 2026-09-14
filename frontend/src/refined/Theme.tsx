import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

export type Appearance = 'light' | 'dark' | 'system';
const KEY = 'authority-refined-appearance';
const Context = createContext<{ appearance: Appearance; dark: boolean; setAppearance: (value: Appearance) => void } | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => { try { const saved = localStorage.getItem(KEY); return saved === 'dark' || saved === 'system' ? saved : 'light'; } catch { return 'light'; } });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark);
  useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const update = () => setSystemDark(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, appearance); } catch { /* Theme remains available for this session. */ } }, [appearance]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    return () => { root.classList.toggle('dark', previous); };
  }, [dark]);
  return <Context.Provider value={{ appearance, dark, setAppearance }}>{children}</Context.Provider>;
}
export function useTheme() { const value = useContext(Context); if (!value) throw new Error('Missing ThemeProvider'); return value; }
