FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

WORKDIR /app

COPY ml/inference-requirements.txt /app/ml/inference-requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: --prefer-binary \
    --timeout 120 --retries 10 \
    -r /app/ml/inference-requirements.txt

COPY ml /app/ml

# Deployment artifact staging: populate the approved baseline as the active production model
RUN mkdir -p /app/ml/artifacts/candidates /app/ml/artifacts/.promotion-backups \
 && cp /app/ml/artifacts/validation/nsl-kdd-20260928/model.joblib /app/ml/artifacts/model.joblib \
 && cp /app/ml/artifacts/validation/nsl-kdd-20260928/metadata.json /app/ml/artifacts/metadata.json

EXPOSE 8000 5000
CMD ["python", "-m", "ml.inference.main", "--host", "0.0.0.0"]
