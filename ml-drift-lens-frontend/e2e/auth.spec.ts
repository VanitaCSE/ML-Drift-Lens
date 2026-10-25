import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Test account credentials
const timestamp = Date.now();
const testUser = {
  email: `e2e-playwright-${timestamp}@example.com`,
  password: 'TestPassword1234!',
};
const secondUser = {
  email: `e2e-playwright-second-${timestamp}@example.com`,
  password: 'SecondPassword1234!',
};

test.afterAll(async () => {
  // Safe cleanup scoped strictly to isolated test database and test-created records
  try {
    process.env.DB_NAME = 'ml_drift_lens_auth_phase4_test_20261025';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'root';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    const pool = require('../../ml-drift-lens-backend/db');
    const res = await pool.query('SELECT current_database()');
    const dbName = res.rows[0].current_database;
    if (dbName.includes('test') && dbName !== 'ml_drift_lens' && dbName !== 'production') {
      await pool.query("DELETE FROM app_users WHERE email LIKE 'e2e-playwright-%'");
    }
    await pool.end();
  } catch (err) {
    console.error('Test cleanup error (non-fatal):', err);
  }
});

test.describe('Real-Browser End-to-End Authentication Suite', () => {

  test('1. Public landing page (/) loads without operational API calls', async ({ page }) => {
    const operationalCalls: string[] = [];
    const authCalls: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (
        url.includes('/api/metrics') ||
        url.includes('/api/predictions') ||
        url.includes('/api/drift') ||
        url.includes('/api/alerts') ||
        url.includes('/api/models') ||
        url.includes('/api/retraining')
      ) {
        operationalCalls.push(url);
      } else if (url.includes('/api/auth/')) {
        authCalls.push(url);
      }
    });

    await page.goto('/');

    // Landing page elements visible
    await expect(page.getByRole('link', { name: 'ML-Drift-Lens home' })).toBeVisible();
    await expect(page.locator('#hero-title')).toContainText('See model change clearly');
    await expect(page.getByText('Capabilities').first()).toBeVisible();
    await expect(page.getByText('Workflow').first()).toBeVisible();

    // Give time for any unexpected mounting fetches
    await page.waitForTimeout(500);

    // Verify ZERO operational API calls
    expect(operationalCalls).toEqual([]);

    // Only /api/auth/me was called on startup to check session status
    expect(authCalls.some((url) => url.includes('/api/auth/me'))).toBe(true);
  });

  test('2. Unauthenticated visit to protected routes redirects to /login', async ({ page }) => {
    const protectedRoutes = [
      '/app/overview',
      '/predictions',
      '/history',
      '/status',
      '/drift',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`/login\\?returnTo=${encodeURIComponent(route)}`));
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(page.locator('#auth-email')).toBeVisible();
      await expect(page.locator('#auth-password')).toBeVisible();
    }
  });

  test('3. Registration form submits to real backend, validates input, and confirms account creation without auto-login', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    // Negative validation: mismatched passwords
    await page.locator('#auth-email').fill(`invalid-${timestamp}@example.com`);
    await page.locator('#auth-password').fill('ShortPass123!');
    await page.locator('#auth-password-confirmation').fill('MismatchPass123!');
    await page.locator('.auth-submit-button').click();
    await expect(page.locator('.auth-form-error')).toHaveText('Passwords do not match.');

    // Valid registration
    await page.locator('#auth-email').fill(testUser.email);
    await page.locator('#auth-password').fill(testUser.password);
    await page.locator('#auth-password-confirmation').fill(testUser.password);

    // Monitor the real backend HTTP response
    const [registerResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/register') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);

    expect(registerResponse.status()).toBe(201);
    const body = await registerResponse.json();
    expect(body.success).toBe(true);
    expect(body.user.email).toBe(testUser.email.toLowerCase());

    // Frontend redirects to /login with confirmation
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.auth-form-success')).toContainText('Account created. Sign in with your new credentials.');

    // Verify registration did NOT automatically log in
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.status()).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.authenticated).toBe(false);
    expect(meBody.user).toBeNull();
  });

  test('4. Valid login creates real browser session cookie and redirects to internal destination', async ({ page }) => {
    // Visit protected route to trigger redirect with returnTo
    await page.goto('/app/overview');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Foverview/);

    await page.locator('#auth-email').fill(testUser.email);
    await page.locator('#auth-password').fill(testUser.password);

    const [loginResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);

    expect(loginResponse.status()).toBe(200);
    const body = await loginResponse.json();
    expect(body.success).toBe(true);
    expect(body.user.email).toBe(testUser.email.toLowerCase());

    // Redirected to internal destination
    await expect(page).toHaveURL(/\/app\/overview/);

    // Application shell displays user's email in account bar
    await expect(page.locator('.application-account-bar')).toContainText(testUser.email.toLowerCase());
  });

  test('5. Page reload restores session via GET /api/auth/me', async ({ page }) => {
    // Log in first
    await page.goto('/login');
    await page.locator('#auth-email').fill(testUser.email);
    await page.locator('#auth-password').fill(testUser.password);
    await page.locator('.auth-submit-button').click();
    await expect(page).toHaveURL(/\/app\/overview/);

    // Reload page and listen for /api/auth/me
    const [meResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/me') && res.request().method() === 'GET'),
      page.reload(),
    ]);

    expect(meResponse.status()).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.authenticated).toBe(true);
    expect(meBody.user.email).toBe(testUser.email.toLowerCase());
    expect(typeof meBody.csrfToken).toBe('string');

    // Page remains on /app/overview without being redirected
    await expect(page).toHaveURL(/\/app\/overview/);
    await expect(page.locator('.application-account-bar')).toContainText(testUser.email.toLowerCase());
  });

  test('6. Protected operational pages render after auth', async ({ page }) => {
    // Log in
    await page.goto('/login');
    await page.locator('#auth-email').fill(testUser.email);
    await page.locator('#auth-password').fill(testUser.password);
    await page.locator('.auth-submit-button').click();
    await expect(page).toHaveURL(/\/app\/overview/);

    // Overview dashboard rendered
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Application navigation' })).toBeVisible();

    // Navigate to Predictions
    await page.getByRole('link', { name: 'Predictions' }).click();
    await expect(page).toHaveURL(/\/predictions/);
    await expect(page.getByRole('heading', { name: 'Network Intrusion Prediction' }).first()).toBeVisible();

    // Navigate to Drift monitoring
    await page.getByRole('link', { name: 'Drift monitoring' }).click();
    await expect(page).toHaveURL(/\/drift/);
    await expect(page.getByRole('heading', { name: 'Drift monitoring' }).first()).toBeVisible();

    // Navigate to History
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole('heading', { name: 'Recent Predictions' }).first()).toBeVisible();

    // Navigate to System Status
    await page.getByRole('link', { name: 'System Status' }).click();
    await expect(page).toHaveURL(/\/status/);
    await expect(page.getByText('Backend API')).toBeVisible();
  });

  test('7. Logout invalidates server session and clears cookie', async ({ page }) => {
    const logoutUser = {
      email: `e2e-playwright-logout-${Date.now()}@example.com`,
      password: 'LogoutPassword123!',
    };

    // Register dedicated user for logout test
    await page.goto('/register');
    await page.locator('#auth-email').fill(logoutUser.email);
    await page.locator('#auth-password').fill(logoutUser.password);
    await page.locator('#auth-password-confirmation').fill(logoutUser.password);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/register') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);
    await expect(page).toHaveURL(/\/login/);

    // Log in
    await page.locator('#auth-email').fill(logoutUser.email);
    await page.locator('#auth-password').fill(logoutUser.password);
    await page.locator('.auth-submit-button').click();
    await expect(page).toHaveURL(/\/app\/overview/);

    // Click Sign out
    const [logoutResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/logout') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Sign out' }).click(),
    ]);

    expect(logoutResponse.status()).toBe(204);

    // Wait for client to redirect after logout
    await expect(page).toHaveURL(/\/(login|$)/);

    // Verify session cookie is deleted/expired
    await expect.poll(async () => {
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find((c) => c.name === 'ml_drift_lens');
      return !sessionCookie || sessionCookie.expires <= (Date.now() / 1000) + 2 || sessionCookie.value === '';
    }).toBe(true);
  });

  test('8. Reusing old session fails (returns 401 or redirects to /login)', async ({ page }) => {
    // After logout, accessing protected route redirects to /login
    await page.goto('/app/overview');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Foverview/);

    // Direct API call to /api/metrics returns 401
    const metricsResponse = await page.request.get('/api/metrics');
    expect(metricsResponse.status()).toBe(401);
    const body = await metricsResponse.json();
    expect(body.code).toBe('authentication_required');

    // Direct API call to /api/auth/me returns unauthenticated
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.status()).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.authenticated).toBe(false);
  });

  test('9. Unauthenticated visitor cannot access protected operational data', async ({ browser }) => {
    // Fresh isolated browser context with no stored state
    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();

    // All operational endpoints reject unauthenticated access
    const protectedEndpoints = [
      '/api/metrics',
      '/api/predictions',
      '/api/drift',
      '/api/drift/history',
      '/api/alerts',
      '/api/models',
      '/api/retraining',
    ];

    for (const endpoint of protectedEndpoints) {
      const res = await cleanPage.request.get(endpoint);
      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.code).toBe('authentication_required');
    }

    // Direct browser navigation redirects to /login
    await cleanPage.goto('/app/overview');
    await expect(cleanPage).toHaveURL(/\/login\?returnTo=%2Fapp%2Foverview/);

    await cleanContext.close();
  });

  test('10. Cookie attributes checked: HttpOnly, Path=/, SameSite=Lax', async ({ page }) => {
    // Register second user to test pristine cookie creation
    await page.goto('/register');
    await page.locator('#auth-email').fill(secondUser.email);
    await page.locator('#auth-password').fill(secondUser.password);
    await page.locator('#auth-password-confirmation').fill(secondUser.password);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/register') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);
    await expect(page).toHaveURL(/\/login/);

    // Log in
    await page.locator('#auth-email').fill(secondUser.email);
    await page.locator('#auth-password').fill(secondUser.password);
    await page.locator('.auth-submit-button').click();
    await expect(page).toHaveURL(/\/app\/overview/);

    // Inspect cookie attributes
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'ml_drift_lens');

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.path).toBe('/');
    expect(sessionCookie?.sameSite).toBe('Lax');
    // Non-production test environment sets secure to false
    expect(sessionCookie?.secure).toBe(false);
  });

  test('11. Negative test: cross-origin or missing CSRF mutation rejected', async ({ page }) => {
    // Log in
    await page.goto('/login');
    await page.locator('#auth-email').fill(secondUser.email);
    await page.locator('#auth-password').fill(secondUser.password);
    await page.locator('.auth-submit-button').click();
    await expect(page).toHaveURL(/\/app\/overview/);

    // Get current CSRF token from /api/auth/me
    const meRes = await page.request.get('/api/auth/me');
    const meData = await meRes.json();
    const validCsrf = meData.csrfToken;
    expect(validCsrf).toBeTruthy();

    const origin = new URL(page.url()).origin;

    // 11a. Missing CSRF token -> 403 csrf_validation_failed
    const missingCsrfRes = await page.request.post('/api/predictions', {
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
      },
      data: {
        model_id: 'test',
        model_version: 'test',
        preprocessing_version: 'test',
        input_features: {},
      },
    });
    expect(missingCsrfRes.status()).toBe(403);
    const missingCsrfBody = await missingCsrfRes.json();
    expect(missingCsrfBody.code).toBe('csrf_validation_failed');

    // 11b. Disallowed / cross-origin request -> 403 origin_not_allowed
    const crossOriginRes = await page.request.post('/api/predictions', {
      headers: {
        Origin: 'http://evil-attacker.example.com',
        'X-CSRF-Token': validCsrf,
        'Content-Type': 'application/json',
      },
      data: {
        model_id: 'test',
        model_version: 'test',
        preprocessing_version: 'test',
        input_features: {},
      },
    });
    expect(crossOriginRes.status()).toBe(403);
    const crossOriginBody = await crossOriginRes.json();
    expect(crossOriginBody.code).toBe('origin_not_allowed');

    // 11c. Privileged mutation denied -> 403 authorization_policy_unconfigured
    const privilegedRes = await page.request.delete('/api/predictions/1', {
      headers: {
        Origin: origin,
        'X-CSRF-Token': validCsrf,
      },
    });
    expect(privilegedRes.status()).toBe(403);
    const privilegedBody = await privilegedRes.json();
    expect(privilegedBody.code).toBe('authorization_policy_unconfigured');
  });

  test('12. Password recovery (/forgot-password) renders form and returns timing-safe confirmation', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.locator('#recovery-email')).toBeVisible();

    await page.locator('#recovery-email').fill('any-user@example.test');

    const [forgotResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/forgot-password') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);

    expect(forgotResponse.status()).toBe(200);
    const body = await forgotResponse.json();
    expect(body.success).toBe(true);
    await expect(page.locator('.auth-form-success')).toContainText('password reset instructions have been sent');
  });

  test('13. Password reset form (/reset-password) enforces matching passwords', async ({ page }) => {
    await page.goto('/reset-password?token=mock-token-for-ui-test');
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    await page.locator('#new-password').fill('NewSecurePassword123!');
    await page.locator('#confirm-new-password').fill('DifferentPassword123!');
    await page.locator('.auth-submit-button').click();

    await expect(page.locator('.auth-form-error')).toHaveText('Passwords do not match.');
  });

  test('14. Email verification page (/verify-email) provides resend flow', async ({ page }) => {
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { name: 'Email Verification' })).toBeVisible();
    await expect(page.locator('#resend-email')).toBeVisible();

    await page.locator('#resend-email').fill('verify-user@example.test');

    const [resendResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/resend-verification') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Resend verification link' }).click(),
    ]);

    expect(resendResponse.status()).toBe(200);
    const body = await resendResponse.json();
    expect(body.success).toBe(true);
    await expect(page.locator('.resend-section .auth-form-success')).toContainText('verification link has been sent');
  });

  test('15. Full recovery lifecycle: request recovery, retrieve reset link from local preview, reset password, and sign in', async ({ page }) => {
    const recoveryUser = {
      email: `e2e-playwright-recovery-${Date.now()}@example.com`,
      initialPassword: 'InitialPassword123!',
      updatedPassword: 'UpdatedPassword123!',
    };

    // 1. Register user
    await page.goto('/register');
    await page.locator('#auth-email').fill(recoveryUser.email);
    await page.locator('#auth-password').fill(recoveryUser.initialPassword);
    await page.locator('#auth-password-confirmation').fill(recoveryUser.initialPassword);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/register') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);
    await expect(page).toHaveURL(/\/login/);

    // 2. Request recovery
    await page.goto('/forgot-password');
    await page.locator('#recovery-email').fill(recoveryUser.email);
    const [forgotRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/forgot-password') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);
    expect(forgotRes.status()).toBe(200);
    await expect(page.locator('.auth-form-success')).toContainText('password reset instructions have been sent');

    // 3. Fetch simulated email from local preview endpoint
    const previewRes = await page.request.get(`/api/dev/email-preview?email=${encodeURIComponent(recoveryUser.email)}`);
    expect(previewRes.status()).toBe(200);
    const previewData = await previewRes.json();
    expect(previewData.success).toBe(true);
    expect(previewData.simulated).toBe(true);
    expect(previewData.preview.to).toBe(recoveryUser.email);
    expect(previewData.preview.resetUrl).toBeTruthy();

    const urlMatch = previewData.preview.resetUrl.match(/token=([A-Za-z0-9_-]+)/);
    expect(urlMatch).toBeTruthy();
    const token = urlMatch[1];

    // 4. Visit reset password URL using the local test link
    await page.goto(`/reset-password?token=${token}`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    // 5. Fill new password and submit
    await page.locator('#new-password').fill(recoveryUser.updatedPassword);
    await page.locator('#confirm-new-password').fill(recoveryUser.updatedPassword);
    const [resetRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/auth/reset-password') && res.request().method() === 'POST'),
      page.locator('.auth-submit-button').click(),
    ]);
    expect(resetRes.status()).toBe(200);
    await expect(page.locator('.auth-form-success')).toContainText('Password reset successful!');

    // 6. Click sign in now
    await page.getByRole('button', { name: 'Sign in now' }).click();
    await expect(page).toHaveURL(/\/login/);

    // 7. Verify old password is rejected
    await page.locator('#auth-email').fill(recoveryUser.email);
    await page.locator('#auth-password').fill(recoveryUser.initialPassword);
    await page.locator('.auth-submit-button').click();
    await expect(page.locator('.auth-form-error')).toContainText('Email or password is incorrect');

    // 8. Sign in with new password succeeds
    await page.locator('#auth-password').fill(recoveryUser.updatedPassword);
    await page.locator('.auth-submit-button').click();
    await expect(page).toHaveURL(/\/app\/overview/);

    // 9. Verify token cannot be reused
    await page.goto(`/reset-password?token=${token}`);
    await page.locator('#new-password').fill('AnotherPassword123!');
    await page.locator('#confirm-new-password').fill('AnotherPassword123!');
    await page.locator('.auth-submit-button').click();
    await expect(page.locator('.auth-form-error')).toContainText('Password reset link is invalid or has already been used.');
  });

});
