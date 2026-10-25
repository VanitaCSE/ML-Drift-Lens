import { useTheme } from '../theme';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}
