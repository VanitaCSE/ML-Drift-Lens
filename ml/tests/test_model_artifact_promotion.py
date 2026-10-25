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
from ml.model.artifact_promotion import promote_candidate_artifacts, rollback_promotion


def _pipeline() -> Pipeline:
    model = Pipeline([("scale", StandardScaler()), ("classifier", LogisticRegression())])
    model.fit([[0.0], [1.0]], [0, 1])
    return model


def _payload(metadata: dict[str, Any]) -> dict[str, Any]:
    return {"model": _pipeline(), "contract": {"features": {"feature": "numeric"}}, "metadata": metadata}


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def test_promote_candidate_materializes_matching_production_and_candidate_metadata(tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    candidates = artifacts / "candidates"
    candidates.mkdir(parents=True)
    version = "candidate-test-001"
    metadata = {
        "model_id": "test-model",
        "candidate_version": version,
        "artifact_manifest_version": 1,
        "preprocessing_version": "preprocessing-v1",
        "training_timestamp": "2026-10-01T00:00:00Z",
        "sample_count": 150,
        "metrics": {"f1": 0.8},
        "evaluation": {
            "source": "verified-test-source",
            "source_version": "v1",
            "label_sources": ["trusted-fixture"],
            "sample_count": 30,
            "incumbent_metrics": {"f1": 0.5},
        },
        "promoted": False,
    }
    candidate_path = candidates / f"{version}.joblib"
    joblib.dump(_payload(metadata), candidate_path)
    _write_json(candidate_path.with_suffix(".json"), metadata)
    write_artifact_manifest(
        candidate_path,
        candidate_path.with_suffix(".manifest.json"),
        f"candidates/{candidate_path.name}",
        metadata,
    )

    incumbent_metadata = {
        "model_id": "test-model",
        "model_version": "0.1.0",
        "preprocessing_version": "preprocessing-v1",
    }
    joblib.dump(_payload(incumbent_metadata), artifacts / "model.joblib")
    _write_json(artifacts / "metadata.json", incumbent_metadata)

    result = promote_candidate_artifacts("test-model", version, artifacts)
    promoted_payload = joblib.load(artifacts / "model.joblib")
    promoted_sidecar = json.loads(candidate_path.with_suffix(".json").read_text(encoding="utf-8"))
    production_metadata = json.loads((artifacts / "metadata.json").read_text(encoding="utf-8"))

    assert result["model_version"] == version
    assert promoted_payload["metadata"]["model_version"] == version
    assert promoted_payload["metadata"]["promoted"] is True
    assert promoted_payload["metadata"] == promoted_sidecar == production_metadata
    rollback_promotion(result["backup_token"], artifacts)


def test_rollback_restores_candidate_and_incumbent_files_byte_for_byte(tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    candidates = artifacts / "candidates"
    candidates.mkdir(parents=True)
    version = "candidate-test-rollback"
    metadata = {
        "model_id": "test-model",
        "candidate_version": version,
        "artifact_manifest_version": 1,
        "preprocessing_version": "preprocessing-v1",
        "training_timestamp": "2026-10-01T00:00:00Z",
        "sample_count": 150,
        "metrics": {"f1": 0.8},
        "evaluation": {
            "source": "verified-test-source",
            "source_version": "v1",
            "label_sources": ["trusted-fixture"],
            "sample_count": 30,
            "incumbent_metrics": {"f1": 0.5},
        },
        "promoted": False,
    }
    candidate_path = candidates / f"{version}.joblib"
    joblib.dump(_payload(metadata), candidate_path)
    _write_json(candidate_path.with_suffix(".json"), metadata)
    write_artifact_manifest(
        candidate_path,
        candidate_path.with_suffix(".manifest.json"),
        f"candidates/{candidate_path.name}",
        metadata,
    )
    incumbent = {"model_id": "test-model", "model_version": "0.1.0", "preprocessing_version": "preprocessing-v1"}
    joblib.dump(_payload(incumbent), artifacts / "model.joblib")
    _write_json(artifacts / "metadata.json", incumbent)
    paths = [
        candidate_path,
        candidate_path.with_suffix(".json"),
        candidate_path.with_suffix(".manifest.json"),
        artifacts / "model.joblib",
        artifacts / "metadata.json",
        artifacts / "manifest.json",
    ]
    original_state = [
        (path.exists(), path.read_bytes() if path.is_file() else None)
        for path in paths
    ]

    result = promote_candidate_artifacts("test-model", version, artifacts)
    rollback_promotion(result["backup_token"], artifacts)

    assert [
        (path.exists(), path.read_bytes() if path.is_file() else None)
        for path in paths
    ] == original_state


@pytest.mark.parametrize("version", ["../model.joblib", "..", "nested/candidate-1"])
def test_candidate_version_cannot_escape_candidate_root(tmp_path: Path, version: str) -> None:
    with pytest.raises(ValueError, match="version"):
        promote_candidate_artifacts("test-model", version, tmp_path / "artifacts")