# NID ModelWatch - React Frontend

This is the React frontend for the ML-Drift-Lens model monitoring application.

## Overview

The frontend provides a simple dashboard to:
- View model information and performance metrics
- Submit network connection records for intrusion detection prediction
- View prediction history
- Check system health and readiness

## Architecture

```
React Frontend (Port 5173)
    ↓ same-origin /api requests through the Vite development proxy
Node.js/Express Backend API (native default port 3000; Compose default host port 23000)
    ↓
FastAPI ML Service (Port 8000)
    ↓
XGBoost Model + PostgreSQL
```

## Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Backend services running (Node.js backend and FastAPI)

### Installation

```bash
cd ml-drift-lens-frontend
npm install
```

### Configuration

For local development, leave `VITE_API_URL` empty so browser requests use the same-origin `/api` path. Configure the Vite proxy upstream separately:

```dotenv
VITE_API_URL=
VITE_API_PROXY_TARGET=http://localhost:3000
```

The native backend defaults to `http://localhost:3000`. The repository's Docker Compose setup publishes its backend at `http://localhost:23000` by default; when using that stack, set `VITE_API_PROXY_TARGET=http://localhost:23000`. The proxy avoids browser CORS requests to the backend. Use `VITE_API_URL` only when a browser-direct API origin is intentionally configured and its CORS policy permits the frontend origin.

### Development

Run the development server:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Production Build

Build for production:

```bash
npm run build
```

Output is in the `dist/` directory.

Preview the production build:

```bash
npm run preview
```

## Components

### ModelInformation
Displays model metadata and test metrics from the backend:
- Algorithm type (XGBoost)
- Model version
- Preprocessing version
- Number of features (41 NSL-KDD)
- Training timestamp
- Test metrics (accuracy, precision, recall, F1, ROC-AUC)

### PredictionForm
Allows users to submit prediction requests:
- Includes sample NSL-KDD network connection features
- Sends request to Node.js backend POST /api/predictions
- Displays prediction result and confidence
- Shows model version and request ID for tracing

### PredictionHistory
Shows recent predictions from the database:
- Fetches from GET /api/predictions
- Displays up to 10 most recent predictions
- Shows timestamp, model version, prediction, and confidence
- Handles loading, empty, and error states

### SystemStatus
Displays real-time backend and ML service status:
- Backend health (via GET /api/health)
- Service readiness (via GET /api/ready)
- Model loaded status
- Auto-refreshes every 30 seconds

## API Integration

The frontend communicates exclusively with the Node.js backend at `/api/*`:

### Endpoints Used
- `GET /api/model-info` - Get model metadata and metrics
- `GET /api/health` - Check backend health
- `GET /api/ready` - Check if model is loaded
- `POST /api/predictions` - Submit prediction request
- `GET /api/predictions` - Get prediction history

No direct calls to FastAPI service (all routing through Node backend).

## Testing

Run tests:

```bash
npm run test
```

Tests cover:
- API client functionality
- Error handling
- Component rendering (when added)
- User interactions (when added)

## Styling

The frontend uses CSS Grid and Flexbox for responsive design:
- Desktop: Full layout with proper spacing
- Tablet: Adjusted grid columns  
- Mobile: Single column layout

Color scheme:
- Primary: Blue (#2563eb)
- Success: Green (#10b981)
- Danger: Red (#ef4444)
- Neutral: Gray/Slate shades

## Deployment

### Docker (example)

```dockerfile
# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:18-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
```

### Nginx (example)

```nginx
server {
    listen 5173;
    server_name localhost;
    
    location / {
        root /app/dist;
        try_files $uri /index.html;
    }
    
    location /api {
        proxy_pass http://localhost:3000/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| VITE_API_URL | empty | Optional browser-direct API origin; leave empty to use the Vite proxy |
| VITE_API_PROXY_TARGET | http://localhost:3000 | Vite development proxy upstream; use port 23000 for the default Compose backend |

## File Structure

```
ml-drift-lens-frontend/
├── src/
│   ├── components/
│   │   ├── ModelInformation.tsx    - Model info display
│   │   ├── PredictionForm.tsx       - Prediction interface
│   │   ├── PredictionHistory.tsx    - Recent predictions
│   │   └── SystemStatus.tsx         - Backend status
│   ├── services/
│   │   ├── apiClient.ts            - API client
│   │   └── apiClient.test.ts       - API tests
│   ├── App.tsx                     - Main app component
│   ├── App.css                     - Application styles
│   ├── index.css                   - Global styles
│   └── main.tsx                    - Entry point
├── public/                         - Static assets
├── dist/                           - Production build output
├── index.html                      - HTML template
├── vite.config.ts                  - Vite configuration
├── vitest.config.ts                - Test configuration
├── tsconfig.json                   - TypeScript configuration
├── package.json                    - Dependencies
└── .env.local                      - Local environment (git-ignored)
```

## Troubleshooting

### Backend not accessible

1. Check the intended Express backend is running and responding at `/api/health`.
2. Confirm `VITE_API_URL` is empty for proxied development requests.
3. Confirm `VITE_API_PROXY_TARGET` points to the selected backend (native default port 3000 or Compose default host port 23000).
4. Check the browser console and Vite terminal for `/api` proxy connection errors.

### ML service unavailable

1. Check FastAPI service is running on port 8000
2. Verify ML_SERVICE_URL in Node backend .env
3. Check model artifact is loaded

### Predictions not displaying

1. Verify database connection in Node backend
2. Check PostgreSQL is running
3. Verify predictions table exists with correct schema

## Development Notes

- Uses React 18 with TypeScript
- Built with Vite for fast dev experience
- Testing with Vitest and React Testing Library
- Component-based architecture for reusability
- API client abstraction layer for maintainability
- Responsive design works on mobile/tablet/desktop

## Next Steps (Future Phases)

After Phase 7 basic frontend:
- Phase 8: Advanced visualization (charts, trends)
- Phase 9: Real-time monitoring dashboard
- Phase 10: Drift detection monitoring
- Phase 11: Model comparison interface

## License

See LICENSE file in repository root.
