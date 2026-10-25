"""Versioned integrity manifest for model artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


MANIFEST_VERSION = 1


def artifact_sha256(artifact_path: Path) -> str:
    digest = hashlib.sha256()
    with artifact_path.open("rb") as artifact_file:
        for chunk in iter(lambda: artifact_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_artifact_manifest(
    artifact_path: Path,
    artifact_location: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Build a manifest whose identity and provenance come from candidate metadata."""
    evaluation = metadata.get("evaluation")
    if not isinstance(evaluation, dict):
        raise ValueError("Candidate evaluation metadata is required for the artifact manifest")

    model_id = metadata.get("model_id")
    model_version = metadata.get("candidate_version") or metadata.get("model_version")
    if metadata.get("artifact_manifest_version") != MANIFEST_VERSION:
        raise ValueError("Candidate metadata does not declare the supported artifact manifest version")
    if not isinstance(model_id, str) or not model_id.strip():
        raise ValueError("Artifact manifest requires a model identity")
    if not isinstance(model_version, str) or not model_version.strip():
        raise ValueError("Artifact manifest requires a model version")

    provenance = {
        "training_data_source": evaluation.get("source"),
        "training_data_source_version": evaluation.get("source_version"),
        "label_sources": evaluation.get("label_sources"),
        "training_sample_count": metadata.get("sample_count"),
        "training_timestamp": metadata.get("training_timestamp"),
    }
    if (
        not isinstance(provenance["training_data_source"], str)
        or not provenance["training_data_source"].strip()
        or not isinstance(provenance["training_data_source_version"], str)
        or not isinstance(provenance["label_sources"], list)
        or not provenance["label_sources"]
        or not all(isinstance(source, str) and source.strip() for source in provenance["label_sources"])
        or not isinstance(provenance["training_sample_count"], int)
        or provenance["training_sample_count"] < 1
        or not isinstance(provenance["training_timestamp"], str)
        or not provenance["training_timestamp"].strip()
    ):
        raise ValueError("Artifact manifest requires complete training provenance")

    return {
        "manifest_version": MANIFEST_VERSION,
        "model_id": model_id,
        "model_version": model_version,
        "artifact_location": artifact_location,
        "artifact_sha256": artifact_sha256(artifact_path),
        "evaluation": evaluation,
        "provenance": provenance,
        "storage": {
            "provider": "local_filesystem",
            "durability": "environment_dependent",
        },
    }


def write_artifact_manifest(
    artifact_path: Path,
    manifest_path: Path,
    artifact_location: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    manifest = build_artifact_manifest(artifact_path, artifact_location, metadata)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=manifest_path.parent,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
        json.dump(manifest, temporary, indent=2)
        temporary.write("\n")
    os.replace(temporary_path, manifest_path)
    return manifest


def verify_artifact_manifest(
    artifact_path: Path,
    manifest_path: Path,
    artifact_location: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Artifact manifest is missing or invalid") from exc

    expected = build_artifact_manifest(artifact_path, artifact_location, metadata)
    if manifest != expected:
        raise ValueError("Artifact manifest does not match artifact bytes or metadata")
    return manifest
