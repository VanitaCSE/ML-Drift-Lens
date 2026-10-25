# ML-Drift-Lens Frontend Implementation Blueprint

**Audit date:** 2026-10-25

**Scope:** Source-backed implementation and integration blueprint. Current auth state is recorded in the native authentication section below; earlier OIDC-first planning is superseded.

## Authoritative master roadmap

The project's seven-phase roadmap remains authoritative:

| Master phase | Scope | Current evidence/status |
|---|---|---|
| 1 | Product and codebase audit | Audit and API boundaries documented in this blueprint. |
| 2 | User journeys and information architecture | Public and application route structure exists; open registration and shared-data visibility are approved, but privileged role policy remains undecided. |
| 3 | Design system and prototypes | Shared light/dark theme, public shell, and application shell are implemented and locally verified. |
| 4 | Authentication and application shell | **COMPLETE.** Backend first-party native auth and PostgreSQL-backed hashed sessions, real frontend forms/session restoration/logout/route guards, and session checks on operational reads and prediction writes are fully implemented and verified. Isolated PostgreSQL persistence across Express reinitialization AND real backend process restart passes. Real-browser Playwright E2E suite passes all 11 flows against real application HTTP endpoints and isolated test database `ml_drift_lens_auth_phase4_test_20261025`. Privileged mutations fail closed with 403 `authorization_policy_unconfigured` pending future policy. Render proxy, cookie, and production configuration are statically verified. |
| 5 | Monitoring and operational pages | **COMPLETE.** Overview Dashboard, Drift Monitoring, System Status, Prediction Submission, and Prediction History are implemented, guarded, and verified with unmasked status reporting and truthful data representations. |
| 6 | Model lifecycle and deployment | **IMPLEMENTED & LOCALLY VERIFIED.** Model Registry, Retraining Center, Model Evaluation, and Deployments status pages are implemented and protected in the application shell. Real-time active model metadata, version history, head-to-head evaluation comparison, and honest unconfigured cloud status (disabled redeploy action) are verified without data fabrication. All privileged mutations remain fail-closed at 403. |
| 7 | Product polish, account management, QA and release readiness | **IMPLEMENTED & VERIFIED.** Complete application redesign applied across all 10 pages; Model Evaluation rewritten with comparison arena, evaluation gates, and truthful metrics; account recovery (`/forgot-password`, `/reset-password`), email delivery abstraction, and email verification (`/verify-email`, `/resend-verification`) fully implemented with additive migration `012_account_recovery_and_verification.sql`, SHA-256 token hashing, Argon2id hashing, and PostgreSQL session revocation. 111 backend unit tests, 3 PostgreSQL integration tests, 70 frontend Vitest tests across 15 suites, TypeScript build, and 14 real-browser Playwright E2E tests pass. |

The numbered implementation tasks in later sections are supporting work breakdowns, not replacements for this master roadmap.

## Executive summary

The active frontend is the Vite + React 18 + TypeScript application in `ml-drift-lens-frontend/`. It is a working, browser-routed monitoring UI—not a blank starter. The public landing page is at `/`; the application shell preserves the overview, prediction, history, status, and read-only drift-history views. The API client and pages do not yet integrate the new backend authentication contract.

The overview aggregates backend metrics, drift history, alerts, model versions, retraining jobs, and recent predictions, with automatic refresh and section-level loading/error/empty states. Operational data is fetched only after session restoration and backend session checks. The dashboard and system-status views use real health/readiness/model APIs. The shared application and public shells support the existing light/dark theme provider and toggle.

The backend provides first-party email/password registration/login, PostgreSQL-backed hashed session identifiers, logout, and current-session retrieval. The frontend implements registration and login forms, session restoration, logout, and protected operational routes. Open registration allows any registered account to view the shared global monitoring/model/retraining/prediction dataset and submit predictions, as explicitly approved; there is no per-user ownership or tenant isolation. Sensitive mutations remain blocked pending explicit permissions. Recovery/reset/verification remain informational. Local isolated PostgreSQL lifecycle tests pass, but Render and real-browser authentication E2E have not been run. Drift monitoring remains read-only; the Render staging client is not an operational deployment feature.

### Native authentication foundation (2026-10-25)

The approved project direction is first-party application accounts, not OIDC/OAuth. The backend uses `argon2` (Argon2id), `express-session`, `connect-pg-simple`, and PostgreSQL; Redis remains unrelated event-stream infrastructure. The additive schema is `ml-drift-lens-backend/migrations/011_native_authentication.sql` (`app_users` and `user_sessions`). The PostgreSQL session store is configured not to create its own table, so apply the migration before use. The session-store adapter SHA-256 hashes the express-session identifier before it reaches PostgreSQL. Browser sessions remain signed opaque cookie identifiers; session contents are kept server-side.

| Endpoint | Contract |
|---|---|
| `POST /api/auth/register` | JSON `{ "email": "...", "password": "..." }`; trims/lowercases email, requires a valid email and 12–128 password characters (up to 1024 UTF-8 bytes); returns `201 { "success": true, "user": { "id", "email" } }`. Duplicate normalized email returns generic `409 email_unavailable`. Rate limited. Registration does not automatically sign in. |
| `POST /api/auth/login` | Same input contract; returns generic `401 invalid_credentials` for unknown email or wrong password; on success rotates the session identifier and returns `200 { "success": true, "user": { "id", "email" } }` plus the session cookie. Rate limited. |
| `GET /api/auth/me` | Returns `200 { "authenticated": false, "user": null }` when signed out, or `200 { "authenticated": true, "user": { "id", "email" }, "csrfToken": "..." }` when signed in. Does not return session identifiers or password hashes. |
| `POST /api/auth/logout` | Requires exact configured `Origin`, authenticated cookie, and `X-CSRF-Token` matching the value from `/me`; destroys the server session and expires the cookie; returns `204`. |

Validation errors return `400 invalid_auth_input`; disallowed/missing browser origins on auth writes return `403 origin_not_allowed`; login/registration limit responses return `429 rate_limit_exceeded`; invalid/missing session configuration and session-store/database failures return generic `503 authentication_unavailable`. No password or database/session error detail is returned in response bodies.

Sessions use a 30-minute rolling idle lifetime and a 12-hour absolute lifetime. Cookies are host-only, `Path=/`, `HttpOnly`, and `SameSite=Lax`; `Domain` is omitted. Production uses the `__Host-ml-drift-lens` cookie with `Secure`; development/test uses `ml_drift_lens`. The absolute lifetime is enforced from server-side authenticated time. Session store pruning is enabled. Production requires a valid secret and secure cookie; auth endpoints fail closed without a valid session secret or available PostgreSQL store. Session cookie identifiers are hashed before storage. Login, registration, logout, and all cookie-authenticated mutation routes require exact Origin allowlisting; logout and mutations additionally require the CSRF token.

**Authentication is not application authorization.** The legacy OIDC middleware remains unmounted. Sensitive mutation routes require a native session, Origin, and CSRF validation, then return `403 authorization_policy_unconfigured` before reaching controllers. Openly registered accounts have ordinary access only; no administrator/operator role, service identity, row ownership, or tenant model is inferred. Internal event/retraining workers continue through service/database code; no matching HTTP service caller was found. Operational reads and `POST /api/predictions` require a session, and the owner has explicitly accepted that all registered accounts see shared/global records and may submit predictions. This is not per-user isolation.

`GET /api/health` and `GET /api/ready` remain unauthenticated for deployment probes; `/api/model-info` is authenticated. `/test-db` is disabled with `404` in production and continues to use sanitized diagnostics outside production; deployment ingress should not publish it. The backend configures one trusted proxy hop only when `NODE_ENV=production` to support Render TLS termination; confirm the actual Render ingress topology before relying on forwarded headers. This is not a general trust-all setting.

#### Configuration and migration

Configuration names in `.env.example` and `docker.env.example`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Optional PostgreSQL connection string; when empty, existing `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, and `DB_NAME` settings remain in use. |
| `DATABASE_SSL` | Set `true` to require verified TLS using the driver's certificate validation. |
| `SESSION_SECRET` | Required, randomly generated secret with at least 32 UTF-8 bytes; never commit or log it. |
| `SESSION_COOKIE_SECURE` | `true` for HTTPS/production; production refuses `false`. Local HTTP development can use `false`. |
| `NODE_ENV` | Set `production` on Render to enable secure cookie defaults, production diagnostic disablement, and the configured one-hop proxy trust. |
| `CORS_ORIGINS` | Comma-separated exact frontend origins; auth writes reject absent and unlisted origins. |

Local native development continues to use the existing `DB_*` settings. Before auth use, apply the migration with `npm run migrate:auth` from `ml-drift-lens-backend`; it is additive and safe to re-run. Compose database volumes are persistent, and init scripts do not rerun on existing volumes, so explicitly run this migration for existing databases before application use. Do not reset volumes or copy production data.

For Render, configure `NODE_ENV=production`, a Render-managed `DATABASE_URL`, `SESSION_SECRET` in Render's secret environment, `SESSION_COOKIE_SECURE=true`, and the exact deployed frontend origin in `CORS_ORIGINS`. Set `DATABASE_SSL=true` only when appropriate for the managed database connection. Run the additive migration as a pre-deploy/one-off operation; no Render migration job or deployment was run here. Render HTTPS termination is supported via Express one-hop proxy trust, but actual request/proxy behavior must be confirmed in the deployment environment.

Login/register rate limiting uses the dependency's default per-process memory store (10 attempts per IP per 15 minutes; registration limit 5). This is a basic single-instance control, not a distributed quota; deployments with multiple instances need a shared rate-limit store or edge-level throttling decision.

#### Remaining Phase 4 work

- Verify browser authentication against the local same-origin proxy and a configured Render staging deployment; exercise refresh, expiry, logout, and deployment proxy/cookie behavior end to end.
- Approve least-privilege roles/permissions, any future ownership/tenant boundaries, label provenance, administrative model changes/promotion, retraining operations, and required service-to-service identities. Until then, high-impact writes remain policy-blocked.
- Consider shared/distributed rate limiting and operational session-secret rotation/revocation for multi-instance production.
- Recovery, reset, email verification, and MFA are not implemented and must remain unavailable until a separate product/security decision and server contract exist.
- The recovery and verification pages remain informational; email delivery, password recovery, and email verification do not exist in this foundation.

### Phase 7 Account Management and Verification Implementation (2026-10-25)

Phase 7 completed the account management lifecycle and email delivery foundation:
- **Database Schema Migration (`012_account_recovery_and_verification.sql`):**
  - Created `password_reset_tokens` table with columns `id`, `user_id`, `token_hash`, `expires_at`, `used_at`, `created_at` and indexes on `token_hash` and `user_id`.
  - Added `email_verified boolean NOT NULL DEFAULT false` to `app_users`.
  - Created `email_verification_tokens` table with columns `id`, `user_id`, `token_hash`, `expires_at`, `used_at`, `created_at` and indexes on `token_hash` and `user_id`.
- **Endpoints & Security Controls:**
  - `POST /api/auth/forgot-password`: Rate limited; returns a timing-safe generic response whether an account exists or not; generates a cryptographic 32-byte hex token, stores only its SHA-256 hash with a 1-hour expiration; invalidates any previous unconsumed tokens; dispatches a reset email via `emailService`.
  - `POST /api/auth/reset-password`: Requires `token` and new `password` (12-128 chars); validates token hash and expiration; securely hashes the new password with Argon2id; marks the token as used; immediately revokes all existing sessions for the user (`DELETE FROM user_sessions WHERE sess->>'userId' = $1::text`).
  - `POST /api/auth/verify-email`: Validates token hash and expiration; updates `app_users.email_verified = true`; marks token as consumed.
  - `POST /api/auth/resend-verification`: Rate limited; returns a generic response; invalidates prior tokens and dispatches a fresh verification token if the account exists and remains unverified.
- **Email Delivery Service (`services/emailService.js`):**
  - Configurable transport via `EMAIL_PROVIDER`: supports `smtp`, `console`, and `memory` (for testing/development).
  - Sanitized logging: raw tokens and passwords are never logged (only SHA-256 hash prefixes are captured in internal audit ring buffers).
  - Configured through environment variables: `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `APP_PUBLIC_URL`.
- **Frontend Integration:**
  - Functional forms for `/forgot-password`, `/reset-password`, and `/verify-email`.
  - Application shell unverified banner (`.unverified-email-banner`) and topbar status badge alerting unverified accounts.
  - Model Evaluation head-to-head comparison arena redesigned per enterprise UX standards. All metrics accurately reflect real database incumbent and candidate states without fabrication.

### Earlier UI/API verification (2026-10-24; before native authentication)

- The following browser/API evidence predates the native authentication integration described above. It verifies the shell/proxy at that time, not today's authenticated operational route behavior.
- **Phase 3:** `/` renders the public landing page and public shell; the application routes remain separate. Sign-in and registration were not functional at the time of this check; they are now integrated as documented above.
- **Phase 4 shell:** `/app/overview`, `/predictions`, `/history`, `/status`, and `/drift` use the shared responsive application shell. The theme toggle and active-route indication are present. Route protection was added after this earlier smoke check.
- **Local API target:** The intended API is the Express service in `ml-drift-lens-backend`. It listens on port `3000` in-container/native mode; the repository Compose mapping exposes it on host port `23000`. `GET /api/health` identifies `modelwatch-backend`; `GET /api/ready` reports readiness/model state. Ports 3000 and 3001 on the host were Next.js web/admin services, not the ML API.
- **Frontend local configuration:** Vite proxies relative `/api` requests to `VITE_API_PROXY_TARGET`, falling back to `VITE_API_URL` and then `http://localhost:3000`. The workspace's Compose configuration uses `http://localhost:23000` as the proxy upstream and leaves browser `VITE_API_URL` empty, avoiding direct browser CORS requests. Do not publish local `.env.local` contents.
- **Integration evidence:** The Compose backend health and readiness endpoints previously returned HTTP 200 with the expected backend identity and healthy/ready status. Browser checks against the Compose frontend at `http://localhost:25173` verified real overview API data and no browser-console errors. In a read-only browser request during Phase 5 work, `GET /api/drift/history?limit=20` returned HTTP 200 with five persisted rows (three `significant_drift`, two `insufficient_data`); the latter carried `score: 0`, which is not a measured zero-drift result. `GET /api/alerts?limit=5` returned persisted open alert records. These checks establish the local Compose integration only, not production availability.
- **Phase 5 increment:** Added a read-only paginated drift-history UI using that existing contract, and clarified prediction metadata/history retry, loading, empty, and error states. Insufficient-data rows are explicitly not plotted or shown as measured zero scores. Alerts, feature-level drift investigation, detector controls, and new lifecycle workflows remain unavailable/not implemented.

The next Phase 5 work should continue in small evidence-backed increments. Do not add drift controls or alert mutations without contracts, approved authorization policy, and verified behavior.

### Authentication implementation status (2026-10-25)

- `/login` and `/register` submit credentials to the real backend. Login restores the server session and safely returns to an internal application path; registration confirms only after the backend responds successfully. Recovery/reset/verification pages remain informational because no endpoints or email delivery exist.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me` are implemented with PostgreSQL users and hashed server-side session IDs. Their contract and configuration are documented below.
- Session state is restored from `/api/auth/me` before protected routes render; logout sends the session CSRF token and only clears local authenticated state after backend confirmation. No credentials, session IDs, or CSRF token are persisted in browser storage.
- Operational reads and prediction creation require a valid session. All accounts may see the shared/global dataset by explicit product decision; per-user ownership and tenant isolation do not exist. Health/readiness remain public. High-impact mutations remain policy-blocked.
- **Master Phase 4 is COMPLETE.** Native first-party authentication, PostgreSQL-backed hashed sessions, process-restart persistence, frontend session integration/route guards, real-browser Playwright E2E automation (11/11 tests passing), and fail-closed privileged mutation protection (15 route patterns returning 403) are verified with zero breaking changes to existing capabilities.

## Audit status definitions

- **Implemented and verified:** The feature is present and relevant tests/build evidence exists in this repository/workspace. This does not imply provider or production verification.
- **Implemented, partially verified:** Code exists and is exercised locally, but an integration, accessibility, browser, or external-service dimension is unverified.
- **Partially implemented:** Some data or UI surface exists, but the intended product workflow is incomplete.
- **Missing:** No corresponding UI or backend capability was found in the inspected active project.
- **Blocked:** Correct implementation depends on external configuration, an authoritative process, or backend/API capability that is not currently available.

For this blueprint, “verified” refers to the stated local source/tests and the dedicated local PostgreSQL integration run—not a Render deployment or browser-based end-to-end authentication run.

## 1. Existing frontend and worktree

### Repository preservation

The worktree already contained user-owned changes across environment examples, Compose config, README/audit docs, backend, frontend, and ML modules, plus untracked audit, migration, middleware, service, test, and artifact-contract files. These were preserved; implementation was integrated surgically into the existing app and no unrelated files were reverted.

### Framework, tooling, and entry points

| Concern | Finding and evidence |
|---|---|
| Active project | `ml-drift-lens-frontend/` has its own `package.json`, lockfile, Vite config, and `src/`. The app shell is in `src/App.tsx`. |
| Framework | React 18, TypeScript, React DOM, React Router DOM 7, and Recharts are declared in the frontend package manifest. |
| Build/dev | Vite 5; `npm run dev`, `npm run build` (`tsc && vite build`), and `npm run preview`. Vite proxies `/api` to the backend during development. |
| Package manager | npm, evidenced by `package-lock.json` and npm scripts. |
| Browser entry | `index.html` loads `/src/main.tsx`; `src/main.tsx` renders `App` under `React.StrictMode` and `BrowserRouter`. |
| Tests | Vitest with jsdom and Testing Library. Existing tests cover the app shell, dashboard, prediction form, and API client. |
| Lint/format | No frontend lint or Markdown-format script was found in the inspected package manifest. The TypeScript build supplies a type check. |
| Other source tree | `ml-drift-lens-frontend/ml-drift-lens-frontend/` contains legacy JavaScript/Vite-looking files; it is not the active entrypoint configured by the outer package's `index.html` and Vite configuration. Do not replace or merge it without separate ownership/history review. |

### Existing routes and components

`src/App.tsx` currently declares:

| Current route | Current surface | Evidence / status |
|---|---|---|
| `/` | Public landing page (`LandingPage`) | Implemented as a separate public shell; sign-in and registration links are available, but an authenticated session is not implied. |
| `/login`, `/register` | Native account forms (`AuthStatusPage`) | Submit to backend account endpoints. Login restores the session; successful registration confirms account creation without auto-login. |
| `/forgot-password`, `/reset-password`, `/verify-email` | Informational capability status (`AuthStatusPage`) | No recovery, email delivery, reset, or verification endpoint exists; no fake forms are presented. |
| `/app/overview` | Overview dashboard (`Dashboard`) | Implemented; protected by session restoration and backend route authorization; reads live APIs and periodically refreshes. |
| `/drift` | Read-only paginated drift history (`DriftMonitoring`) | Protected; reads `GET /api/drift/history`; distinguishes empty history, request failure, and `insufficient_data`. No feature attribution or detector configuration. |
| `/predictions` | Prediction submission form (`PredictionForm`) | Protected; sample-based action, not a searchable explorer. Uses authenticated model metadata and posts through session/Origin/CSRF guards; unavailable metadata can be retried. |
| `/history` | Paginated prediction history (`PredictionHistory`) | Protected; reads real prediction records in pages of 10, with retry and distinct loading/error/empty states. Not a full explorer (no search/filter/detail); the table omits actual labels even though the API type supports them. |
| `/status` | System health/readiness/model panel (`SystemStatus`) | Protected application page; individual health/readiness requests remain public backend probes. UI requests may still show unavailable without underlying integration details. |
| Any other path | No explicit not-found route | Missing; React Router has no wildcard route in `App.tsx`. |

Reusable UI already present:

- `Dashboard.tsx`: metric cards, sections, status badges, table helper, retry/empty/error states, Recharts drift trend, auto-refresh, model filtering, and recent alerts/models/retraining/prediction tables. These are local helpers, not a formal shared design-system package.
- `PredictionForm.tsx`: current-model metadata lookup, sample prediction request, and result/error display.
- `PredictionHistory.tsx`: table, page controls, loading, empty, and error panels.
- `SystemStatus.tsx`: health/readiness/model status presentation.
- `ModelInformation.tsx`: model metadata and metrics presentation, but it is not currently routed from `App.tsx`.
- `src/App.css`: active application shell and dashboard styling; includes dark palette variables and responsive layout breakpoints.
- `src/index.css`: imported global baseline with a hard-coded dark page background.
- `src/style.css`: contains generic starter light/dark system-color rules but is not imported by the active entry chain.

There is no installed icon library in the active package manifest. `App.tsx` uses Unicode glyphs for navigation icons. Keep iconography consistent; select an icon package only if a future design phase establishes a need and reviews dependencies.

### Visual system, theme, and accessibility

**Existing design:** `App.css` defines a dark navy/slate surface and text palette, blue/purple primary accents, and success/warning/danger/info colors. The sidebar is a persistent left rail with a top bar. Existing CSS includes responsive breakpoints around 1100, 800/760, 640, and 560 px and collapses the shell into a vertical layout on small screens.

**Theme support:** The active application has a theme provider, semantic light/dark tokens, and a visible toggle. Continue testing page-level surfaces in both themes; the unimported starter `style.css` is not the source of this support.

**Accessibility evidence and gaps:**

- Existing positives: semantic `nav`, `main`, `aside`, `header`, section headings, data tables, a named main navigation region, dashboard metric section label, and an `aria-live="polite"` refresh status.
- Gaps to address in the foundations phase: no skip link or explicit `:focus-visible` treatment was found in active styles; navigation uses Unicode glyphs; sidebar has no mobile collapse/menu behavior; the chart has a surrounding accessible label but no equivalent tabular/text summary of plotted values; no dedicated accessibility automation or end-to-end keyboard audit was found.
- Inputs/buttons should have explicit visible labels, validation/error associations, disabled-state explanation, and tested keyboard operation. Preserve text/status labels alongside color; do not use color alone.
- Use reduced-motion-aware transitions/indicators. Current CSS has a pulsing status dot without a reduced-motion override.
- Existing HTML has a generic Vite project title in `index.html`; change it only as part of an approved public-shell/branding phase.

**Responsive recommendation:** Keep the present CSS-only responsive foundation. On desktop, retain a fixed/collapsible sidebar and compact top bar; at tablet widths, allow sidebar compaction and stack chart/table regions as needed; on mobile, use a labelled, keyboard-operable menu or bottom navigation rather than letting the existing full sidebar simply consume the first viewport. Tables need a deliberate narrow-screen strategy (horizontal scrolling with a clear cue or a semantically equivalent compact row layout), not hidden columns that remove meaning.

### Loading, error, and empty-state behavior

The dashboard already distinguishes per-section loading, request failure, retry, and empty results. It uses `Promise.allSettled`, retains independently successful section responses, polls on an environment-configurable interval, and indicates automatic refresh. Preserve these semantics when extracting shared components.

Prediction history has loading/error/empty and pagination. The form displays API errors and current-model metadata failure. System status polls every 30 seconds and reports individual unavailable integrations, but currently suppresses their underlying request errors. The audit did not find a shared toast, dialog/modal, or notification primitive.

Do not render fabricated metric values, labels, candidates, deployment progress, or integration health. Unknown/unavailable values should remain visibly unknown; a zero count is valid only when the API actually reports zero.

## 2. Authentication and access boundaries

The product decision for this phase is native first-party email/password authentication backed by PostgreSQL. Do not add OIDC, OAuth, social login, external identity providers, MFA, email recovery, or email verification as part of this foundation. See **Native authentication foundation (2026-10-25)** above for the implemented endpoint and configuration contract.

Backend authentication is independent of UI routing. The frontend calls `/api/auth/*`, sends CSRF tokens for cookie-authenticated mutations, restores sessions before rendering protected pages, and logs out through the backend. Do not interpret account creation as permission to access administrative operations. The OIDC middleware and configuration files remain only as unmounted legacy code/tests; no current API router invokes them.

Repository evidence for the implementation and its limitations:

- PostgreSQL is already the backend's primary data store and `pg` connection pool. The new `app_users` and `user_sessions` tables use an additive migration; Redis event processing is unchanged.
- Registration is open by explicit product decision. Accounts have email/password and no roles; there are no user/tenant ownership fields or audit/account recovery flows.
- Authenticated mutation requests currently stop at a generic policy-unconfigured `403` after session, Origin, and CSRF checks. Existing health/readiness checks remain usable.
- The `connect-pg-simple` store is configured with `createTableIfMissing: false`; the checked-in migration must be applied before using auth. Session persistence across real PostgreSQL process restarts has been verified in `tests/authenticationPostgres.integration.test.js` using isolated child worker processes against the dedicated test database (`ml_drift_lens_auth_phase4_test_20261025`).

#### API access-policy matrix

“Current” describes the inspected code. Read routes grant only the approved shared-data account access; privileged writes remain blocked rather than receiving speculative roles. Route wiring is covered by `protectedRoutes.test.js`; account/session middleware and lifecycle behavior are covered by `authentication.test.js` and the opt-in PostgreSQL integration test. The PostgreSQL integration test validates the auth lifecycle, not every operational controller against a real HTTP server. Public health means only minimal liveness/readiness output and no secrets or detailed infrastructure diagnostics.

| Exact route | Current enforcement | Intended access and permission | Service caller, coverage, and disposition |
|---|---|---|---|
| `GET /` | No auth; generic liveness text | Public service-health endpoint | Preserve generic output; no credentials or dependency details. |
| `GET /test-db` | No auth outside production; production responds `404`; failures are sanitized | Restricted operational diagnostic; disabled/unreachable from internet-facing deployments | Keep absent in production and exclude from public ingress in all environments. Preserve sanitized failures; never return raw database errors. |
| `POST /api/auth/register` | Public account creation; exact Origin and registration rate limit | Public entry for open self-registration; ordinary account only | No service caller. `authentication.test.js` covers valid/invalid/duplicate requests; never create an implicit privileged account. |
| `POST /api/auth/login` | Exact Origin, login rate limit, generic credential response | Public entry; creates and rotates the account session on valid credentials | No service caller. `authentication.test.js` covers valid/invalid credentials and session rotation; keep errors generic. |
| `GET /api/auth/me` | Session lookup; returns signed-out state or minimal authenticated profile and CSRF token | Publicly callable session status endpoint; CSRF token is returned only for an authenticated session | No service caller. Auth tests cover signed-out and restored states; do not return cookie identifiers or password hashes. |
| `POST /api/auth/logout` | Exact Origin + authenticated session + CSRF; destroys server-side session | Authenticated account logout | No service caller. Auth tests and PostgreSQL integration verify invalidation and cookie clearing. |
| `GET /api/metrics` | Native authenticated session | Authenticated application user; shared/global metrics visible to every registered account by explicit product decision; no tenant/row isolation | No internal HTTP caller found. Auth middleware is enforced in `server.js`; test anonymous denial and signed-in dashboard access. Keep login required; disclose global visibility in product/deployment documentation. |
| `GET /api/health` | No auth | Public service health | `healthController.test.js` covers healthy/unhealthy dependency status; preserve probe availability and non-sensitive output. |
| `GET /api/ready` | No auth | Public service readiness | `healthController.test.js` covers ready and dependency failure; preserve probe availability and non-sensitive output. |
| `GET /api/model-info` | Native authenticated session | Authenticated application user; global model metadata visible to all registered accounts by explicit product decision | No internal HTTP caller found. `protectedRoutes.test.js` verifies guard wiring; keep login required and note that metadata is shared. |
| `GET /api/predictions` | Native authenticated session | Authenticated application user; global prediction history visible to all registered accounts by explicit product decision; no per-user ownership | No internal HTTP caller found. Route policy tests verify guard wiring and auth middleware tests exercise session denial; keep login required and document lack of row isolation. |
| `POST /api/predictions` | Exact Origin + native authenticated session + CSRF; 60 requests/minute/IP; validates input and persists inference | Authenticated application user; ordinary prediction creation allowed; global records are not user-owned | No internal HTTP caller found. Route policy and auth tests verify guard sequence, session/CSRF, and rate-limit placement; retain this user-level capability and note shared data. |
| `PUT /api/predictions/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Authenticated label operation with a distinct approved permission; potentially privileged | Define who may provide/modify ground truth, label provenance, and record ownership. Account authentication does not grant label authority. Test permission, provenance, and object-level authorization. |
| `DELETE /api/predictions/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged prediction management | Approve deletion/retention authority and ownership rules; test denied and permitted deletion and audit. |
| `GET /api/drift` | Native authenticated session | Authenticated application user; global drift data visible to registered accounts by explicit product decision | No internal HTTP caller found. Route policy tests verify session guard; keep login required and document shared/global records. |
| `GET /api/drift/history` | Native authenticated session | Authenticated application user; global drift history visible to registered accounts by explicit product decision | No internal HTTP caller found. Route policy tests verify session guard; preserve pagination and document no row isolation. |
| `POST /api/drift` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Service-to-service detector write, or separately authorized human write (undecided) | No in-repository HTTP service caller was found. Choose the trusted producer and credential/identity contract; test untrusted producers denied and the approved producer accepted. |
| `PUT /api/drift/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged drift administration or trusted service operation (undecided) | Define whether updates are needed, by whom, and under what provenance/ownership rules; test the chosen permission and record scope. |
| `DELETE /api/drift/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged retention administration or trusted service operation (undecided) | Approve deletion/retention policy and audit requirements; test authorization and audit. |
| `GET /api/alerts` | Native authenticated session | Authenticated application user; global alerts visible to registered accounts by explicit product decision | No internal HTTP caller found. Route policy tests verify session guard; keep login required and document shared/global records. |
| `POST /api/alerts` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Service-to-service alert generation; separate operator write only if approved | No in-repository HTTP service caller was found. Define producer identity and provenance; test service authorization and human denial unless separately approved. |
| `PUT /api/alerts/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged alert management | Approve operator roles, writable fields, ownership, and audit; test least privilege and record scope. |
| `DELETE /api/alerts/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged alert/retention administration | Approve deletion/retention authority; test denial, permitted operation, and audit. |
| `GET /api/retraining` | Native authenticated session | Authenticated application user; global retraining metadata visible to registered accounts by explicit product decision | Internal worker uses service/database code, not this HTTP read. Route policy tests verify session guard; document shared visibility. |
| `GET /api/retraining/:id` | Native authenticated session then job ID validation | Authenticated application user; global job details visible to registered accounts; ID validation is not ownership | Internal worker uses service/database code, not this HTTP read. Route policy tests verify guard and existing validation; no object ownership exists. |
| `POST /api/retraining` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Authenticated retraining request; privileged operational action | Define eligible users/roles and quotas. Preserve trusted-data/sample safety gates; test permission and authorized queueing. |
| `POST /api/retraining/:id/promote` | Native session + Origin + CSRF + existing origin check; then denied with `403 authorization_policy_unconfigured` | Privileged model release/promotion | Approve a distinct release permission, ownership, revalidation, and audit. Origin validation is not authorization; test permission, origin, lifecycle, and permitted promotion. |
| `PUT /api/retraining/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged retraining administration | Define allowed fields and prevent worker-owned lifecycle-state tampering; test field-level permission and audit. |
| `DELETE /api/retraining/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged retraining administration | Define deletion versus cancellation/retention semantics and audit; test the approved operation. |
| `GET /api/models` | Native authenticated session | Authenticated application user; global model versions visible to registered accounts by explicit product decision | No internal HTTP caller found. Route policy tests verify session guard; document lack of tenant/model isolation. |
| `POST /api/models` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged model registration | Approve model-manager role, ownership, validation, and audit; test denied and authorized registration. |
| `PUT /api/models/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Privileged model administration | Define ownership and lifecycle constraints; test role, object scope, and audit. |
| `DELETE /api/models/:id` | Native session + Origin + CSRF; then denied with `403 authorization_policy_unconfigured` | Administrative model deletion | Approve deletion authority and active/dependent-model safeguards; test forbidden and permitted deletes and audit. |
| Evaluation routes | No route found | Not implemented; authenticated future capability | Define evidence, provenance, model scope, read permissions, and mutation rules before adding endpoints. |
| Deployment routes | No route found; Render client is not an exposed operational API | Not implemented; restricted future capability | Define deployment read/promote policy and independently verified workflow before endpoints exist. |
| User/account/settings/audit routes | No routes or schema found | Not implemented | Provider owns credential lifecycle; decide whether application profile/roles/audit need persistence. Define contracts before adding endpoints. |

**Authentication is not authorization.** The product owner explicitly approved that any account created through open self-registration may read shared/global monitoring, model, retraining, and prediction data and may submit predictions. Records are not user-owned and there is no tenant isolation; no per-user privacy is claimed. Any requirement to restrict these records by user/tenant must precede deployment with sensitive data. Accounts have no roles or service identity. Sensitive mutations remain fail-closed after Origin/CSRF/session validation with `403 authorization_policy_unconfigured`. Exactly 15 privileged mutation route patterns are registered and fail-closed. Earlier references to "19 privileged mutations" were a documentation conflation of these 15 mutation patterns with either the 4 auth endpoints or the 4 initial protected GET read routes. `GET /api/health` and `/api/ready` remain public for probes; `/api/model-info` is authenticated. `/test-db` returns 404 in production, remains a development-only diagnostic, and must not be published by internet-facing ingress.

#### Backend authentication implementation and verification (2026-10-25)

- `app_users` stores normalized unique email and Argon2id password hash; no plaintext password, role, or browser-supplied identity is stored/trusted.
- `user_sessions` stores `connect-pg-simple` sessions. The session-store adapter hashes the opaque express-session ID before storing or querying it. Login regenerates the session ID; logout destroys the server session; idle and absolute lifetimes are enforced.
- Login/register have per-process rate limits. Login responses do not distinguish unknown email from wrong password. Auth state is loaded from PostgreSQL for each request, and database/session-store failure returns generic `503` rather than falling back to memory.
- Cookie-authenticated writes require exact configured Origin and constant-time CSRF-token equality. In production, the cookie uses the `__Host-` prefix, Secure/HttpOnly, SameSite=Lax, host-only scope, and `Path=/`.
- Selected OIDC-guarded mutation routes were migrated to native-session/Origin/CSRF middleware and then held at 403 until authorization policy is approved. No in-repository external service caller was found; internal event/retraining workers are unchanged.
- The PostgreSQL migration is additive and has an explicit `npm run migrate:auth` command. It was applied only to a new dedicated local PostgreSQL test database; the existing project database and persistent volumes were not changed.
- Operational reads and prediction creation require a valid session; prediction creation also requires exact Origin, CSRF, and per-IP rate limits. The product decision explicitly allows all registered users to view the same global data; user/tenant isolation is absent.
- `GET /api/health` and `/api/ready` remain unauthenticated. `/test-db` is disabled in production; non-production diagnostics retain sanitized errors. Internal event and retraining workers continue through existing service/database code; no corresponding HTTP caller was found.
- An additive migration was applied to a dedicated local Compose test database (`ml_drift_lens_auth_phase4_test_20261025`). PostgreSQL-backed registration, hash persistence, duplicate rejection, cookie attributes, hashed session lookup, session restoration through a newly initialized Express middleware instance, protected write checks, logout invalidation, reuse rejection, AND persistence across an actual backend process restart (spawning separate child Node processes with distinct PIDs, terminating the initial server, and verifying restoration, protected mutation, and logout on the restarted process) passed. No existing project database or volume was dropped, reset, or migrated.

#### Security requirements and acceptance criteria

- **CSRF:** Cookie-authenticated writes require the configured exact Origin and a CSRF token; `SameSite=Lax` is defense in depth, not a replacement. Verify rejected origins/tokens and keep the frontend same-origin.
- **Credential and session exposure:** Hash passwords with Argon2id, never log plaintext credentials, and never return password hashes or session IDs. Use output encoding/React escaping, avoid unsafe HTML, and do not store credentials or session identifiers in browser storage, URLs, logs, or telemetry.
- **Session:** Keep opaque session identifiers server-side in PostgreSQL after hashing them for storage. Rotate on login; enforce the implemented 30-minute idle and 12-hour absolute lifetime; destroy on logout; use host-only `HttpOnly; SameSite=Lax; Path=/` cookies and `Secure` in production. Fail closed on invalid configuration or store failures.
- **Authorization:** Define an explicit route-to-permission map, then enforce it server-side. Authentication alone does not establish role, tenant, record ownership, service identity, or permission to read or mutate data. Current unapproved sensitive mutations remain blocked.
- **Abuse and errors:** Login and registration are rate-limited per process; this is not a distributed quota. Decide whether a shared store or edge throttling is needed for multiple instances. Keep generic login errors and redacted failure responses; no stack traces, secrets, or raw database diagnostics reach clients. `/test-db` returns 404 in production and must not be exposed by internet-facing ingress.
- **Redirect/config:** The backend currently has no login redirect or callback. If one is introduced later, allow only validated internal return paths. Keep exact CORS/Origin allowlists, require HTTPS in production, and verify Render's proxy topology before relying on the configured one-hop trust.
- **Operations:** Provision `SESSION_SECRET` through a secret manager; protect and monitor PostgreSQL availability, session cleanup, migration execution, secret rotation, and account lifecycle. Never copy production credentials to developer machines or tests.
- **Complete acceptance:** Verify registration/login/session restoration/logout/expiry and failure behavior against isolated PostgreSQL; retain the implemented frontend guards; keep approved shared-data access and blocked privileged operations enforced server-side; resolve remaining permission/service-identity decisions; and run browser/E2E checks in a configured test deployment. Unit tests alone do not prove Render behavior.

#### Decisions and external configuration required

##### Confirmed facts

- First-party email/password authentication is the approved direction: open registration, Argon2id password hashes, PostgreSQL users and server-side sessions. No external identity provider is part of this design.
- The backend has `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. Migration 011 was applied to the isolated PostgreSQL auth-test database; no Render deployment was completed.
- The frontend has working registration/login forms, session restoration, logout, CSRF header handling, safe internal return paths, and protected operational routes. Recovery, reset, verification, and MFA remain informational/unavailable.
- The same-origin frontend proxy exists. Production HTTPS termination and the actual Render ingress topology still require deployment verification.
- Redis remains used for event-stream functionality, not sessions. Operational reads and `POST /api/predictions`, formerly public, now require a session; prediction creation also requires Origin/CSRF checks and is rate-limited. High-impact mutations require a session and CSRF but remain denied pending policy.

##### Recommended defaults (require owner approval)

- The implemented session defaults are a 30-minute idle timeout, 12-hour absolute timeout, host-only `HttpOnly; SameSite=Lax; Path=/` cookie, `Secure` in production, hashed session IDs in PostgreSQL, and exact Origin plus CSRF checks for cookie-authenticated writes.
- Keep public health/readiness available to deployment probes. Shared operational data is available to every authenticated account under the explicit owner decision; do not claim per-user confidentiality or tenant isolation.
- Separate human permissions from any future service identity. Add no roles, tenant model, or ownership policy without explicit product/security decisions.

##### Owner and deployment decisions

| Decision owner | Required approval or supplied contract |
|---|---|
| Product/security owner | Confirm account lifecycle needs beyond open registration; decide who may read monitoring/prediction data, create predictions, submit labels, manage alerts/drift/retraining/models, and promote models. Approve public exceptions and audit requirements. |
| API/product/security owners | Define roles/permissions, service identities if required, tenant/model boundaries, record ownership, label provenance, quotas, and audit needs. Do not treat a session or frontend guard as authorization. |
| Backend/operations owner | Verify PostgreSQL availability/backup and migration execution; decide session invalidation and secret rotation operations; review multi-instance rate limiting and session pruning; approve `CORS_ORIGINS`, HTTPS, cookie, and trusted-proxy settings. |
| Deployment owner | Supply per-environment PostgreSQL connection and secret-manager configuration, exact frontend origin, Render service topology, and migration rollout procedure. Do not commit secret values. |

| Subject/action | Authorization decision required (not currently established) |
|---|---|
| Human monitoring users | Which users may read metrics, drift, alerts, model metadata, prediction history, and retraining status; whether any specific aggregate/metadata fields may be public. |
| Prediction callers | Whether inference is authenticated-only or intentionally public; caller quotas/abuse limits, feature-data handling/retention, ownership/attribution, and access to stored predictions. |
| Label contributors | Who may submit/change actual labels, how ground-truth source/provenance is verified, and who may correct or delete a label. |
| Alert producers and operators | Which service identity may create generated alerts; which human operators may update/resolve/delete alerts; separation of generated events from manual management. |
| Drift producers and operators | Which detector/service identity may write drift records; whether human updates/deletes are permitted and under what audit/retention rules. |
| Retraining users and workers | Which users may request/manage/cancel jobs; which service identity executes lifecycle transitions; quotas and worker-owned fields that humans cannot alter. |
| Model managers and release approvers | Which users may register/change/delete models; separate approval for promotion/release; active-model safeguards, revalidation, ownership, and audit. |

##### Deployment-specific unknowns

For **local development, automated tests, staging, and production**, supply the environment's PostgreSQL connection using existing `DATABASE_URL` or `DB_*` settings, `SESSION_SECRET`, `CORS_ORIGINS`, and `SESSION_COOKIE_SECURE` as applicable. Confirm Render HTTPS termination and proxy topology, secret rotation, migration execution, and shared rate-limit policy before production. Do not copy production credentials into developer machines or tests.

##### Phase 4 completion contract

Do not mark Master Phase 4 complete until each applicable item is implemented and verified:

- Registration and login validate input, normalize and uniquely constrain email, use Argon2id, and return only minimal user data. Login errors do not disclose account existence.
- PostgreSQL-backed sessions use hashed opaque identifiers, rotate on login, expire at idle and absolute limits, restore through `/api/auth/me`, invalidate on logout, and fail closed when configuration/store access fails.
- Cookies, exact Origin checks, and CSRF tokens are verified in tests; production uses Secure, HttpOnly, host-only cookies. PostgreSQL integration, Render proxy/cookie behavior, and browser behavior are verified in an isolated test deployment.
- Frontend registration/login/logout, session restoration, protected routes, safe return destinations, and accessible loading/signed-out/forbidden/expired/error states are implemented and tested.
- Backend independently enforces the approved shared-data account policy and denies unresolved privileged writes. Any future roles, resource/tenant ownership, and service identities must be approved before they are introduced. Health/readiness remain usable; public exceptions are explicit.
- Regression tests cover public health/readiness, anonymous/authenticated/forbidden requests, CSRF, session expiry/rotation/logout/store failure, and required service integrations. No secrets are committed.
- Review confirms no credentials, tokens, session identifiers, or other secrets are committed, bundled for the browser, or exposed in logs/responses.

Until all applicable criteria pass, Master Phase 4 remains **PARTIALLY COMPLETE / BLOCKED**.

Never put `SESSION_SECRET`, database credentials, or password material in `VITE_*`, frontend build arguments, or a static bundle. Keep production secrets in Render's secret environment and local secrets outside source control.

#### Remaining Phase 4 completion work

1. Approve who may label or delete predictions, write drift/alerts, queue/manage retraining, register/manage models, and promote releases. Keep these writes blocked until policy is approved. Define service identity only if an HTTP machine caller is introduced.
2. In isolated staging/Render environment, verify Secure-cookie and one-hop Render proxy behavior, origin configuration, migration execution, and store-failure behavior (PostgreSQL session persistence across real backend process restart has been verified locally). Confirm actual ingress topology before relying on forwarded headers.
3. Run configured non-production browser/E2E checks for registration, login, refresh restoration, logout, expiry, safe redirects, direct API authorization, public health/readiness, and monitoring integrations. Keep recovery, email verification, and MFA unavailable unless separately designed and implemented.

Master Phase 4 is **COMPLETE**. Frontend session integration, backend session management, local process-restart persistence, real-browser E2E testing (11 flows), and fail-closed operational mutation policy are verified. The repository is ready for Master Phase 5 (Monitoring and operational pages).

## 3. Proposed route and information architecture

The route map below began as a **target product architecture, not an assertion that these routes existed**. Phase 3 assigns `/` to the public site and moves the existing overview to `/app/overview`. `/app/overview`, `/predictions`, `/history`, `/status`, and `/drift` are protected in the frontend and backend.

### Public shell implementation status (2026-10-24; refreshed for authentication below)

- `/` now renders a public landing page inside a separate public shell. `/app/overview` renders the existing overview dashboard. This resolves the prior root-path collision without removing the dashboard.
- The existing `/predictions`, `/history`, and `/status` paths remain unchanged and render their existing application surfaces behind session restoration and server-side access checks. `/drift` is similarly protected.
- Registration and login are first-party forms; recovery/reset/verification remain informational. There is no OIDC provider flow.
- Public navigation links target actual landing-page sections or the existing `/app/overview` route. No legal destinations are shown because none are defined.
- Landing-page preview graphics are explicitly illustrative and make no claim to show live backend data. Capabilities distinguish currently represented areas from planned deployment verification.
- Browser smoke checks on 2026-10-24 confirmed expected page headings at `/`, `/app/overview`, `/predictions`, `/history`, and `/status`; the public layout was checked at a 360px CSS viewport without horizontal page overflow. The shared theme toggle switched themes in-browser, and keyboard focus produced a visible outline.
- Focused browser contrast sampling of hero and card body text, public navigation, and a secondary button measured at least 5.96:1 in dark mode and 7.13:1 in light mode. This is a limited sample, not a formal WCAG audit of every state/component.
- Initial browser requests targeted `http://localhost:3000`, which returned a Next.js `service:"web"` response; port 3001 returned `service:"admin"`. These are unrelated services, not the ML API.

### Local API target investigation and verification (2026-10-24)

- Repository source identifies the API as the Node/Express service in `ml-drift-lens-backend/server.js`; its health route is `GET /api/health` and its expected identifying field is `service: "modelwatch-backend"` (`controllers/healthController.js`). Its native default listener is `127.0.0.1:3000`.
- The documented local Compose configuration publishes that same `backend` service on host port `BACKEND_PORT`, default `23000`. Both workspace root `.env` and `docker.env` set `BACKEND_PORT` to `23000`, matching the configured Compose port mapping. The local frontend had `VITE_API_URL=http://localhost:3000`, which bypassed Vite's proxy and selected the unrelated Next.js process.
- The frontend API client uses relative `/api` paths when `VITE_API_URL` is empty. Vite now loads `VITE_API_PROXY_TARGET` from `.env.local` and forwards same-origin requests to that upstream. The local frontend `.env.local` leaves `VITE_API_URL` empty and selects `http://localhost:23000` as the proxy upstream; this bypasses browser cross-origin requests and does not alter API contracts.
- The documented startup procedure was run without deleting or recreating volumes: `docker compose --env-file docker.env -p ml-drift-lens-compose up -d --build backend`, followed by the same command with `frontend`. Compose started the required PostgreSQL, Redis, MLflow, inference, backend, and frontend services; all reported healthy. The persistent PostgreSQL volume was reused.
- `GET http://localhost:23000/api/health` returned HTTP 200 with `status:"healthy"`, `service:"modelwatch-backend"`, `database_connected:true`, and `ml_service_healthy:true`. `GET /api/ready` returned HTTP 200 with `ready:true` and `model_loaded:true`.
- In a real browser at the local Vite dev origin, the proxied health, readiness, metrics, model, drift-history, alerts, retraining, and prediction-history requests all returned HTTP 200 with their expected JSON object/array shapes. Metrics reported `metrics_status:"available"` and 108 persisted predictions; the dashboard showed the persisted count and Operational status, with no browser console errors.
- The built Compose frontend was also opened at `http://localhost:25173`: `/` rendered the public landing page, while `/app/overview` rendered the dashboard and fetched health, readiness, and metrics through its Nginx same-origin proxy. Each returned HTTP 200 and the dashboard displayed persisted metrics with no console errors.
- CORS was verified without broadening the policy: direct backend requests with origin `http://localhost:25173` returned `Access-Control-Allow-Origin: http://localhost:25173`; origins `http://localhost:5173` and `http://127.0.0.1:5175` did not receive an allow-origin header. Vite and Compose browser requests use same-origin reverse proxies, so the browser does not require cross-origin CORS permission for those flows.
- Port 3000 still serves the unrelated Next.js `service:"web"` response and port 3001 serves Next.js `service:"admin"`; neither is used by the corrected local frontend configuration. The native backend setup remains a separate mode and requires its own PostgreSQL/Redis configuration; the workspace root `.env` lacks `DB_HOST`, `DB_USER`, and `DB_NAME`. For native mode, set `VITE_API_PROXY_TARGET=http://localhost:3000` only when the Express backend is actually running there.
- The API target mismatch is resolved for this workspace's Compose development environment, and the end-to-end API connection is verified against live local development services. This does not establish production availability or browser authentication.

### Phase 4 application-shell status (2026-10-25)

- The application shell is shared by `/app/overview`, `/predictions`, `/history`, `/status`, and the read-only `/drift` page; `/` and the auth status routes remain inside the separate public shell.
- Application navigation exposes only the five implemented destinations: Overview, Predictions, Drift monitoring, History, and System Status. The active `NavLink` sets `aria-current="page"`; navigation has an explicit accessible name, and a keyboard skip link targets the application main landmark.
- The shell uses the ML-Drift-Lens product identity, the shared theme toggle, existing semantic tokens, and a two-column navigation layout at narrow viewport widths. A session-restoration gate now protects all existing operational pages; backend API guards remain authoritative.
- Anonymous direct navigation and refresh redirect to `/login` with an internal return destination. Operational data is not fetched until session restoration succeeds. Do not treat the visual shell as the security boundary.
- Planned sections do not appear as links until each has a working route and meaningful implementation. Remaining intended future destinations include Alerts (`/app/alerts`), Retraining (`/app/retraining`), Model evaluation (`/app/evaluation`), Model registry (`/app/models`), and Deployments (`/app/deployments`). Their implementation and API readiness remain governed by the capabilities table below.

Access labels:

- **Public:** available before login; no private operational data.
- **Authenticated:** requires a real authenticated session and corresponding backend authorization.
- **Role-restricted:** needs explicit backend role/scope support, not merely a frontend conditional.
- **Blocked:** do not expose the interactive capability until required identity, API, or service support exists.

### Public website

| Area / proposed route | Purpose and intended user | Access / current status | Existing APIs and required data | Key actions and honest states | Dependencies / acceptance criteria |
|---|---|---|---|---|---|
| Landing `/` | Explain monitoring, drift, evaluation, and current product boundaries to visitors. | Public; implemented in Phase 3 as a static page. | No operational API needed; app startup checks only `/api/auth/me` to determine whether a session exists. | Sign-in/registration links are real. Avoid “deployed safely” or provider claims. | Separate public shell; operational data is not fetched from the landing page. |
| Registration `/register` | Create a first-party account. | Public entry; real form calls backend. | `POST /api/auth/register`; email and password are submitted over same-origin API. | Client checks required fields and confirmation; backend validation/duplicate rejection is authoritative; success only after `201`. | Open registration is approved; accounts receive ordinary shared-data access only, not privileged roles. |
| Login `/login` | Authenticate an account. | Public entry; real form calls backend. | `POST /api/auth/login`, followed by `GET /api/auth/me`; cookie remains HttpOnly. | Generic credentials errors, rate limit/service/network errors shown; only safe internal return destinations accepted. | Session restoration and logout use same-origin cookie and in-memory CSRF handling. |
| Forgot password `/forgot-password` | Recover account access. | Public entry; blocked because no recovery workflow exists. | No recovery/email-delivery endpoint. | Explain the limitation without collecting credentials or implying an email was sent. | Requires an explicitly designed recovery mechanism and delivery contract. |
| Reset password `/reset-password` | Complete an approved password-recovery flow. | Public entry; blocked because no recovery workflow exists. | No reset-token verification/update API. | Do not accept or persist reset secrets until a real server contract exists. | Requires recovery design, token lifecycle, and secure delivery. |
| Email verification `/verify-email` | Verify an account email if adopted. | Public entry; blocked because no verification workflow exists. | No verification endpoint or delivery contract. | Remain informational; do not claim an account was verified. | Requires an explicit product decision and working delivery/verification flow. |

### Authenticated application

| Area / proposed route | Purpose and intended user | Access / current status | Existing APIs and required data | Key actions and honest states | Dependencies / acceptance criteria |
|---|---|---|---|---|---|
| Overview `/app/overview` | At-a-glance current model, observed metrics, drift, alerts, retraining and inference activity. | Protected by session restoration and backend authorization. | `GET /api/metrics`, `/api/drift/history`, `/api/alerts`, `/api/models`, `/api/retraining`, `/api/predictions`; current dashboard calls these with cookies. | Refresh and navigate. Preserve per-section loading/error/empty and “insufficient data”; never promote candidate-ready to deployed. | All authenticated accounts see shared/global data under the explicit product decision; there is no per-account isolation. |
| Drift monitoring `/app/monitoring/drift` | Investigate drift history, threshold, timestamps, model/version and sample sufficiency. | Authenticated target; read-only page exists at `/drift`, with a dashboard panel. | `GET /api/drift`, `GET /api/drift/history` (pagination), metrics/model identity. | Filter/inspect only real scores; show insufficient data distinctly from “healthy/no drift”. | Confirm API provides required per-model filters/window/reference details. A separate page adds meaningful investigation beyond the dashboard panel. |
| Predictions explorer `/app/predictions` | Search and inspect inference records and actual-label status. | Authenticated target; partial existing `/history` table and dashboard preview. | `GET /api/predictions` with limit/offset; fields include model/version, prediction, confidence, latency, timestamp, request ID, actual label. | Search/filter/sort/page, inspect row details. Label editing must not imply trusted ground truth. | Add backend query filters/detail endpoint only if needed. Preserve pagination; label provenance/trust badge must be truthful. |
| Prediction submission `/predictions` | Run a single inference for an operator-provided feature record. | Protected by session, Origin, and CSRF checks; creation is rate-limited. | `GET /api/model-info`; `POST /api/predictions` returns prediction, confidence, latency, model/version, request and stored IDs. | Submit features, display exact server result, validation/API errors. | Current UI uses a hard-coded sample feature row, not a general input form. Successful predictions are shared/global, not user-owned. |
| Retraining center `/app/retraining` | Inspect job lifecycle, readiness blockers, candidate outcomes, and authorized actions. | Authenticated target; partial table embedded in dashboard. | Session-protected `GET /api/retraining`, `GET /api/retraining/:id`; guarded and policy-blocked `POST /api/retraining`, `POST /api/retraining/:id/promote`, `PUT/DELETE /:id`. | Queue/poll details, show persisted waiting reason, sample counts, metrics, promotion result/errors. No enabled action without approved permission. | Keep writes blocked; preserve durable states; candidate-ready is not deployed. No Render operation here. |
| Model evaluation `/app/evaluation` | Compare candidate and incumbent evaluation on the same declared holdout and review evidence. | Authenticated; partially represented by dashboard job metrics/current-model metadata. | `GET /api/metrics`, `/api/models`, `/api/retraining/:id`; model-info endpoint can expose active metadata. There is no dedicated evaluation API. | Read comparison, split size/source and metric definitions. | Requires backend contract for complete comparison provenance, evaluation dataset/split, and sufficient-data state. Do not invent missing metrics. |
| Model registry `/app/models` | Browse model versions, active state and known evaluation metadata. | Authenticated target; partial model-version table in dashboard. | Session-protected `GET /api/models`, `GET /api/model-info`; model write endpoints are guarded and policy-blocked. | View/filter versions. Create/update/delete remain unavailable without explicit policy and API support. | Existing active model version list and dashboard table remain preserved. Avoid implying artifact availability from metadata alone. |
| Deployments `/app/deployments` | Track staging deployment request, Render terminal state, and independently verified live model/artifact. | Authenticated/role-restricted; blocked. No page or endpoint. | No deployment persistence/status API. Backend Render client only has mocked create/get calls behind staging config. | Show “not configured” or “verification unavailable”; no redeploy action. | Requires durable artifact retrieval, backend authorization, staging-only configuration, persistent deployment IDs, polling/retry/duplicate control, live version+checksum check. API acceptance is initiation, not activation. |
| Alerts and events `/app/alerts` | Review alerts and their source drift events. | Authenticated target; partial alert table on dashboard. | `GET /api/alerts`, `/api/drift/history`; alert create/update/delete guarded. | Filter and inspect persisted alerts. Resolve/modify only if status semantics and authorization are specified. | No full event/audit stream endpoint found. Empty state means no persisted alert records, not no risk. |
| Settings and integrations `/app/settings` | Manage user preferences and view configured integrations. | Authenticated; missing as a page. | No settings/integration status APIs. Frontend refresh interval is environment-based; no user preferences API. OIDC/Render config is server-side and unset. | Theme/refresh preferences can be local preferences; integration cards must show unavailable/unconfigured rather than fabricated status. | Keep credentials server-side; never expose API secrets. Define which settings are local vs server-managed. |
| System status `/app/system` | Inspect backend, database, inference readiness and active model metadata. | Authenticated target; current `/status` is implemented but public. | `GET /api/health`, `/api/ready`, `/api/model-info`. | Retry/poll; label each component independently and show fetch errors separately from negative health. | Improve error visibility in `SystemStatus`; do not collapse network failure and unhealthy state into indistinguishable null. |

### Account and administration

| Area / proposed route | Purpose and intended user | Access / current status | Existing APIs and required data | Key actions and honest states | Dependencies / acceptance criteria |
|---|---|---|---|---|---|
| Profile `/app/account/profile` | Show/manage the authenticated user's identity and preferences. | Authenticated; missing. | No `me`/profile endpoint or session claims surfaced in frontend. | Read/edit only provider-supported fields; local UI preferences may be client-side. | Identity claims contract and provider APIs; do not invent user data. |
| User and role management `/app/admin/users` | Manage account access and roles. | Role-restricted; missing and blocked. | No users/roles API, database model, or role-specific middleware was found. Current middleware checks one configured scope for mutations, not a role-management system. | Administrative CRUD only after backend authorization and audit semantics exist. | Require explicit roles/scopes, least privilege, server-side enforcement, audit coverage, and administrator tests. |
| Audit log `/app/admin/audit` | Review security-sensitive changes and deployment decisions. | Role-restricted; missing. | No audit-log endpoint or persisted audit trail found in inspected routes/controllers. | Read-only filters/details; empty only when verified empty. | Implement authoritative append-only backend audit records and access policy first. |

### Global routes and states

- Not found: add a semantic 404 route with a safe return-to-overview link; preserve entered form state only when safe.
- Access denied: distinguish unauthenticated (login required), authenticated but unauthorized (403), and missing/unconfigured backend/session store (service unavailable).
- Session expired: redirect to first-party login without looping; preserve only a safe internal return URL and never place credentials/session IDs in URLs/storage.
- Loading: initial skeleton or progress region with `aria-busy`; do not replace stale valid data with fake values.
- Empty: explain what data source was queried and the legitimate next action; distinguish “no records” from “not configured” and “insufficient labels”.
- Error: keep the failing section/page context, provide retry when safe, and avoid rendering raw stack traces or credentials.
- Unavailable integration: name which service is unavailable/unconfigured and what remains blocked. A gray “unknown” state must not appear as green/healthy.

## 4. Professional design-system specification

These tokens are a proposal for both modes, not implemented styles. Establish tokens once in a shared theme foundation and consume them across controls, charts, tables, and status elements. Prefer opaque or near-opaque surfaces and accessible contrast over decorative low-contrast transparency.

### Semantic color tokens

| Token | Light mode proposal | Dark mode proposal | Use |
|---|---|---|---|
| `--color-canvas` | `#F5F7FA` | `#0B1220` | Main page background |
| `--color-surface` | `#FFFFFF` | `#111C2D` | Cards, panels, menus |
| `--color-surface-raised` | `#FFFFFF` | `#172438` | Dialogs, popovers, elevated panels |
| `--color-surface-muted` | `#EEF2F7` | `#1C2A3F` | Table headers, muted sections |
| `--color-text-primary` | `#172033` | `#F1F5FB` | Main labels/headings |
| `--color-text-secondary` | `#526176` | `#B7C4D6` | Supporting copy |
| `--color-text-muted` | `#68778C` | `#94A3B8` | Timestamps/tertiary labels; verify contrast at actual sizes |
| `--color-border` | `#D8E0EA` | `#2B3B52` | Dividers, inputs, card outlines |
| `--color-primary` | `#2457D6` | `#86A9FF` | Primary action and selected navigation |
| `--color-primary-hover` | `#1D46B2` | `#A4BCFF` | Hover/active state |
| `--color-focus-ring` | `#155EEF` | `#9CB8FF` | Clearly visible keyboard focus, with offset |
| `--color-chart-1` | `#2457D6` | `#86A9FF` | Primary series |
| `--color-chart-2` | `#00856A` | `#42C6A5` | Secondary series |
| `--color-chart-grid` | `#D8E0EA` | `#31425B` | Grid/axis support |
| `--color-status-healthy` | `#18794E` | `#54D39A` | Healthy/success |
| `--color-status-warning` | `#8A5A00` | `#F5C15D` | Warning/attention |
| `--color-status-failed` | `#B42318` | `#FF8A80` | Failure/critical |
| `--color-status-pending` | `#526176` | `#A9B8CB` | Pending/unknown |
| `--color-status-verified` | `#145A45` | `#6BD6B1` | Verified provenance only after an authoritative trust path exists |

Status colors must be accompanied by labels/icons and pass WCAG contrast checks in both themes. “Verified” must not be applied to a record merely because a source string or timestamp is present.

### Type, spacing, layout, and component rules

- Use the existing system-font stack as the default; current CSS references Inter but the manifest does not bundle it. If adopting a licensed/self-hosted typeface, decide that separately. Use a restrained scale: 12/14 px metadata, 16 px body, 20 px section title, 24/28 px page title, 32/40 px major marketing headings; body line height about 1.5.
- Use a 4 px spacing base with named steps (4, 8, 12, 16, 24, 32, 40, 48). Prefer a compact operational density without making tables or controls cramped.
- Content max width: about 1440 px for data-heavy workspace, with a readable narrower measure for prose/forms. Sidebar target 240–264 px desktop; top bar 56–64 px; card padding 20–24 px.
- Use consistent 1 px borders, 8 px control radius, 10–12 px card/dialog radius, restrained elevation, and clear dividers. Avoid overusing glow/gradient effects.
- Buttons: primary/secondary/tertiary/destructive styles with equivalent focus, hover, disabled, loading, and touch states. Disabled must retain readable contrast and explain unavailable prerequisites.
- Inputs/forms: visible labels, persistent help text, programmatic error association, required/optional indication, inline validation, no color-only errors, keyboard-safe autocomplete.
- Cards: heading hierarchy, optional status summary, timestamp/provenance, concise body. Avoid nested card borders without hierarchy.
- Tables: proper caption or accessible name, scoped column headers, predictable sorting/pagination controls, row details reachable by keyboard, responsive layout that preserves all critical fields.
- Charts: use existing Recharts; provide title, accessible summary and tabular alternative, distinguish series with more than color (dash/marker/pattern), and retain labels/units/time-zone context.
- Dialogs: add only when an existing workflow requires confirmation; use a focus trap, labelled title, Escape policy, return focus, and explicit destructive-action wording. No dialog library is currently present.
- Icons: use one consistent existing/approved icon system (currently none is installed); accessible name for meaningful icons, `aria-hidden` for decorative icons. Do not mix arbitrary Unicode shapes with new icon packs.

### Theme behavior

Default to `system` on first visit, resolving `prefers-color-scheme` before first paint to avoid a flash. Provide explicit `Light`, `Dark`, and `System` preference. Persist the explicit choice in local storage (or in the user profile only after a real profile API exists); do not store access/refresh tokens in local storage. Subscribe to OS theme changes only while preference is `System`. Set `color-scheme` on the document so native inputs/dialogs are consistent, and ensure charts use semantic theme values. A design phase should test all components in both modes rather than invert colors mechanically.

### Application/public layout

- **Authenticated shell:** persistent desktop sidebar grouped by Overview, Monitor, Investigate, Lifecycle, and Administration only where APIs support the item. Compact top bar should contain current page context, system/integration state, refresh status, theme switch, and account menu after auth exists. Mobile navigation must have an accessible name, expanded state, keyboard handling, and reliable focus behavior.
- **Public/auth shell:** separate, lighter and simpler public layout with product header, concise value proposition, sign-in/register destinations when implemented, and privacy/security links. Do not show operational metrics on unauthenticated landing pages.
- **Unavailable navigation:** hide or mark future/inaccessible capabilities honestly; do not make a button look active if the feature is blocked. When visible as roadmap, label it “Not configured” and make it non-actionable.

## 5. Page-to-API integration matrix

All endpoint paths below are from `ml-drift-lens-backend/server.js`, `routes/`, and `controllers/`. API methods exposed by the frontend are from `src/services/apiClient.ts`; cookie credentials and in-memory CSRF header handling are enabled.

| Page / data | Existing backend integration | Frontend capability | Access / gaps |
|---|---|---|---|
| Overview metrics | `GET /api/metrics` computes counts and accuracy/precision/recall/F1 from current-model prediction records with `actual_label`. | Dashboard calls it with cookies after session restoration. | Requires account session. All registered accounts see shared results; `null` metrics mean unavailable/insufficient, not a value to synthesize. |
| Drift | `GET /api/drift`, `GET /api/drift/history` (limit/offset). | Dashboard and `/drift` call with cookies after session restoration. | Requires account session. No detailed windows/feature attribution or detector-configuration endpoint. `insufficient_data` is not a zero score. |
| Alerts | `GET /api/alerts` with pagination. | Dashboard displays recent rows after session restoration. | Requires account session; no dedicated page/event stream/detail endpoint. Alert writes remain blocked pending policy. |
| Models and active model | `GET /api/models`, `GET /api/model-info`. | Dashboard model table; prediction form uses model metadata; `ModelInformation` component exists but is not routed. | Requires account session. No registry page, artifact inventory/retrieval, or model comparison endpoint. Model mutation routes are guarded and policy-blocked. |
| Retraining | `GET /api/retraining`, `GET /api/retraining/:id`. Guarded `POST /api/retraining`, `POST /api/retraining/:id/promote`, `PUT` and `DELETE` job paths. | Dashboard shows lifecycle, counts, candidate/incumbent F1, persisted errors and promotion/reload fields. | Reads require session; mutation endpoints require session/Origin/CSRF and remain policy-blocked. `candidate_ready` is not a deployment state. |
| Predictions | `GET /api/predictions` supports limit/offset; `POST /api/predictions` invokes inference and persists a result; protected `PUT/DELETE /api/predictions/:id`. | `PredictionForm` posts a static NSL-KDD sample; history and dashboard fetch records with cookies. | Reads and creation require session; creation additionally requires Origin/CSRF and is rate-limited. No general schema-driven form, search/filter/detail, or safe label-provenance workflow. Records are shared, not user-owned. |
| Health/readiness | `GET /api/health`, `/api/ready`; `GET /api/model-info`. | Header, dashboard and SystemStatus call endpoints as applicable. | Health/readiness remain public. `/api/model-info` requires a session. Improve distinction between unreachable and unhealthy responses. |
| Authentication | Native email/password endpoints with PostgreSQL-backed sessions. | Real register/login/logout, session restoration, safe return destinations, cookie credentials, in-memory CSRF token, and protected routes. | Recovery/reset/verification/MFA remain unavailable; no OIDC/provider contract is used. |
| Deployments | Render staging client has mocked create/get methods and staging configuration gates. | No API client method, page, button, state display, or deployment API route. | Not operational. No durable artifact retrieval, persisted deploy ID/polling, or live active-model/hash verification. |
| Settings/profile/admin | No corresponding profile, roles, integrations or audit-log APIs were found. | No corresponding pages/routes. | Account management, roles, and audit contracts require product/security decisions before UI work. |

### API/data integrity rules for future pages

1. Use real API responses only; use the existing API client and error conventions as the initial pattern.
2. Keep distinct states for request loading, no records, insufficient data, unavailable service, and unauthorized access.
3. Do not infer ground-truth trust from `actual_label`, a source name, or a timestamp alone.
4. Do not equate local artifact checksums with durable storage or use Render API acceptance as proof of a live model.
5. A redeploy control must remain absent/disabled until server-side authorization, durable artifact validation/retrieval, explicit staging targeting, persisted deployment state, and independent live version/checksum verification all exist.
6. Pagination/search should be server-side when querying large histories; current limit/offset methods provide pagination, but no search/filter query contract was found.

## 6. Recommended implementation phases and acceptance criteria

Group closely related work into small reviewable prompts; each prompt should preserve source behavior and add focused tests.

| Phase | Scope and recommended prompt grouping | Acceptance criteria |
|---|---|---|
| 1. Audit and blueprint | This document only. | Existing routes, APIs, auth gaps, current UI and blockers are source-backed; no application behavior changed. |
| 2. Shared design foundations | Add semantic light/dark tokens, theme initialization/persistence, typography/spacing, focus styles, reduced-motion rules, and accessible shared primitives. Group token/theme with primitive and accessibility baselines. | Existing dashboard behavior unchanged; both modes tested; first paint follows system; explicit choice persists; keyboard/focus/contrast and reduced motion pass focused checks; no new dependency without justification. |
| 3. Public shell and landing | Add public shell and truthful landing, route shell and not-found route. Resolve old dashboard `/` compatibility as part of route change. | Landing is public without data leakage; old dashboard has deliberate safe route/redirect and its existing tests pass; title/meta are correct. |
| Auth UI status pages | Keep honest account-lifecycle destinations. | Registration/login submit to native endpoints; recovery/reset/verification remain unavailable; tests assert no fake unsupported flows. |
| Native registration/login | Integrate the first-party email/password backend endpoints. | Registration, login, session restoration/logout, CSRF handling, generic errors, and lifecycle limitations are implemented and unit-tested; configured browser E2E remains outstanding; no secrets/session IDs in browser storage. |
| Recovery and verification | Implement only after an application recovery/email-delivery contract is approved and built. | Expired/reused tokens and account-enumeration risks handled; no claim of support until an end-to-end workflow is verified. |
| Protected app shell | Protect the existing application route group with the session client and backend policy. | Session restoration gates protected routes; unauthenticated navigation preserves a safe internal destination; server remains source of authorization; tests verify signed-out access does not fetch dashboard data. |
| Monitoring, lifecycle, deployment, QA | Continue bounded work under master phases 5–7. | Follow evidence-backed acceptance criteria in the master roadmap; no fabricated data or operational status. |

Each implementation prompt should cover at most two or three closely related phases/tasks. Do not start Phase 2 from this audit without review.

## 7. Blockers and external decisions

1. **Authorization policy:** shared/global read and prediction access is approved for all registered accounts. Decide who may submit labels or mutate alerts, drift, retraining, model lifecycle, and promotion. No ownership, tenant, operator/admin role, or service identity model exists.
3. **Ground truth:** authoritative label provider and verification/accountability process. The source allowlist is not a trust provider and does not verify label truth.
4. **Artifacts:** durable shared artifact provider, immutable reference/retention policy, and authenticated retrieval implementation. Current manifest verifies local file integrity only.
5. **Deployments:** staging Render service ID and server-side credential, persisted backend deployment lifecycle/polling and concurrency behavior, plus independent staging inference health/model-info access. The mockable Render client alone is not enough.
6. **Product decisions:** whether additional account lifecycle features are required, which user role can queue/promote models, which filters/columns/search semantics prediction/drift pages require, and what “evaluation” means for this model/data.

## 8. Validation commands

Commands defined by the active frontend package:

```powershell
Set-Location ml-drift-lens-frontend
npm run build
npx vitest run
```

`npm run build` runs TypeScript (`tsc`) and the Vite production build. Vitest uses jsdom. No lint or Markdown formatting script was found in the inspected frontend manifest. Latest validation for the authentication work:

```powershell
Set-Location ml-drift-lens-backend
npm test
node --test tests/authentication.test.js tests/protectedRoutes.test.js tests/healthController.test.js tests/diagnosticsRoutes.test.js
Set-Location ..\ml-drift-lens-frontend
npx vitest run
npm run build
npm run test:e2e
git diff --check
```

Phase 7 release validation confirmed all suites pass:
- Full backend suite: **111 passed, 0 failed, 1 opt-in test skipped**.
- PostgreSQL integration suite: **3/3 subtests passed** against dedicated local test database `ml_drift_lens_auth_phase4_test_20261025`, verifying Express persistence, child process restart persistence, password recovery token lifecycles, PostgreSQL session revocation, and email verification.
- Frontend Vitest suite: **70/70 passed across 15 test files**.
- Production build (`npm run build`): **Succeeded in 9.49s with 0 TypeScript errors** (646 modules transformed).
- Real-browser Playwright E2E suite: **14/14 tests passed in Chromium** across 14 scenarios (including login, registration, session reload, route protection, logout cookie expiration, CSRF / origin rejection, password recovery, password reset matching, and email verification resend).
- Clean whitespace check: `git diff --check` passed with 0 errors.
- Live preview: running on `http://127.0.0.1:5180` proxied to backend on port 3008. Staging/production deployment remains an external lifecycle gate.

## 9. Files inspected

### Frontend

- `ml-drift-lens-frontend/package.json`, `package-lock.json`
- `ml-drift-lens-frontend/index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`
- `ml-drift-lens-frontend/src/main.tsx`, `App.tsx`, `App.css`, `index.css`, `style.css`
- `ml-drift-lens-frontend/src/components/Dashboard.tsx`, `Dashboard.test.tsx`
- `ml-drift-lens-frontend/src/components/PredictionForm.tsx`, `PredictionForm.test.tsx`
- `ml-drift-lens-frontend/src/components/PredictionHistory.tsx`
- `ml-drift-lens-frontend/src/components/SystemStatus.tsx`
- `ml-drift-lens-frontend/src/components/ModelInformation.tsx`
- `ml-drift-lens-frontend/src/services/apiClient.ts`, `apiClient.test.ts`
- `ml-drift-lens-frontend/.env.example` (names/purpose only; no values reproduced)
- `ml-drift-lens-frontend/ml-drift-lens-frontend/` presence and separation from active entrypoint

### Backend/API and project documentation

- `ml-drift-lens-backend/server.js`
- `ml-drift-lens-backend/routes/healthRoutes.js`, `metricsRoutes.js`, `diagnosticsRoutes.js`, `predictionsRoutes.js`, `driftRoutes.js`, `alertsRoutes.js`, `modelsRoutes.js`, `retrainingRoutes.js`
- `ml-drift-lens-backend/controllers/metricsController.js`, `predictionsController.js`, `driftController.js`, `alertsController.js`, `modelsController.js`, `retrainingController.js`, `healthController.js`, `diagnosticsController.js`
- `ml-drift-lens-backend/middleware/requireOidcScope.js`
- `ml-drift-lens-backend/utils/oidcConfig.js`, `tests/oidcConfig.test.js`, `tests/requireOidcScope.test.js`, `tests/protectedRoutes.test.js`, `tests/diagnosticsController.test.js`
- `ml-drift-lens-backend/tests/authentication.test.js`, `tests/authenticationPostgres.integration.test.js`, `tests/healthController.test.js`, `tests/diagnosticsRoutes.test.js`
- `ml-drift-lens-frontend/src/App.tsx`, `src/services/apiClient.ts`, `src/components/AuthStatusPage.tsx`, `src/components/AuthStatusPage.test.tsx`, `vite.config.ts`, `nginx.conf`
- `ml-drift-lens-backend/services/renderStagingClient.js`
- `.env.example`, `docker.env.example`, `docker-compose.yml`
- `README.md`, `REPOSITORY_AUDIT.md`, `REDEPLOY_WORKFLOW_AUDIT.md`
- Initial `git status --short`, branch/status summary, and `git diff --check`

The current follow-up changed the backend route/test wiring and frontend auth tests, README guidance, and this blueprint. Other pre-existing worktree changes were preserved.
