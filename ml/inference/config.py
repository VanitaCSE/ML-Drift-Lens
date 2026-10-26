"""Environment-based configuration for the inference service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class InferenceConfig:
    """Configuration for the inference service."""

    # Server settings
    host: str
    port: int
    log_level: str

    # Model settings
    model_artifact_path: Path
    
    # Optional MLflow settings (for future model registry support)
    mlflow_tracking_uri: str | None
    mlflow_registered_model_name: str | None
    mlflow_model_version: str | None

    @classmethod
    def from_environment(cls) -> InferenceConfig:
        """Load configuration from environment variables with sensible defaults."""
        return cls(
            host=os.getenv("INFERENCE_HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", os.getenv("INFERENCE_PORT", "8000"))),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            model_artifact_path=Path(os.getenv("MODEL_ARTIFACT_PATH", "ml/artifacts/model.joblib")),
            mlflow_tracking_uri=os.getenv("MLFLOW_TRACKING_URI"),
            mlflow_registered_model_name=os.getenv("MLFLOW_REGISTERED_MODEL_NAME"),
            mlflow_model_version=os.getenv("MLFLOW_MODEL_VERSION"),
        )
