import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { apiClient } from '../services/apiClient';
import { AuthStatusPage, safeReturnDestination } from './AuthStatusPage';

describe('Authentication pages', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getCurrentSession').mockResolvedValue({ authenticated: false, user: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects external, protocol-relative, and auth-loop return destinations', () => {
    expect(safeReturnDestination('/history?page=2#recent')).toBe('/history?page=2#recent');
    expect(safeReturnDestination('https://evil.example')).toBe('/app/overview');
    expect(safeReturnDestination('//evil.example')).toBe('/app/overview');
    expect(safeReturnDestination('/login')).toBe('/app/overview');
    expect(safeReturnDestination('/register')).toBe('/app/overview');
  });

  it('submits real login credentials, restores session, then navigates internally', async () => {
    vi.spyOn(apiClient, 'getCurrentSession')
      .mockResolvedValueOnce({ authenticated: false, user: null })
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: '42', email: 'user@example.test' },
        csrfToken: 'csrf-for-test',
      });
    const login = vi.spyOn(apiClient, 'login').mockResolvedValue({
      id: '42',
      email: 'user@example.test',
    });

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login?returnTo=%2Fhistory']}>
          <Routes>
            <Route path="/login" element={<AuthStatusPage kind="login" />} />
            <Route path="/history" element={<p>Protected history</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Protected history')).toBeTruthy();
    expect(login).toHaveBeenCalledWith('user@example.test', 'correct horse battery staple');
  });

  it('requires matching confirmation and navigates to sign-in only after server registration succeeds', async () => {
    const register = vi.spyOn(apiClient, 'register').mockResolvedValue({
      id: '43',
      email: 'new@example.test',
    });
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<AuthStatusPage kind="register" />} />
            <Route path="/login" element={<AuthStatusPage kind="login" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: 'Create your account' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-secure-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Passwords do not match.');

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account created. Sign in with your new credentials.')).toBeTruthy();
    expect(register).toHaveBeenCalledWith('new@example.test', 'a-long-secure-password');
  });

  it('submits password recovery request and shows success state', async () => {
    const requestReset = vi.spyOn(apiClient, 'requestPasswordReset').mockResolvedValue({
      success: true,
      message: 'If an account exists, instructions have been sent.',
    });

    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <Routes>
          <Route path="/forgot-password" element={<AuthStatusPage kind="forgot-password" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }));

    expect(await screen.findByText('Request received')).toBeTruthy();
    expect(requestReset).toHaveBeenCalledWith('user@example.com');
  });

  it('submits password reset with token and new password', async () => {
    const reset = vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({
      success: true,
      message: 'Password reset successful',
    });

    render(
      <MemoryRouter initialEntries={['/reset-password?token=test-reset-token']}>
        <Routes>
          <Route path="/reset-password" element={<AuthStatusPage kind="reset-password" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-valid-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-valid-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password reset successful!')).toBeTruthy();
    expect(reset).toHaveBeenCalledWith('test-reset-token', 'new-valid-password-123');
  });

  it('verifies email with provided token', async () => {
    const verify = vi.spyOn(apiClient, 'verifyEmail').mockResolvedValue({
      success: true,
      message: 'Email verified',
    });

    render(
      <MemoryRouter initialEntries={['/verify-email?token=valid-token-123']}>
        <Routes>
          <Route path="/verify-email" element={<AuthStatusPage kind="verify-email" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Email Verification' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    expect(await screen.findByText('Email verified successfully!')).toBeTruthy();
    expect(verify).toHaveBeenCalledWith('valid-token-123');
  });

  it('allows requesting a new verification link', async () => {
    const resend = vi.spyOn(apiClient, 'resendVerification').mockResolvedValue({
      success: true,
      message: 'Verification link resent',
    });

    render(
      <MemoryRouter initialEntries={['/verify-email']}>
        <Routes>
          <Route path="/verify-email" element={<AuthStatusPage kind="verify-email" />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'user@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification link' }));
    expect(await screen.findByText('Verification link resent')).toBeTruthy();
    expect(resend).toHaveBeenCalledWith('user@example.test');
  });

  it('displays error when password reset fails due to invalid or expired token', async () => {
    vi.spyOn(apiClient, 'resetPassword').mockRejectedValue(
      new Error('Password reset link has expired. Please request a new one.'),
    );

    render(
      <MemoryRouter initialEntries={['/reset-password?token=expired-token']}>
        <Routes>
          <Route path="/reset-password" element={<AuthStatusPage kind="reset-password" />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-valid-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-valid-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Password reset link has expired. Please request a new one.');
  });

  it('displays error when password recovery request fails', async () => {
    vi.spyOn(apiClient, 'requestPasswordReset').mockRejectedValue(
      new Error('Authentication is temporarily unavailable'),
    );

    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <Routes>
          <Route path="/forgot-password" element={<AuthStatusPage kind="forgot-password" />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Authentication is temporarily unavailable');
  });
  it('renders sign-in form with empty defaults, username autocomplete, and masked password', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<AuthStatusPage kind="login" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    const emailInput = (await screen.findByLabelText('Email address')) as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;

    // Fresh fields must be completely empty
    expect(emailInput.value).toBe('');
    expect(passwordInput.value).toBe('');

    // Must have autocomplete="username" and autocomplete="current-password"
    expect(emailInput.getAttribute('autocomplete')).toBe('username');
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');

    // Password must be masked
    expect(passwordInput.type).toBe('password');
  });

  it('renders create account form with empty defaults, email autocomplete, and new-password autocomplete', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/register" element={<AuthStatusPage kind="register" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    const emailInput = (await screen.findByLabelText('Email address')) as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;

    // Fresh fields must be completely empty
    expect(emailInput.value).toBe('');
    expect(passwordInput.value).toBe('');
    expect(confirmInput.value).toBe('');

    // Must have autocomplete="email" and autocomplete="new-password"
    expect(emailInput.getAttribute('autocomplete')).toBe('email');
    expect(passwordInput.getAttribute('autocomplete')).toBe('new-password');
    expect(confirmInput.getAttribute('autocomplete')).toBe('new-password');

    // Password fields must be masked
    expect(passwordInput.type).toBe('password');
    expect(confirmInput.type).toBe('password');
  });

  it('does not carry over typed values between sign-in and create account', async () => {
    const { unmount } = render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<AuthStatusPage kind="login" />} />
            <Route path="/register" element={<AuthStatusPage kind="register" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    const loginEmail = (await screen.findByLabelText('Email address')) as HTMLInputElement;
    fireEvent.change(loginEmail, { target: { value: 'typed-user@example.test' } });
    expect(loginEmail.value).toBe('typed-user@example.test');

    unmount();

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path="/login" element={<AuthStatusPage kind="login" />} />
            <Route path="/register" element={<AuthStatusPage kind="register" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    const registerEmail = (await screen.findByLabelText('Email address')) as HTMLInputElement;
    const registerPassword = screen.getByLabelText('Password') as HTMLInputElement;
    const registerConfirm = screen.getByLabelText('Confirm password') as HTMLInputElement;

    expect(registerEmail.value).toBe('');
    expect(registerPassword.value).toBe('');
    expect(registerConfirm.value).toBe('');
  });
});
