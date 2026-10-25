import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Dashboard } from './components/Dashboard';
import { DriftMonitoring } from './components/DriftMonitoring';
import { AuthStatusPage, type AuthPageKind } from './components/AuthStatusPage';
import { PredictionForm } from './components/PredictionForm';
import { PredictionHistory } from './components/PredictionHistory';
import { LandingPage, PublicLayout } from './components/PublicSite';
import { SystemStatus } from './components/SystemStatus';
import { ModelRegistry } from './components/ModelRegistry';
import { RetrainingCenter } from './components/RetrainingCenter';
import { ModelEvaluation } from './components/ModelEvaluation';
import { Deployments } from './components/Deployments';
import { ThemeToggle } from './components/ThemeToggle';
import { apiClient } from './services/apiClient';
import './App.css';

const authRoutes: Array<{ kind: AuthPageKind; path: string }> = [
  { kind: 'login', path: '/login' },
  { kind: 'register', path: '/register' },
  { kind: 'forgot-password', path: '/forgot-password' },
  { kind: 'reset-password', path: '/reset-password' },
  { kind: 'verify-email', path: '/verify-email' },
];

function DashboardHeader() {
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelVersion, setModelVersion] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState('Checking status...');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([apiClient.getMetrics(), apiClient.getHealth(), apiClient.getReadiness()]).then(([metrics, health, readiness]) => {
      if (cancelled) return;
      if (metrics.status === 'fulfilled') {
        setModelId(metrics.value.model_id);
        setModelVersion(metrics.value.model_version);
      }
      const healthOk = health.status === 'fulfilled' && (health.value.status === 'healthy' || health.value.healthy !== false);
      const ready = readiness.status === 'fulfilled' && readiness.value.ready;
      setServiceStatus(healthOk && ready ? 'Operational' : 'Unavailable');
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <div className="topbar-title">ML-Drift-Lens</div>
        <div className="topbar-subtitle">Model monitoring and lifecycle visibility</div>
      </div>
      <div className="header-actions">
        <div className="header-model-meta">
          <span>Model ID <strong>{modelId || 'N/A'}</strong></span>
          <span>Version <strong>{modelVersion || 'N/A'}</strong></span>
        </div>
        <ThemeToggle />
      </div>
      <div className={`system-pill ${serviceStatus === 'Operational' ? 'healthy' : 'placeholder-status'}`}>
        <span className="status-dot" />
        {serviceStatus}
      </div>
    </header>
  );
}

function UnverifiedBanner({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleResend() {
    setError('');
    setPending(true);
    try {
      await apiClient.resendVerification(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification link');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="unverified-email-banner" role="status">
      <div className="unverified-banner-text">
        <span className="unverified-icon" aria-hidden="true">⚠️</span>
        <span>Your account email is unverified. Certain privileged model mutations require a verified email.</span>
      </div>
      <div className="unverified-banner-action">
        {sent ? (
          <span className="status-badge success">
            Verification link sent! {import.meta.env.DEV ? (
              <>(Local dev: <a href="/api/dev/email-preview" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>open preview</a>)</>
            ) : 'Check inbox.'}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleResend}
            disabled={pending}
          >
            {pending ? 'Sending…' : 'Resend verification link'}
          </button>
        )}
        {error && <span className="auth-error-inline">{error}</span>}
      </div>
    </div>
  );
}

function ApplicationShell({ children }: { children: ReactNode }) {
  const { auth, logout } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [logoutPending, setLogoutPending] = useState(false);

  async function handleLogout() {
    setLogoutError('');
    setLogoutPending(true);
    try {
      await logout();
    } catch {
      setLogoutError('Logout could not be confirmed. Your session may still be active; try again.');
    } finally {
      setLogoutPending(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="application-skip-link" href="#application-main">Skip to application content</a>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">ML</span>
            <div>
              <div className="brand-name">ML-Drift-Lens</div>
              <div className="brand-subtitle">Application</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Application navigation">
          <NavLink to="/app/overview" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">◫</span><span>Overview</span>
          </NavLink>
          <NavLink to="/predictions" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">◎</span><span>Predictions</span>
          </NavLink>
          <NavLink to="/drift" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">⌁</span><span>Drift monitoring</span>
          </NavLink>
          <NavLink to="/history" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">▣</span><span>History</span>
          </NavLink>
          <NavLink to="/models" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">⊞</span><span>Model Registry</span>
          </NavLink>
          <NavLink to="/retraining" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">↻</span><span>Retraining</span>
          </NavLink>
          <NavLink to="/evaluation" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">⇄</span><span>Evaluation</span>
          </NavLink>
          <NavLink to="/deployments" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">▲</span><span>Deployments</span>
          </NavLink>
          <NavLink to="/status" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">◌</span><span>System Status</span>
          </NavLink>
        </nav>
      </aside>

      <div className="main-panel">
        <DashboardHeader />
        <div className="application-account-bar">
          {auth.status === 'authenticated' && (
            <div className="account-bar-user-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="account-user-email">{auth.user.email}</span>
              {auth.user.email_verified === false && (
                <span className="status-badge warning" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                  Unverified
                </span>
              )}
            </div>
          )}
          <button type="button" onClick={handleLogout} disabled={logoutPending}>
            {logoutPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {auth.status === 'authenticated' && auth.user.email_verified === false && (
          <UnverifiedBanner email={auth.user.email} />
        )}
        {logoutError && <p className="application-logout-error" role="alert">{logoutError}</p>}

        <main className="content-area" id="application-main">
          {children}
        </main>
      </div>
    </div>
  );
}

function ProtectedApplication({ children }: { children: ReactNode }) {
  const { auth, refreshSession } = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') {
    return <main className="auth-route-state" role="status" aria-live="polite">Checking your session…</main>;
  }
  if (auth.status === 'error') {
    return (
      <main className="auth-route-state" aria-labelledby="auth-session-error-title">
        <h1 id="auth-session-error-title">Session status is unavailable</h1>
        <p role="alert">{auth.message}</p>
        <button type="button" onClick={() => void refreshSession()}>Try again</button>
        <p><a href="/login">Go to sign in</a></p>
      </main>
    );
  }
  if (auth.status === 'signedOut') {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <ApplicationShell>{children}</ApplicationShell>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        {authRoutes.map(({ kind, path }) => (
          <Route key={path} path={path} element={<AuthStatusPage kind={kind} />} />
        ))}
      </Route>
      <Route path="/dashboard" element={<Navigate to="/app/overview" replace />} />
      <Route path="/app/overview" element={<ProtectedApplication><Dashboard /></ProtectedApplication>} />
      <Route path="/drift" element={<ProtectedApplication><DriftMonitoring /></ProtectedApplication>} />
      <Route path="/predictions" element={<ProtectedApplication><PredictionForm /></ProtectedApplication>} />
      <Route path="/history" element={<ProtectedApplication><PredictionHistory /></ProtectedApplication>} />
      <Route path="/models" element={<ProtectedApplication><ModelRegistry /></ProtectedApplication>} />
      <Route path="/app/models" element={<Navigate to="/models" replace />} />
      <Route path="/retraining" element={<ProtectedApplication><RetrainingCenter /></ProtectedApplication>} />
      <Route path="/app/retraining" element={<Navigate to="/retraining" replace />} />
      <Route path="/evaluation" element={<ProtectedApplication><ModelEvaluation /></ProtectedApplication>} />
      <Route path="/app/evaluation" element={<Navigate to="/evaluation" replace />} />
      <Route path="/deployments" element={<ProtectedApplication><Deployments /></ProtectedApplication>} />
      <Route path="/app/deployments" element={<Navigate to="/deployments" replace />} />
      <Route path="/app/monitoring/drift" element={<Navigate to="/drift" replace />} />
      <Route path="/status" element={<ProtectedApplication><SystemStatus /></ProtectedApplication>} />
      <Route path="/app/system" element={<Navigate to="/status" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
