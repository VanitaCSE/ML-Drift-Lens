"""Tests for inference model loader."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import pytest
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ml.model.artifact_manifest import write_artifact_manifest
from ml.inference.model_loader import ModelArtifactError, ModelLoader


@pytest.fixture
def valid_artifact() -> dict[str, Any]:
    """Create a valid model artifact."""
    # Create a minimal pipeline
    pipeline = Pipeline([("scaler", StandardScaler()), ("clf", LogisticRegression(random_state=42))])

    # Create a contract
    contract = {"features": {"feat1": "numeric", "feat2": "numeric"}}

    # Create metadata
    metadata = {
        "model_version": "0.1.0",
        "preprocessing_version": "0.1.0",
        "model_type": "logistic_regression",
    }

    return {"model": pipeline, "contract": contract, "metadata": metadata}


@pytest.fixture
def artifact_file(valid_artifact: dict[str, Any], tmp_path: Path) -> Path:
    """Create a temporary production artifact and matching metadata sidecar."""
    artifact_path = tmp_path / "ml" / "artifacts" / "model.joblib"
    artifact_path.parent.mkdir(parents=True)
    joblib.dump(valid_artifact, artifact_path)
    artifact_path.with_name("metadata.json").write_text(
        json.dumps(valid_artifact["metadata"]), encoding="utf-8"
    )
    return artifact_path


def test_model_loader_load_valid_artifact(artifact_file: Path) -> None:
    """Test loading a valid artifact."""
    loader = ModelLoader(artifact_file)
    loader.load()

    assert loader.is_loaded()
    assert isinstance(loader.model, Pipeline)
    assert isinstance(loader.contract, dict)
    assert isinstance(loader.metadata, dict)
    assert loader.metadata["model_version"] == "0.1.0"


def test_model_loader_missing_file() -> None:
    """Test error when artifact file doesn't exist."""
    loader = ModelLoader(Path("/nonexistent/model.joblib"))

    with pytest.raises(ModelArtifactError, match="Artifact not found"):
        loader.load()


def test_model_loader_invalid_structure(artifact_file: Path) -> None:
    """Test error when artifact has invalid structure."""
    # Create invalid artifact (missing model key)
    invalid_artifact = {"contract": {}, "metadata": {}}
    joblib.dump(invalid_artifact, artifact_file)

    loader = ModelLoader(artifact_file)
    with pytest.raises(ModelArtifactError, match="missing required keys"):
        loader.load()


def test_model_loader_invalid_model_type(artifact_file: Path) -> None:
    """Test error when model is not a Pipeline."""
    invalid_artifact = {
        "model": "not_a_pipeline",
        "contract": {"features": {}},
        "metadata": {"model_version": "0.1.0", "preprocessing_version": "0.1.0"},
    }
    joblib.dump(invalid_artifact, artifact_file)

    loader = ModelLoader(artifact_file)
    with pytest.raises(ModelArtifactError, match="Model must be a Pipeline"):
        loader.load()


def test_model_loader_missing_contract_features(artifact_file: Path) -> None:
    """Test error when contract missing features key."""
    pipeline = Pipeline([("scaler", StandardScaler())])
    invalid_artifact = {
        "model": pipeline,
        "contract": {},  # Missing features key
        "metadata": {"model_version": "0.1.0", "preprocessing_version": "0.1.0"},
    }
    joblib.dump(invalid_artifact, artifact_file)

    loader = ModelLoader(artifact_file)
    with pytest.raises(ModelArtifactError, match="Contract missing 'features' key"):
        loader.load()


def test_model_loader_missing_versioning(artifact_file: Path) -> None:
    """Test error when metadata missing version keys."""
    pipeline = Pipeline([("scaler", StandardScaler())])
    invalid_artifact = {
        "model": pipeline,
        "contract": {"features": {}},
        "metadata": {"model_version": "0.1.0"},  # Missing preprocessing_version
    }
    joblib.dump(invalid_artifact, artifact_file)

    loader = ModelLoader(artifact_file)
    with pytest.raises(ModelArtifactError, match="Metadata missing required keys"):
        loader.load()


def test_model_loader_properties_before_load() -> None:
    """Test that properties raise error if accessed before load."""
    loader = ModelLoader(Path("/nonexistent/model.joblib"))

    with pytest.raises(ModelArtifactError, match="not loaded"):
        _ = loader.model

    with pytest.raises(ModelArtifactError, match="not loaded"):
        _ = loader.contract

    with pytest.raises(ModelArtifactError, match="not loaded"):
        _ = loader.metadata


def test_model_loader_is_loaded(artifact_file: Path) -> None:
    """Test is_loaded() status tracking."""
    loader = ModelLoader(artifact_file)

    assert not loader.is_loaded()
    loader.load()
    assert loader.is_loaded()


def _write_production_version(root: Path, artifact: dict[str, Any]) -> Path:
    production_path = root / "ml" / "artifacts" / "model.joblib"
    production_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, production_path)
    production_path.with_name("metadata.json").write_text(
        json.dumps(artifact["metadata"]), encoding="utf-8"
    )
    return production_path


def _promoted_candidate(valid_artifact: dict[str, Any], version: str, promoted: bool) -> dict[str, Any]:
    metadata = {
        "model_id": "reload-model",
        "candidate_version": version,
        "model_version": version,
        "artifact_manifest_version": 1,
        "preprocessing_version": "preprocessing-v2",
        "training_timestamp": "2026-10-01T00:00:00Z",
        "sample_count": 150,
        "evaluation": {
            "source": "verified-test-source",
            "source_version": "v1",
            "label_sources": ["trusted-fixture"],
            "sample_count": 30,
            "incumbent_metrics": {"f1": 0.5},
        },
        "promoted": promoted,
    }
    return {**valid_artifact, "metadata": metadata}


def _loader_for_root(root: Path, production_path: Path) -> ModelLoader:
    loader = ModelLoader(production_path)
    loader.project_root = root
    loader.production_root = root / "ml" / "artifacts"
    loader.load()
    return loader


def test_model_loader_activates_only_exact_promoted_production_reference(valid_artifact: dict[str, Any], tmp_path: Path) -> None:
    production_path = _write_production_version(tmp_path, valid_artifact)
    loader = _loader_for_root(tmp_path, production_path)
    promoted = _promoted_candidate(valid_artifact, "candidate-test-002", True)
    production_path.parent.joinpath("candidates").mkdir()
    candidate_sidecar = production_path.parent / "candidates" / "candidate-test-002.json"
    candidate_sidecar.write_text(json.dumps(promoted["metadata"]), encoding="utf-8")
    candidate_path = production_path.parent / "candidates" / "candidate-test-002.joblib"
    joblib.dump(promoted, candidate_path)
    joblib.dump(promoted, production_path)
    production_path.with_name("metadata.json").write_text(json.dumps(promoted["metadata"]), encoding="utf-8")
    write_artifact_manifest(
        candidate_path,
        production_path.parent / "candidates" / "candidate-test-002.manifest.json",
        "candidates/candidate-test-002.joblib",
        promoted["metadata"],
    )
    write_artifact_manifest(
        production_path,
        production_path.with_name("manifest.json"),
        "model.joblib",
        promoted["metadata"],
    )

    artifact = loader.load_approved_reference("reload-model", "candidate-test-002")
    loader.activate_artifact(artifact)

    assert loader.metadata["model_version"] == "candidate-test-002"
    assert loader.metadata["promoted"] is True


def test_model_loader_rejects_candidate_when_manifest_checksum_does_not_match(
    valid_artifact: dict[str, Any], tmp_path: Path
) -> None:
    production_path = _write_production_version(tmp_path, valid_artifact)
    _loader_for_root(tmp_path, production_path)
    promoted = _promoted_candidate(valid_artifact, "candidate-checksum", True)
    candidate_dir = production_path.parent / "candidates"
    candidate_dir.mkdir()
    candidate_path = candidate_dir / "candidate-checksum.joblib"
    joblib.dump(promoted, candidate_path)
    (candidate_dir / "candidate-checksum.json").write_text(
        json.dumps(promoted["metadata"]), encoding="utf-8"
    )
    joblib.dump(promoted, production_path)
    production_path.with_name("metadata.json").write_text(
        json.dumps(promoted["metadata"]), encoding="utf-8"
    )
    write_artifact_manifest(
        candidate_path,
        candidate_dir / "candidate-checksum.manifest.json",
        "candidates/candidate-checksum.joblib",
        promoted["metadata"],
    )
    write_artifact_manifest(
        production_path,
        production_path.with_name("manifest.json"),
        "model.joblib",
        promoted["metadata"],
    )
    candidate_path.write_bytes(candidate_path.read_bytes() + b"tampered")

    loader = ModelLoader(production_path)
    loader.project_root = tmp_path
    loader.production_root = tmp_path / "ml" / "artifacts"
    with pytest.raises(ModelArtifactError, match="manifest verification failed"):
        loader.load()


def test_failed_artifact_load_keeps_model_and_metadata(valid_artifact: dict[str, Any], tmp_path: Path) -> None:
    production_path = _write_production_version(tmp_path, valid_artifact)
    loader = _loader_for_root(tmp_path, production_path)
    current_model = loader.model
    current_metadata = loader.metadata
    production_path.write_bytes(b"not a joblib artifact")

    with pytest.raises(ModelArtifactError):
        loader.load_approved_reference("reload-model", "0.1.0")

    assert loader.model is current_model
    assert loader.metadata is current_metadata
    assert loader.metadata["model_version"] == "0.1.0"


def test_unpromoted_candidate_and_traversal_references_are_rejected(valid_artifact: dict[str, Any], tmp_path: Path) -> None:
    production_path = _write_production_version(tmp_path, valid_artifact)
    loader = _loader_for_root(tmp_path, production_path)
    candidate_dir = production_path.parent / "candidates"
    candidate_dir.mkdir()
    unpromoted = _promoted_candidate(valid_artifact, "candidate-pending", False)
    joblib.dump(unpromoted, candidate_dir / "candidate-pending.joblib")
    (candidate_dir / "candidate-pending.json").write_text(json.dumps(unpromoted["metadata"]), encoding="utf-8")

    with pytest.raises(ModelArtifactError):
        loader.load_approved_reference("reload-model", "candidate-pending")
    with pytest.raises(ModelArtifactError):
        loader.load_approved_reference("reload-model", "../../outside.joblib")


def test_restart_loads_the_same_promoted_production_version(valid_artifact: dict[str, Any], tmp_path: Path) -> None:
    production_path = _write_production_version(tmp_path, valid_artifact)
    candidate_dir = production_path.parent / "candidates"
    candidate_dir.mkdir()
    promoted = _promoted_candidate(valid_artifact, "candidate-persistent", True)
    joblib.dump(promoted, production_path)
    candidate_path = candidate_dir / "candidate-persistent.joblib"
    joblib.dump(promoted, candidate_path)
    (production_path.parent / "metadata.json").write_text(json.dumps(promoted["metadata"]), encoding="utf-8")
    (candidate_dir / "candidate-persistent.json").write_text(json.dumps(promoted["metadata"]), encoding="utf-8")
    write_artifact_manifest(
        candidate_path,
        candidate_dir / "candidate-persistent.manifest.json",
        "candidates/candidate-persistent.joblib",
        promoted["metadata"],
    )
    write_artifact_manifest(
        production_path,
        production_path.with_name("manifest.json"),
        "model.joblib",
        promoted["metadata"],
    )

    restarted = _loader_for_root(tmp_path, production_path)

    assert restarted.metadata["model_version"] == "candidate-persistent"
    assert restarted.metadata["promoted"] is True
