import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, THEME_STORAGE_KEY, useTheme } from './theme';

function ThemeSurface() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span>{theme} mode</span>
      <button type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>
        Toggle theme
      </button>
    </div>
  );
}

function renderThemeSurface() {
  return render(
    <ThemeProvider>
      <ThemeSurface />
    </ThemeProvider>,
  );
}

describe('theme foundation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: light)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('uses the operating-system preference when no explicit choice is saved', () => {
    renderThemeSurface();

    expect(screen.getByText('light mode')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('switches themes accessibly and persists the explicit choice across remounts', () => {
    const view = renderThemeSurface();
    const toggle = screen.getByRole('button', { name: 'Switch to dark theme' });
    expect(toggle.tagName).toBe('BUTTON');
    fireEvent.click(toggle);

    expect(screen.getByText('dark mode')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    view.unmount();
    renderThemeSurface();
    expect(screen.getByText('dark mode')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('uses a saved theme instead of the operating-system preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    renderThemeSurface();

    expect(screen.getByText('dark mode')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('starts in dark mode when the system preference is dark', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderThemeSurface();

    expect(screen.getByText('dark mode')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
