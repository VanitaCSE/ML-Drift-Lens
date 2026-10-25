import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ThemeProvider } from './theme';
import { apiClient, type CurrentSession } from './services/apiClient';

const authenticatedSession: CurrentSession = {
  authenticated: true,
  user: { id: 'test-user', email: 'user@example.test' },
  csrfToken: 'test-csrf-token',
};

describe('App shell and authentication routes', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getCurrentSession').mockResolvedValue(authenticatedSession);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the application navigation after restoring the session', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/app/overview']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );

    await screen.findByRole('heading', { name: /ML Model Performance Monitoring Platform/i });
    expect(screen.getAllByText(/ML-Drift-Lens/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Model monitoring and lifecycle visibility/i)).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'Application navigation' });
    expect(within(navigation).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Predictions' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'History' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Model Registry' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Retraining' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Evaluation' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Deployments' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'System Status' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Skip to application content' }).getAttribute('href')).toBe('#application-main');
    expect(screen.getByRole('button', { name: /switch to (light|dark) theme/i })).toBeTruthy();
  });

  it('navigates between protected application routes after session restoration', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/app/overview']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: /ML Model Performance Monitoring Platform/i });

    const navigation = screen.getByRole('navigation', { name: 'Application navigation' });
    const destinations = [
      { name: 'Predictions', heading: 'Network Intrusion Prediction' },
      { name: 'Drift monitoring', heading: 'Drift monitoring' },
      { name: 'History', heading: 'Prediction History' },
      { name: 'Model Registry', heading: 'Model Registry' },
      { name: 'Retraining', heading: 'Retraining Center' },
      { name: 'Evaluation', heading: 'Model Evaluation & Comparison' },
      { name: 'Deployments', heading: 'Deployments & Staging Readiness' },
      { name: 'System Status', heading: 'System Status' },
      { name: 'Overview', heading: 'ML Model Performance Monitoring Platform' },
    ];

    for (const destination of destinations) {
      fireEvent.click(within(navigation).getByRole('link', { name: destination.name }));
      expect((await screen.findAllByRole('heading', { name: destination.heading })).length).toBeGreaterThan(0);
      expect(within(navigation).getByRole('link', { name: destination.name }).getAttribute('aria-current')).toBe('page');
    }
  });

  it('exposes a theme toggle that updates the application root', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/app/overview']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: /ML Model Performance Monitoring Platform/i });

    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeTruthy();
  });

  it('redirects unauthenticated visitors from all protected routes to sign in', async () => {
    vi.spyOn(apiClient, 'getCurrentSession').mockResolvedValue({ authenticated: false, user: null });
    const protectedPaths = ['/app/overview', '/predictions', '/history', '/status', '/drift', '/models', '/retraining', '/evaluation', '/deployments'];
    for (const path of protectedPaths) {
      const { unmount } = render(
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ThemeProvider>,
      );
      await screen.findByRole('heading', { name: 'Sign in' });
      expect(screen.getByLabelText('Email address')).toBeTruthy();
      unmount();
    }
  });

  it('does not render a protected page while signed out and preserves its internal destination', async () => {
    vi.spyOn(apiClient, 'getCurrentSession').mockResolvedValue({ authenticated: false, user: null });
    const getMetrics = vi.spyOn(apiClient, 'getMetrics');
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/history?limit=10']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Prediction History' })).toBeNull();
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('signs out only after the backend confirms logout', async () => {
    vi.spyOn(apiClient, 'logout').mockResolvedValue();
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/app/overview']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: /ML Model Performance Monitoring Platform/i });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(apiClient.logout).toHaveBeenCalledOnce();
  });

  it('keeps signed-in state if the server logout request fails', async () => {
    vi.spyOn(apiClient, 'logout').mockRejectedValue(new Error('unavailable'));
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/app/overview']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: /ML Model Performance Monitoring Platform/i });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/Logout could not be confirmed/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /ML Model Performance Monitoring Platform/i })).toBeTruthy();
  });

  it('reports an unavailable session check and supports retry', async () => {
    const sessionRequest = vi.spyOn(apiClient, 'getCurrentSession')
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce(authenticatedSession);
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/app/overview']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: 'Session status is unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: /ML Model Performance Monitoring Platform/i });
    expect(sessionRequest).toHaveBeenCalledTimes(2);
  });

  it('provides working registration/login pages without recovery links on sign-in', async () => {
    vi.spyOn(apiClient, 'getCurrentSession').mockResolvedValue({ authenticated: false, user: null });
    const { unmount } = render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('link', { name: 'Password recovery' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Return to the public site' }));
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Password recovery' })).toBeNull();

    unmount();
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/verify-email']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Email Verification' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Password recovery' })).toBeNull();
  });
});
