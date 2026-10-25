import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const THEME_STORAGE_KEY = 'ml-drift-lens-theme';

export type Theme = 'light' | 'dark';
type ThemePreference = Theme | 'system';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): Theme {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function getInitialPreference(): ThemePreference {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  } catch (error) {
    console.warn('Unable to read the saved theme preference.', error);
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);
  const theme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'light' : 'dark');
    };

    setSystemTheme(mediaQuery.matches ? 'light' : 'dark');
    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (preference === 'system') return;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch (error) {
      console.error('Unable to save the theme preference.', error);
    }
  }, [preference, theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    toggleTheme: () => setPreference(theme === 'dark' ? 'light' : 'dark'),
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider.');
  return context;
}
