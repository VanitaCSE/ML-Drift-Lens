# Stage 1: Build Frontend Static Assets
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build
COPY ml-drift-lens-frontend/package*.json ./
RUN npm ci
COPY ml-drift-lens-frontend ./
RUN npm run build

# Stage 2: Backend Runtime
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PATH="/opt/pyvenv/bin:$PATH"
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-venv libgomp1 \
	&& python3 -m venv /opt/pyvenv \
	&& rm -rf /var/lib/apt/lists/*

COPY ml/inference-requirements.txt /tmp/inference-requirements.txt
RUN pip install --no-cache-dir -r /tmp/inference-requirements.txt \
	&& rm /tmp/inference-requirements.txt

RUN pip install --no-cache-dir "SQLAlchemy==2.0.52" "mlflow==2.22.5"

COPY ml-drift-lens-backend/package*.json ./
RUN npm ci --omit=dev

COPY ml ./ml
COPY ml-drift-lens-backend ./ml-drift-lens-backend
COPY --from=frontend-builder /build/dist ./ml-drift-lens-frontend/dist

RUN mkdir -p /app/ml/artifacts/candidates /app/ml/artifacts/.promotion-backups \
	&& cp /app/ml/artifacts/validation/nsl-kdd-20260928/model.joblib /app/ml/artifacts/model.joblib \
	&& cp /app/ml/artifacts/validation/nsl-kdd-20260928/metadata.json /app/ml/artifacts/metadata.json \
	&& chown -R 1000:1000 /app/ml/artifacts

EXPOSE 3000
CMD ["node", "ml-drift-lens-backend/server.js"]
