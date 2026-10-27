"""FastAPI application for ModelWatch inference service."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError, validator

from .config import InferenceConfig
from .model_loader import ModelArtifactError, ModelLoader
from .predictor import PredictionError, Predictor

logger = logging.getLogger(__name__)


def active_model_version(metadata: dict[str, Any]) -> str | None:
    """Return the active model version for either production or candidate metadata."""
    return metadata.get("model_version") or metadata.get("candidate_version") or None


# Pydantic request/response models
class PredictionRequest(BaseModel):
    """Request model matching prediction_request.schema.json."""

    model_id: str = Field(..., min_length=1)
    model_version: str = Field(..., min_length=1)
    preprocessing_version: str = Field(..., min_length=1)
    input_features: dict[str, Any]
    request_id: str | None = None

    model_config = ConfigDict(extra="forbid")  # Match additionalProperties: false


class PredictionResponse(BaseModel):
    """Response model matching prediction_response.schema.json."""

    model_id: str
    model_version: str
    preprocessing_version: str
    prediction: str = Field(..., description="'normal' or 'attack'")
    prediction_class: int = Field(..., description="0 or 1")
    confidence: float = Field(..., ge=0, le=1)
    request_id: str | None = None
    timestamp: str | None = None

    model_config = ConfigDict(extra="forbid")  # Match additionalProperties: false


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    message: str
    model_id: str | None = None
    model_version: str | None = None


class ReadyResponse(BaseModel):
    """Readiness check response."""

    ready: bool
    model_loaded: bool
    message: str
    model_id: str | None = None
    model_version: str | None = None
    reload_status: str | None = None


class ReloadRequest(BaseModel):
    """Safe reload request using an approved production model reference."""

    model_id: str = Field(..., min_length=1)
    model_version: str = Field(..., min_length=1)

    model_config = ConfigDict(extra="forbid")


class ReloadResponse(BaseModel):
    """Result payload for a model reload operation."""

    status: str
    message: str
    model_id: str | None = None
    model_version: str | None = None
    active_model_version: str | None = None
    artifact_path: str | None = None
    reload_status: str | None = None
    error: str | None = None


def create_app(config: InferenceConfig, model_loader: ModelLoader) -> FastAPI:
    """Create and configure FastAPI application."""
    app = FastAPI(
        title="ModelWatch Inference Service",
        description="Production-ready inference service for NSL-KDD baseline model",
        version="0.5.0",
    )

    @app.on_event("startup")
    async def startup_event() -> None:
        """Load model on startup."""
        app.state.is_loading = True
        app.state.startup_error = None
        try:
            logger.info("Loading model on startup...")
            model_loader.load()
            logger.info("Model loaded successfully")

            # Create predictor and store in app state
            app.state.predictor = Predictor(model_loader.model, model_loader.contract, model_loader.metadata)
            logger.info("Predictor initialized")

        except ModelArtifactError as e:
            logger.error(f"Failed to load model: {e}")
            app.state.startup_error = str(e)
        except Exception as e:
            logger.error(f"Unexpected error loading model: {e}")
            app.state.startup_error = str(e)
        finally:
            app.state.is_loading = False

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        """Health check endpoint - process is alive."""
        metadata = model_loader.metadata if model_loader.is_loaded() else {}
        return HealthResponse(
            status="healthy",
            message="Inference service is running",
            model_id=(metadata.get("model_id") or metadata.get("model_name") or None),
            model_version=active_model_version(metadata),
        )

    @app.get("/ready", response_model=ReadyResponse)
    async def ready(response: Response) -> ReadyResponse:
        """Readiness check endpoint - model is loaded and ready."""
        model_ready = model_loader.is_loaded()
        metadata = model_loader.metadata if model_ready else {}
        is_loading = getattr(app.state, "is_loading", False)
        startup_error = getattr(app.state, "startup_error", None)

        if not model_ready:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            if is_loading:
                message = "Model initialization in progress"
                reload_status = "initializing"
            elif startup_error:
                message = f"Model failed to load: {startup_error}"
                reload_status = "failed"
            else:
                message = "Model not yet loaded"
                reload_status = "not_ready"

            return ReadyResponse(
                ready=False,
                model_loaded=False,
                message=message,
                model_id=None,
                model_version=None,
                reload_status=reload_status,
            )

        return ReadyResponse(
            ready=True,
            model_loaded=True,
            message="Model is ready for inference",
            model_id=(metadata.get("model_id") or metadata.get("model_name") or None),
            model_version=active_model_version(metadata),
            reload_status="stable",
        )

    @app.post("/reload", response_model=ReloadResponse)
    async def reload_model(request: ReloadRequest) -> ReloadResponse:
        """Reload the exact promoted version from the trusted production artifact."""
        try:
            artifact = model_loader.load_approved_reference(
                model_id=request.model_id,
                model_version=request.model_version,
            )
            predictor = Predictor(artifact["model"], artifact["contract"], artifact["metadata"])
            model_loader.activate_artifact(artifact)
            app.state.predictor = predictor
            metadata = model_loader.metadata
            version = active_model_version(metadata)

            return ReloadResponse(
                status="success",
                message="Promoted production model loaded and activated",
                model_id=metadata.get("model_id") or metadata.get("model_name"),
                model_version=version,
                active_model_version=version,
                reload_status="success",
                error=None,
            )
        except ModelArtifactError as exc:
            logger.error(f"Candidate reload failed: {exc}")
            current_metadata = model_loader.metadata if model_loader.is_loaded() else {}
            message = str(exc)

            raise HTTPException(
                status_code=400,
                detail={
                    "status": "failed",
                    "message": "Model reload failed",
                    "model_id": current_metadata.get("model_id") or current_metadata.get("model_name"),
                    "model_version": active_model_version(current_metadata),
                    "reload_status": "failed",
                    "error": message,
                },
            ) from exc

    @app.post("/predict", response_model=PredictionResponse)
    async def predict(request: PredictionRequest) -> PredictionResponse:
        """
        Execute prediction on input features.

        Validates request against prediction_request.schema.json,
        executes inference, and returns response matching prediction_response.schema.json.
        """
        # Get predictor from app state
        predictor = getattr(app.state, "predictor", None)
        if predictor is None:
            logger.error("Predictor not initialized")
            raise HTTPException(status_code=503, detail="Model not loaded")

        # Generate request_id if not provided
        request_id = request.request_id or str(uuid.uuid4())

        try:
            metadata = model_loader.metadata
            active_model_id = metadata.get("model_id") or metadata.get("model_name")
            active_version = active_model_version(metadata)
            if (
                (active_model_id and request.model_id != active_model_id)
                or request.model_version != active_version
                or request.preprocessing_version != metadata.get("preprocessing_version")
            ):
                raise HTTPException(status_code=409, detail="Requested model metadata does not match the loaded model")

            logger.info(f"Processing prediction request {request_id}")

            # Execute prediction
            prediction_result = predictor.predict(request.input_features)

            # Create response
            response = PredictionResponse(
                model_id=active_model_id or request.model_id,
                model_version=active_version,
                preprocessing_version=metadata.get("preprocessing_version"),
                prediction=prediction_result["prediction"],
                prediction_class=prediction_result["prediction_class"],
                confidence=prediction_result["confidence"],
                request_id=request_id,
            )

            logger.info(
                f"Prediction completed: request_id={request_id}, "
                f"prediction={response.prediction}, confidence={response.confidence:.3f}"
            )

            return response

        except HTTPException:
            raise
        except PredictionError as e:
            logger.error(f"Prediction error in request {request_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Prediction failed: {e}") from e
        except ValidationError as e:
            logger.error(f"Validation error in request {request_id}: {e}")
            raise HTTPException(status_code=422, detail=f"Invalid input: {e}") from e
        except Exception as e:
            logger.error(f"Unexpected error in request {request_id}: {e}")
            raise HTTPException(status_code=500, detail="Internal server error") from e

    @app.get("/model/info")
    async def model_info() -> dict[str, Any]:
        """Get loaded model metadata and the persisted evaluation metrics."""
        if not model_loader.is_loaded():
            startup_error = getattr(app.state, "startup_error", None)
            is_loading = getattr(app.state, "is_loading", False)
            if is_loading:
                detail = "Model initialization in progress"
            elif startup_error:
                detail = f"Model failed to load: {startup_error}"
            else:
                detail = "Model not loaded"
            raise HTTPException(status_code=503, detail=detail)

        metadata = model_loader.metadata
        validation_metrics = metadata.get("validation_metrics") or {}
        test_metrics = metadata.get("test_metrics") or {}
        summary_metrics = test_metrics or validation_metrics or {}
        summary_metrics = dict(summary_metrics)

        return {
            "model_name": metadata.get("model_id") or metadata.get("model_name") or "nsl-kdd-baseline",
            "model_version": active_model_version(metadata),
            "preprocessing_version": metadata.get("preprocessing_version"),
            "model_type": metadata.get("model_type"),
            "dataset": "NSL-KDD",
            "feature_count": metadata.get("num_features"),
            "num_features": metadata.get("num_features"),
            "training_timestamp": metadata.get("training_timestamp"),
            "validation_metrics": validation_metrics,
            "test_metrics": test_metrics,
            "metrics": summary_metrics,
        }

    return app
