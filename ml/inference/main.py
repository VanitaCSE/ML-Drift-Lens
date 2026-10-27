"""Entry point for the inference service."""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import uvicorn

from .app import create_app
from .config import InferenceConfig
from .model_loader import ModelLoader


def setup_logging(log_level: str) -> None:
    """Configure logging for the application."""
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )


def main(config: InferenceConfig | None = None) -> None:
    """Run the inference service."""
    if config is None:
        config = InferenceConfig.from_environment()

    setup_logging(config.log_level)
    logger = logging.getLogger(__name__)

    logger.info(f"Starting inference service on {config.host}:{config.port}")
    logger.info(f"Model artifact: {config.model_artifact_path}")

    # Initialize model loader
    model_loader = ModelLoader(config.model_artifact_path)

    # Create FastAPI app
    app = create_app(config, model_loader)

    # Run server
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        log_level=config.log_level.lower(),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ModelWatch Inference Service")
    parser.add_argument("--host", default=os.getenv("INFERENCE_HOST", "0.0.0.0"), help="Server host")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", os.getenv("INFERENCE_PORT", "8000"))), help="Server port")
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"), help="Log level")
    parser.add_argument(
        "--model-path",
        type=Path,
        default=Path(os.getenv("MODEL_ARTIFACT_PATH", "ml/artifacts/model.joblib")),
        help="Path to model artifact",
    )
    args = parser.parse_args()

    config = InferenceConfig(
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        model_artifact_path=args.model_path,
        mlflow_tracking_uri=None,
        mlflow_registered_model_name=None,
        mlflow_model_version=None,
    )

    main(config)
