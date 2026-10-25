import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ThemeProvider } from '../theme';
import { apiClient } from '../services/apiClient';

describe('public landing page', () => {
  async function renderPublicSite() {
    const currentSession = vi.spyOn(apiClient, 'getCurrentSession')
      .mockResolvedValue({ authenticated: false, user: null });
    await act(async () => {
      render(
        <ThemeProvider>
          <MemoryRouter initialEntries={['/']}>
            <App />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });
    expect(currentSession).toHaveBeenCalledOnce();
    return currentSession;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
    window.localStorage.clear();
  });

  it('renders the public landing page without requesting operational data', async () => {
    const currentSession = await renderPublicSite();

    expect(await screen.findByRole('heading', { name: /see model change clearly/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /the context around every model decision/i })).toBeTruthy();
    expect(screen.getByText(/Illustrative preview · no live data/i)).toBeTruthy();
    expect(screen.getByText(/Candidate readiness is not deployment/i)).toBeTruthy();
    expect(currentSession).toHaveBeenCalledOnce();
  });

  it('uses working section, dashboard, and honest authentication-status destinations', async () => {
    await renderPublicSite();

    const publicNavigation = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(publicNavigation).getByRole('link', { name: 'Capabilities' }).getAttribute('href')).toBe('#capabilities');
    expect(within(publicNavigation).getByRole('link', { name: 'Workflow' }).getAttribute('href')).toBe('#workflow');
    expect(screen.getAllByRole('link', { name: /existing dashboard|explore the existing dashboard|open the existing dashboard/i })
      .every((link) => link.getAttribute('href') === '/app/overview')).toBe(true);
    expect(screen.getByRole('link', { name: 'Registration status' }).getAttribute('href')).toBe('/register');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'Create account' }).getAttribute('href')).toBe('/register');
  });

  it('keeps public navigation keyboard-focusable at a narrow viewport and toggles the shared theme', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    await renderPublicSite();

    const capabilitiesLink = within(screen.getByRole('navigation', { name: 'Public navigation' }))
      .getByRole('link', { name: 'Capabilities' });
    capabilitiesLink.focus();
    expect(document.activeElement).toBe(capabilitiesLink);
    expect(screen.getByRole('navigation', { name: 'Public navigation' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
