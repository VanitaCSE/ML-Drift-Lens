import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, getAuthErrorMessage } from '../auth/AuthContext';
import { apiClient } from '../services/apiClient';
import './AuthStatusPage.css';

export type AuthPageKind = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-email';

const applicationDefault = '/app/overview';
const authPaths = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']);

export function safeReturnDestination(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return applicationDefault;
  }
  if ([...value].some((character) => character.charCodeAt(0) < 32)) return applicationDefault;

  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin || authPaths.has(target.pathname)) {
      return applicationDefault;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return applicationDefault;
  }
}

function AuthForm({ kind }: { kind: 'login' | 'register' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { auth, login, register, refreshSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const returnTo = safeReturnDestination(searchParams.get('returnTo'));
  const isRegistration = kind === 'register';
  const registrationSucceeded = location.state !== null
    && typeof location.state === 'object'
    && 'registrationSucceeded' in location.state
    && location.state.registrationSucceeded === true;
  const registered = kind === 'login' && registrationSucceeded;

  useEffect(() => {
    if (auth.status === 'authenticated') {
      navigate(returnTo, { replace: true });
    }
  }, [auth.status, navigate, returnTo]);

  useEffect(() => {
    setEmail('');
    setPassword('');
    setConfirmation('');
    setError('');
  }, [kind]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (isRegistration && password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setPending(true);
    try {
      if (isRegistration) {
        await register(email, password);
        navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, {
          replace: true,
          state: { registrationSucceeded: true },
        });
      } else {
        await login(email, password);
        navigate(returnTo, { replace: true });
      }
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-status-card auth-form-card" aria-labelledby="auth-form-title">
      <div className="auth-card-header">
        <p className="public-eyebrow">Account access</p>
        <h1 id="auth-form-title">{isRegistration ? 'Create your account' : 'Sign in'}</h1>
        <p className="auth-status-description">
          {isRegistration
            ? 'Create a first-party ML-Drift-Lens account with your email and password.'
            : 'Sign in to access the monitoring dashboard and operational workflows.'}
        </p>
      </div>

      {registered && (
        <p className="auth-form-success" role="status">
          Account created. Sign in with your new credentials.
        </p>
      )}
      {auth.status === 'error' && (
        <div className="auth-form-error" role="alert">
          <p>Could not check your current session: {auth.message}</p>
          <button type="button" className="auth-inline-button" onClick={() => void refreshSession()}>
            Retry session check
          </button>
        </div>
      )}
      {error && <div className="auth-form-error" role="alert"><p>{error}</p></div>}

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-form-field">
          <label htmlFor="auth-email">Email address</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete={isRegistration ? 'email' : 'username'}
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="auth-form-field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={isRegistration ? 'new-password' : 'current-password'}
            required
            minLength={isRegistration ? 12 : undefined}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {isRegistration && (
          <div className="auth-form-field">
            <label htmlFor="auth-password-confirmation">Confirm password</label>
            <input
              id="auth-password-confirmation"
              name="password-confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
        )}

        <button className="auth-submit-button" type="submit" disabled={pending}>
          {pending ? (isRegistration ? 'Creating account…' : 'Signing in…') : (isRegistration ? 'Create account' : 'Sign in')}
        </button>
        <p className="auth-form-pending" role="status" aria-live="polite">
          {pending ? 'Please wait while the server completes your request.' : ''}
        </p>
      </form>

      <nav className="auth-card-footer" aria-label="Account access">
        <div className="auth-switch-prompt">
          {isRegistration ? (
            <>
              <span>Already have an account?</span>
              <Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="auth-switch-link">
                Sign in
              </Link>
            </>
          ) : (
            <>
              <span>Don&apos;t have an account?</span>
              <Link to={`/register?returnTo=${encodeURIComponent(returnTo)}`} className="auth-switch-link">
                Create an account
              </Link>
            </>
          )}
        </div>
        <div className="auth-footer-back">
          <Link to="/" className="auth-back-link">
            <span aria-hidden="true">←</span> Return to the public site
          </Link>
        </div>
      </nav>
    </section>
  );
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const res = await apiClient.requestPasswordReset(email);
      setSubmitted(true);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request password reset');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-status-card auth-form-card" aria-labelledby="forgot-password-title">
      <div className="auth-card-header">
        <p className="public-eyebrow">Account recovery</p>
        <h1 id="forgot-password-title">Reset your password</h1>
        <p className="auth-status-description">
          Enter the email address associated with your account and we will send you a link to reset your password.
        </p>
      </div>

      {submitted ? (
        <div className="auth-form-success" role="status">
          <strong>Request received</strong>
          <p>{message || 'If an account exists with that email address, password reset instructions have been sent.'}</p>
          {import.meta.env.DEV && (
            <p style={{ fontSize: '0.82rem', marginTop: '8px', opacity: 0.9 }}>
              Local dev mode: Simulated emails are captured in memory. Retrieve your link at <a href="/api/dev/email-preview" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>/api/dev/email-preview</a>.
            </p>
          )}
          <div className="auth-action-row" style={{ marginTop: '16px' }}>
            <Link to="/login" className="btn btn-secondary" style={{ display: 'inline-block', textAlign: 'center' }}>
              Return to sign in
            </Link>
          </div>
        </div>
      ) : (
        <>
          {error && <div className="auth-form-error" role="alert"><p>{error}</p></div>}
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-form-field">
              <label htmlFor="recovery-email">Email address</label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button className="auth-submit-button" type="submit" disabled={pending}>
              {pending ? 'Sending reset link…' : 'Send reset instructions'}
            </button>
          </form>
        </>
      )}

      <nav className="auth-card-footer" aria-label="Account recovery links">
        <div className="auth-switch-prompt">
          <Link to="/login" className="auth-switch-link">Sign in</Link>
          <span className="auth-separator">·</span>
          <Link to="/register" className="auth-switch-link">Create an account</Link>
        </div>
        <div className="auth-footer-back">
          <Link to="/" className="auth-back-link">
            <span aria-hidden="true">←</span> Return to the public site
          </Link>
        </div>
      </nav>
    </section>
  );
}

function ResetPasswordForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') || '';
  const [token, setToken] = useState(urlToken);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('Password reset token is required.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setPending(true);
    try {
      await apiClient.resetPassword(token.trim(), password);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-status-card auth-form-card" aria-labelledby="reset-password-title">
      <div className="auth-card-header">
        <p className="public-eyebrow">Account recovery</p>
        <h1 id="reset-password-title">Choose a new password</h1>
        <p className="auth-status-description">
          Enter your reset token and new password. Passwords must be at least 12 characters.
        </p>
      </div>

      {submitted ? (
        <div className="auth-form-success" role="status">
          <strong>Password reset successful!</strong>
          <p>Your password has been securely updated. You can now sign in with your new credentials.</p>
          <div className="auth-action-row" style={{ marginTop: '16px' }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
              Sign in now
            </button>
          </div>
        </div>
      ) : (
        <>
          {error && <div className="auth-form-error" role="alert"><p>{error}</p></div>}
          <form className="auth-form" onSubmit={handleSubmit}>
            {!urlToken && (
              <div className="auth-form-field">
                <label htmlFor="reset-token">Reset token</label>
                <input
                  id="reset-token"
                  name="token"
                  type="text"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            )}

            <div className="auth-form-field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="auth-form-field">
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
                id="confirm-new-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>

            <button className="auth-submit-button" type="submit" disabled={pending}>
              {pending ? 'Updating password…' : 'Update password'}
            </button>
          </form>
        </>
      )}

      <nav className="auth-card-footer" aria-label="Password reset links">
        <div className="auth-switch-prompt">
          <Link to="/login" className="auth-switch-link">Sign in</Link>
          <span className="auth-separator">·</span>
          <Link to="/register" className="auth-switch-link">Create an account</Link>
        </div>
        <div className="auth-footer-back">
          <Link to="/" className="auth-back-link">
            <span aria-hidden="true">←</span> Return to the public site
          </Link>
        </div>
      </nav>
    </section>
  );
}

function VerifyEmailForm() {
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token') || '';
  const [token, setToken] = useState(urlToken);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifyPending, setVerifyPending] = useState(false);

  const [resendEmail, setResendEmail] = useState('');
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');
  const [resendPending, setResendPending] = useState(false);

  async function handleVerify(e?: FormEvent) {
    if (e) e.preventDefault();
    if (!token.trim()) return;
    setVerifyError('');
    setVerifyPending(true);
    try {
      await apiClient.verifyEmail(token.trim());
      setVerified(true);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifyPending(false);
    }
  }

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    setResendError('');
    setResendPending(true);
    try {
      const res = await apiClient.resendVerification(resendEmail);
      setResendMessage(res.message);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Resend verification failed');
    } finally {
      setResendPending(false);
    }
  }

  return (
    <section className="auth-status-card auth-form-card" aria-labelledby="verify-email-title">
      <div className="auth-card-header">
        <p className="public-eyebrow">Account verification</p>
        <h1 id="verify-email-title">Email Verification</h1>
        <p className="auth-status-description">
          Verify your email address to ensure full account access and enable protected model mutations.
        </p>
      </div>

      {verified ? (
        <div className="auth-form-success auth-status-banner" role="status">
          <div className="auth-banner-heading">
            <span className="auth-banner-icon" aria-hidden="true">✓</span>
            <strong>Email verified successfully!</strong>
          </div>
          <p>Your email address has been verified. You now have full access to ML-Drift-Lens.</p>
          <div className="auth-action-row" style={{ marginTop: '18px' }}>
            <Link to="/login" className="btn btn-primary" style={{ display: 'inline-block', textAlign: 'center' }}>
              Sign in to your account
            </Link>
            <Link to="/app/overview" className="btn btn-secondary" style={{ display: 'inline-block', textAlign: 'center' }}>
              Go to Overview
            </Link>
          </div>
        </div>
      ) : (
        <>
          {verifyError && (
            <div className="auth-form-error auth-status-banner" role="alert">
              <div className="auth-banner-heading">
                <span className="auth-banner-icon" aria-hidden="true">⚠</span>
                <strong>Verification unsuccessful</strong>
              </div>
              <p>{verifyError}</p>
              {verifyError.toLowerCase().includes('expired') ? (
                <p className="auth-status-hint">
                  Your verification token has expired. Request a new link using the form below.
                </p>
              ) : (
                <p className="auth-status-hint">
                  Check that your token was copied completely, or request a fresh link below.
                </p>
              )}
            </div>
          )}

          <form className="auth-form" onSubmit={handleVerify}>
            <div className="auth-form-field">
              <label htmlFor="verify-token">Verification token</label>
              <input
                id="verify-token"
                name="token"
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <button className="auth-submit-button" type="submit" disabled={verifyPending || !token.trim()}>
              {verifyPending ? 'Verifying email…' : 'Verify email'}
            </button>
          </form>

          <div className="auth-card-divider" />

          <div className="resend-section">
            <h2 className="resend-heading">Need a new verification link?</h2>
            <p className="resend-description">
              Enter the email address registered with your account to receive a new link.
            </p>
            {resendMessage && <div className="auth-form-success" role="status"><p>{resendMessage}</p></div>}
            {resendError && <div className="auth-form-error" role="alert"><p>{resendError}</p></div>}
            <form className="auth-form" onSubmit={handleResend}>
              <div className="auth-form-field">
                <label htmlFor="resend-email">Account email</label>
                <input
                  id="resend-email"
                  name="email"
                  type="email"
                  required
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                />
              </div>
              <button className="btn btn-secondary auth-resend-button" type="submit" disabled={resendPending}>
                {resendPending ? 'Sending verification link…' : 'Resend verification link'}
              </button>
            </form>
          </div>
        </>
      )}

      <nav className="auth-card-footer" aria-label="Account help">
        <div className="auth-switch-prompt">
          <span>Need account access?</span>
          <Link to="/login" className="auth-switch-link">Sign in</Link>
          <span className="auth-separator">·</span>
          <Link to="/register" className="auth-switch-link">Create an account</Link>
        </div>
        <div className="auth-footer-back">
          <Link to="/" className="auth-back-link">
            <span aria-hidden="true">←</span> Return to the public site
          </Link>
        </div>
      </nav>
    </section>
  );
}

export function AuthStatusPage({ kind }: { kind: AuthPageKind }) {
  return (
    <main className="auth-status-main" id="public-main">
      {kind === 'login' || kind === 'register' ? (
        <AuthForm key={kind} kind={kind} />
      ) : kind === 'forgot-password' ? (
        <ForgotPasswordForm />
      ) : kind === 'reset-password' ? (
        <ResetPasswordForm />
      ) : (
        <VerifyEmailForm />
      )}
    </main>
  );
}
