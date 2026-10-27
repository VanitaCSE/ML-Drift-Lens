"""Tests for inference FastAPI application."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ml.inference.app import create_app
from ml.inference.config import InferenceConfig
from ml.inference.model_loader import ModelLoader
from ml.inference.predictor import Predictor


@pytest.fixture
def valid_artifact() -> dict[str, Any]:
    """Create a valid model artifact."""
    import numpy as np

    # Create and fit pipeline
    pipeline = Pipeline([("scaler", StandardScaler()), ("clf", LogisticRegression(random_state=42))])

    X = np.array([[1.0, 2.0], [2.0, 3.0], [4.0, 5.0], [5.0, 6.0]])
    y = np.array([0, 0, 1, 1])
    pipeline.fit(X, y)

    contract = {
        "features": {"feat1": "numeric", "feat2": "numeric"},
    }

    metadata = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "model_type": "logistic_regression",
        "num_features": 2,
        "training_timestamp": "2025-01-01T00:00:00+00:00",
        "validation_metrics": {
            "accuracy": 0.8,
            "precision": 0.75,
            "recall": 0.8,
            "f1": 0.77,
        },
        "test_metrics": {
            "accuracy": 0.82,
            "precision": 0.79,
            "recall": 0.81,
            "f1": 0.8,
        },
    }

    return {"model": pipeline, "contract": contract, "metadata": metadata}


@pytest.fixture
def artifact_file(valid_artifact: dict[str, Any], tmp_path: Path) -> Path:
    """Create a temporary production artifact and matching metadata sidecar."""
    artifact_path = tmp_path / "ml" / "artifacts" / "model.joblib"
    artifact_path.parent.mkdir(parents=True)
    joblib.dump(valid_artifact, artifact_path)
    artifact_path.with_name("metadata.json").write_text(json.dumps(valid_artifact["metadata"]), encoding="utf-8")
    return artifact_path


@pytest.fixture
def config(artifact_file: Path) -> InferenceConfig:
    """Create inference config."""
    return InferenceConfig(
        host="127.0.0.1",
        port=8000,
        log_level="INFO",
        model_artifact_path=artifact_file,
        mlflow_tracking_uri=None,
        mlflow_registered_model_name=None,
        mlflow_model_version=None,
    )


@pytest.fixture
def model_loader(artifact_file: Path) -> ModelLoader:
    """Create and load model loader."""
    loader = ModelLoader(artifact_file)
    loader.project_root = artifact_file.parents[2]
    loader.production_root = artifact_file.parent
    loader.load()
    return loader


@pytest.fixture
def client(config: InferenceConfig, model_loader: ModelLoader) -> TestClient:
    """Create FastAPI test client with loaded model."""
    app = create_app(config, model_loader)
    
    # TestClient should trigger startup events, but we explicitly initialize
    # the predictor to ensure it's available for tests
    model_loader.load()
    app.state.predictor = Predictor(
        model_loader.model, 
        model_loader.contract, 
        model_loader.metadata
    )
    
    return TestClient(app)


def test_health_endpoint(client: TestClient) -> None:
    """Test GET /health endpoint."""
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "message" in data


def test_ready_endpoint_model_loaded(client: TestClient) -> None:
    """Test GET /ready endpoint when model is loaded."""
    response = client.get("/ready")

    assert response.status_code == 200
    data = response.json()
    assert data["ready"] is True
    assert data["model_loaded"] is True


def test_predict_valid_request(client: TestClient) -> None:
    """Test POST /predict with valid request."""
    request_data = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "input_features": {"feat1": 1.0, "feat2": 2.0},
        "request_id": "req-123",
    }

    response = client.post("/predict", json=request_data)

    assert response.status_code == 200
    data = response.json()
    assert data["model_id"] == "test-model"
    assert data["model_version"] == "0.1.0"
    assert data["preprocessing_version"] == "0.1.0"
    assert data["prediction"] in ["normal", "attack"]
    assert data["prediction_class"] in [0, 1]
    assert 0.0 <= data["confidence"] <= 1.0
    assert data["request_id"] == "req-123"


def test_predict_generates_request_id_if_missing(client: TestClient) -> None:
    """Test that request_id is generated if not provided."""
    request_data = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "input_features": {"feat1": 1.0, "feat2": 2.0},
    }

    response = client.post("/predict", json=request_data)

    assert response.status_code == 200
    data = response.json()
    assert data["request_id"] is not None
    assert len(data["request_id"]) > 0


def test_predict_rejects_model_metadata_not_loaded(client: TestClient) -> None:
    response = client.post(
        "/predict",
        json={
            "model_id": "test-model",
            "model_version": "other-version",
            "preprocessing_version": "0.1.0",
            "input_features": {"feat1": 1.0, "feat2": 2.0},
        },
    )

    assert response.status_code == 409


def test_predict_missing_required_field(client: TestClient) -> None:
    """Test error when required field is missing."""
    request_data = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        # Missing preprocessing_version
        "input_features": {"feat1": 1.0, "feat2": 2.0},
    }

    response = client.post("/predict", json=request_data)

    assert response.status_code == 422  # Validation error


def test_predict_missing_features(client: TestClient) -> None:
    """Test error when input features are incomplete."""
    request_data = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "input_features": {"feat1": 1.0},  # Missing feat2
    }

    response = client.post("/predict", json=request_data)

    assert response.status_code == 400


def test_predict_extra_fields_rejected(client: TestClient) -> None:
    """Test that extra fields are rejected (additionalProperties: false)."""
    request_data = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "input_features": {"feat1": 1.0, "feat2": 2.0},
        "extra_field": "should_fail",
    }

    response = client.post("/predict", json=request_data)

    assert response.status_code == 422


def test_model_info_endpoint(client: TestClient) -> None:
    """Test GET /model/info endpoint."""
    response = client.get("/model/info")

    assert response.status_code == 200
    data = response.json()
    assert data["model_version"] == "0.1.0"
    assert data["preprocessing_version"] == "0.1.0"
    assert data["model_type"] == "logistic_regression"
    assert data["num_features"] == 2
    assert data["test_metrics"]["accuracy"] == 0.82
    assert data["test_metrics"]["precision"] == 0.79
    assert data["test_metrics"]["recall"] == 0.81
    assert data["test_metrics"]["f1"] == 0.8
    assert data["metrics"]["accuracy"] == 0.82


def _write_promoted_production(model_loader: ModelLoader, version: str, promoted: bool = True) -> None:
    metadata = dict(model_loader.metadata)
    metadata.update({
        "model_id": "reload-model",
        "model_version": version,
        "candidate_version": version,
        "preprocessing_version": "preprocessing-v2",
        "promoted": promoted,
    })
    payload = {"model": model_loader.model, "contract": model_loader.contract, "metadata": metadata}
    candidate_dir = model_loader.production_root / "candidates"
    candidate_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(payload, candidate_dir / f"{version}.joblib")
    (candidate_dir / f"{version}.json").write_text(json.dumps(metadata), encoding="utf-8")
    joblib.dump(payload, model_loader.artifact_path)
    model_loader.artifact_path.with_name("metadata.json").write_text(json.dumps(metadata), encoding="utf-8")


def test_predict_response_schema_compliance(client: TestClient) -> None:
    """Test that response strictly matches prediction_response.schema.json."""
    request_data = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "input_features": {"feat1": 1.0, "feat2": 2.0},
    }

    response = client.post("/predict", json=request_data)

    assert response.status_code == 200
    data = response.json()

    # Required fields
    assert "model_id" in data
    assert "model_version" in data
    assert "preprocessing_version" in data
    assert "prediction" in data
    assert "prediction_class" in data
    assert "confidence" in data

    # Type checks
    assert isinstance(data["model_id"], str)
    assert isinstance(data["model_version"], str)
    assert isinstance(data["preprocessing_version"], str)
    assert isinstance(data["prediction"], str)
    assert isinstance(data["prediction_class"], int)
    assert isinstance(data["confidence"], (int, float))

    # Value constraints
    assert data["prediction"] in ["normal", "attack"]
    assert data["prediction_class"] in [0, 1]


def test_reload_endpoint_uses_promoted_production_reference(model_loader: ModelLoader, config: InferenceConfig) -> None:
    version = "candidate-reload-endpoint"
    _write_promoted_production(model_loader, version)
    app = create_app(config, model_loader)
    client = TestClient(app)
    response = client.post("/reload", json={"model_id": "reload-model", "model_version": version})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["active_model_version"] == version
    assert data["model_id"] == "reload-model"
    assert client.get("/model/info").json()["model_version"] == version


def test_reload_rejects_caller_paths_unknown_versions_and_traversal(model_loader: ModelLoader, config: InferenceConfig) -> None:
    app = create_app(config, model_loader)
    client = TestClient(app)

    arbitrary_path = client.post(
        "/reload",
        json={"model_id": "reload-model", "model_version": "0.1.0", "artifact_path": "C:/outside/model.joblib"},
    )
    assert arbitrary_path.status_code == 422

    unknown = client.post("/reload", json={"model_id": "reload-model", "model_version": "missing-version"})
    assert unknown.status_code == 400
    traversal = client.post("/reload", json={"model_id": "reload-model", "model_version": "../../outside.joblib"})
    assert traversal.status_code == 400


def test_reload_rejects_unpromoted_candidate_and_keeps_current_model(model_loader: ModelLoader, config: InferenceConfig) -> None:
    version = "candidate-not-approved"
    metadata = {
        "model_id": "reload-model",
        "model_version": version,
        "candidate_version": version,
        "preprocessing_version": "preprocessing-v2",
        "promoted": False,
    }
    candidate_dir = model_loader.production_root / "candidates"
    candidate_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model_loader.model, "contract": model_loader.contract, "metadata": metadata}, candidate_dir / f"{version}.joblib")
    (candidate_dir / f"{version}.json").write_text(json.dumps(metadata), encoding="utf-8")
    app = create_app(config, model_loader)
    app.state.predictor = Predictor(model_loader.model, model_loader.contract, model_loader.metadata)
    current_model = model_loader.model
    current_metadata = model_loader.metadata

    response = TestClient(app).post("/reload", json={"model_id": "reload-model", "model_version": version})

    assert response.status_code == 400
    assert model_loader.model is current_model
    assert model_loader.metadata is current_metadata


def test_failed_reload_keeps_predictor_and_model_metadata(model_loader: ModelLoader, config: InferenceConfig) -> None:
    app = create_app(config, model_loader)
    app.state.predictor = Predictor(model_loader.model, model_loader.contract, model_loader.metadata)
    old_predictor = app.state.predictor
    old_model = model_loader.model
    old_metadata = model_loader.metadata
    model_loader.artifact_path.write_bytes(b"invalid artifact")

    response = TestClient(app).post("/reload", json={"model_id": "test-model", "model_version": "0.1.0"})

    assert response.status_code == 400
    assert app.state.predictor is old_predictor
    assert model_loader.model is old_model
    assert model_loader.metadata is old_metadata


def test_ready_endpoint_model_not_loaded_returns_503(config: InferenceConfig) -> None:
    """Test GET /ready returns HTTP 503 when the model is not loaded."""
    unloaded_loader = ModelLoader(Path("does_not_exist.joblib"))
    app = create_app(config, unloaded_loader)
    client = TestClient(app)

    response = client.get("/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["ready"] is False
    assert data["model_loaded"] is False
    assert "not yet loaded" in data["message"].lower()


def test_ready_endpoint_initialization_in_progress_returns_503(config: InferenceConfig) -> None:
    """Test GET /ready returns HTTP 503 while initialization is running."""
    unloaded_loader = ModelLoader(Path("does_not_exist.joblib"))
    app = create_app(config, unloaded_loader)
    app.state.is_loading = True
    client = TestClient(app)

    response = client.get("/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["ready"] is False
    assert data["reload_status"] == "initializing"
    assert "progress" in data["message"].lower()


def test_ready_endpoint_startup_error_returns_503(config: InferenceConfig) -> None:
    """Test GET /ready returns HTTP 503 with exact error if startup failed."""
    unloaded_loader = ModelLoader(Path("does_not_exist.joblib"))
    app = create_app(config, unloaded_loader)
    app.state.startup_error = "Simulated corruption in model artifact"
    client = TestClient(app)

    response = client.get("/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["ready"] is False
    assert data["reload_status"] == "failed"
    assert "Simulated corruption in model artifact" in data["message"]


def test_model_info_when_not_loaded_returns_503(config: InferenceConfig) -> None:
    """Test GET /model/info returns HTTP 503 when model is not loaded."""
    unloaded_loader = ModelLoader(Path("does_not_exist.joblib"))
    app = create_app(config, unloaded_loader)
    client = TestClient(app)

    response = client.get("/model/info")
    assert response.status_code == 503
    data = response.json()
    assert "detail" in data
    assert "not loaded" in data["detail"].lower()
