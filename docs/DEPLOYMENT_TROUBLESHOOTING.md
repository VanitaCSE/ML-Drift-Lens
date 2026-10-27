# ML-Drift-Lens — Production Deployment & Troubleshooting Guide

## 1. System Architecture & Topology

ML-Drift-Lens consists of three integrated components deployed to Render:

1. **ML Inference Service (`ml-drift-lens` / `ml-drift-lens-inference`)**:
   - Runtime: Docker container (`ml/Dockerfile`) running Python 3.11 with FastAPI and Uvicorn.
   - Public URL: `https://ml-drift-lens.onrender.com`
   - Liveness Probe: `GET /health` (Process alive)
   - Readiness Probe: `GET /ready` (Model loaded & ready for inference)
   - Model Info: `GET /model/info`
   - Prediction: `POST /predict`
   - Canonical Artifact: `ml/artifacts/validation/nsl-kdd-20260928/{model.joblib, metadata.json}` staged to `/app/ml/artifacts/model.joblib`.

2. **Backend & Unified Frontend Service (`ml-drift-lens-backend`)**:
   - Runtime: Multi-stage Docker container (`ml-drift-lens-backend/Dockerfile`) with Node.js 22 and PostgreSQL client.
   - Public URL: `https://ml-drift-lens-backend.onrender.com`
   - Liveness Probe: `GET /api/health`
   - Readiness Probe: `GET /api/ready`
   - Model Proxy: `GET /api/model-info` (requires session auth)
   - Prediction Proxy: `POST /api/predictions` (requires session auth, CSRF, origin check)
   - Database: Managed Render PostgreSQL (`ml-drift-lens-db`)

3. **Frontend Application (React + Vite)**:
   - Built into static production assets served directly from `ml-drift-lens-backend` at root `/` under single-origin architecture.

---

## 2. Root Cause Analysis: Production HTTP 502 & 503 Incidents

### Root Cause 1: Crash-on-Startup vs Fault-Tolerant Lifecycle
- **Defect**: In `ml/inference/app.py`, `@app.on_event("startup")` re-raised `ModelArtifactError` with `raise`.
- **Production Impact**: If model artifact verification failed or took time during container boot, the Uvicorn process terminated with an unhandled exception before opening port 8000. Render's edge gateway received `ECONNREFUSED` and returned **HTTP 502 Bad Gateway**.
- **Fix**: FastAPI startup now catches `ModelArtifactError`, records `app.state.startup_error`, and keeps the server alive. Liveness (`/health`) reports that the process is running, while readiness (`/ready`) returns **HTTP 503** with the exact diagnostic message.

### Root Cause 2: Inaccurate Readiness Status Code Masking Container State
- **Defect**: `/ready` endpoint returned `ReadyResponse(ready=False, model_loaded=False, ...)` but defaulted to **HTTP 200 OK**.
- **Production Impact**: Render's health check (`healthCheckPath: /ready`) uses the HTTP status code (expecting 200). Because `/ready` returned 200 even when `ready` was false, Render routed client traffic to containers before the model was loaded.
- **Fix**: `/ready` now returns **HTTP 503 Service Unavailable** whenever `not model_loader.is_loaded()`, distinguishing between active loading (`"Model initialization in progress"`) and failure (`"Model failed to load: ..."`).

### Root Cause 3: Non-Idempotent Request Retry Safety & Cold-Start Timeout Mismatch
- **Defect**: Render free/starter tiers spin down after 15 minutes of inactivity. Container cold starts require **25–45 seconds**. Previously, client networking timed out or retried indiscriminately.
- **Production Impact**: Mutation requests (`POST /predict`) could suffer duplicate submission attempts on timeout.
- **Fix**: In `ml-drift-lens-backend/services/mlServiceClient.js`, idempotent read requests (`GET /model/info`, `GET /ready`, `GET /health`) employ bounded exponential backoff `[2000, 3500, 6000, 9000, 12000]` ms spanning cold-start durations, while non-idempotent write requests (`POST /predict`) never retry on timeouts.

### Root Cause 4: Local Workspace Staging Drift
- **Defect**: Local workspace `ml/artifacts/metadata.json` had been overwritten during previous experimental retraining candidate runs, referencing uncommitted candidate sidecars.
- **Production Impact**: Local invocations of `ModelLoader.load()` crashed with `ModelArtifactError: Promoted candidate metadata is missing`.
- **Fix**: Staged canonical production baseline `ml/artifacts/validation/nsl-kdd-20260928/` into `ml/artifacts/`, and added `mkdir -p /app/ml/artifacts/candidates` to `ml/Dockerfile`.

---

## 3. Render Service Configuration Reference

| Setting | ML Inference Service (`ml-drift-lens`) | Node Backend (`ml-drift-lens-backend`) |
|---|---|---|
| Service Type | Web Service | Web Service |
| Runtime | Docker | Docker |
| Dockerfile Path | `ml/Dockerfile` | `ml-drift-lens-backend/Dockerfile` |
| Docker Context | `.` (Root) | `.` (Root) |
| Health Check Path | `/ready` | `/api/health` |
| Port | `8000` | `3000` |
| Public URL | `https://ml-drift-lens.onrender.com` | `https://ml-drift-lens-backend.onrender.com` |
| Key Environment Variables | `PORT=8000`<br>`INFERENCE_HOST=0.0.0.0`<br>`MODEL_ARTIFACT_PATH=ml/artifacts/model.joblib` | `PORT=3000`<br>`ML_SERVICE_URL=https://ml-drift-lens.onrender.com`<br>`ML_SERVICE_TIMEOUT=15000`<br>`NODE_ENV=production` |

---

## 4. Manual Deployment Procedure in Render

Follow these exact steps to deploy the update safely:

### Step 1: Deploy ML Inference Service (`ml-drift-lens`)
1. Log in to your **Render Dashboard** (`https://dashboard.render.com`).
2. Navigate to your web service: **`ml-drift-lens`** (or `ml-drift-lens-inference`).
3. Click the **Manual Deploy** button in the upper-right corner.
4. Select **Deploy latest commit** (or **Clear build cache & deploy** if artifacts were cached).
5. Open the **Logs** tab and monitor startup:
   - Verify Docker build succeeds.
   - Look for the startup log lines:
     ```
     Loading model artifact from /app/ml/artifacts/model.joblib
     Model loaded successfully: model_version=nsl-kdd-validation-20260928
     Predictor initialized
     Application startup complete.
     Uvicorn running on http://0.0.0.0:8000
     ```
6. Check Render's deploy indicator until it turns green (**Live**).

### Step 2: Deploy Backend Service (`ml-drift-lens-backend`)
1. In the Render Dashboard, navigate to **`ml-drift-lens-backend`**.
2. Click **Manual Deploy → Deploy latest commit**.
3. Open the **Logs** tab and monitor:
   - Pre-deploy migrations run: `applyAllMigrations.js` finishes with success.
   - Vite builds frontend assets.
   - Express server starts: `ModelWatch backend listening on port 3000`.
4. Wait until the service status shows **Live**.

---

## 5. Post-Deployment Verification Probes

Verify the deployed services from any terminal using `curl` or Python:

```bash
# 1. Verify Inference Process Liveness
curl -I https://ml-drift-lens.onrender.com/health
# Expected: HTTP/2 200 OK

# 2. Verify Inference Model Readiness
curl https://ml-drift-lens.onrender.com/ready
# Expected: {"ready":true,"model_loaded":true,"message":"Model is ready for inference","model_id":"nsl-kdd-baseline","model_version":"nsl-kdd-validation-20260928","reload_status":"stable"}

# 3. Verify Inference Model Info
curl https://ml-drift-lens.onrender.com/model/info
# Expected: {"model_name":"nsl-kdd-baseline","model_version":"nsl-kdd-validation-20260928", ... ,"num_features":41}

# 4. Verify Backend Health
curl https://ml-drift-lens-backend.onrender.com/api/health
# Expected: {"status":"healthy","service":"modelwatch-backend","database_connected":true,"ml_service_healthy":true,...}

# 5. Verify Backend Readiness
curl https://ml-drift-lens-backend.onrender.com/api/ready
# Expected: {"ready":true,"model_loaded":true,"message":"Model is ready for inference"}
```

### Browser Verification
1. Open `https://ml-drift-lens-backend.onrender.com`.
2. Sign in with your account.
3. Navigate to **Predictions** → **Network Intrusion Prediction**.
4. Confirm:
   - Header shows **Active Model: `nsl-kdd-validation-20260928`**.
   - No HTTP 502 error banner is displayed.
   - The primary button displays **Predict** (enabled).
   - Clicking **Predict** evaluates the 41-feature sample connection telemetry and returns a prediction (`BENIGN TRAFFIC (NORMAL)` with confidence ~99.9%).

---

## 6. Rollback & Disaster Recovery

If Render fails to deploy or an unexpected issue occurs:
1. In the Render Dashboard under **Events**, locate the previous successful deployment.
2. Click the three dots (`...`) next to the previous successful deploy and select **Rollback to this deploy**.
3. Render will immediately restore and route traffic to the previous container image.
