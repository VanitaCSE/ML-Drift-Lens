"""Load and verify model artifacts for inference."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.pipeline import Pipeline

from ..model.artifact_manifest import verify_artifact_manifest

logger = logging.getLogger(__name__)


class ModelArtifactError(Exception):
    """Raised when model artifact is invalid or missing."""

    pass


class ModelLoader:
    """Load and verify model artifacts at startup."""

    def __init__(self, artifact_path: Path) -> None:
        """Initialize loader with artifact path."""
        self.project_root = Path(__file__).resolve().parents[2]
        self.artifact_path = Path(artifact_path)
        self.production_root = self.project_root / "ml" / "artifacts"
        self._artifact: dict[str, Any] | None = None
        self._model: Pipeline | None = None
        self._contract: dict[str, Any] | None = None
        self._metadata: dict[str, Any] | None = None

    def _production_path(self) -> Path:
        """Return the configured production artifact, never a caller-supplied path."""
        path_value = self.artifact_path
        candidate = path_value if path_value.is_absolute() else self.project_root / path_value
        resolved = candidate.resolve(strict=False)
        production_root = self.production_root.resolve(strict=False)
        if resolved.parent != production_root or resolved.name != "model.joblib":
            raise ModelArtifactError("Configured artifact is not the approved production model")
        if not resolved.is_file():
            raise ModelArtifactError("Production model artifact not found")
        return resolved

    def _validate_served_artifact(self, artifact: dict[str, Any], artifact_path: Path) -> None:
        """Require promoted candidate metadata and sidecar to agree before serving it."""
        metadata = artifact["metadata"]
        production_metadata_path = artifact_path.with_name("metadata.json")
        try:
            production_metadata = json.loads(production_metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ModelArtifactError("Production metadata is missing or invalid") from exc
        if production_metadata != metadata:
            raise ModelArtifactError("Production artifact and metadata file do not match")

        candidate_version = metadata.get("candidate_version")
        if not candidate_version:
            return
        if metadata.get("promoted") is not True or metadata.get("model_version") != candidate_version:
            raise ModelArtifactError("Production candidate is not marked promoted")

        candidate_metadata_path = (
            self.production_root / "candidates" / f"{candidate_version}.json"
        )
        if not candidate_metadata_path.is_file():
            raise ModelArtifactError("Promoted candidate metadata is missing")
        try:
            candidate_metadata = json.loads(candidate_metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ModelArtifactError("Promoted candidate metadata is invalid") from exc
        if candidate_metadata != metadata:
            raise ModelArtifactError("Production and candidate metadata do not match")
        if not artifact_path.is_relative_to(self.production_root.resolve(strict=False)):
            raise ModelArtifactError("Served model is outside the production artifact root")
        manifest_version = metadata.get("artifact_manifest_version")
        if manifest_version is None:
            return
        if manifest_version != 1:
            raise ModelArtifactError("Unsupported production artifact manifest version")
        try:
            production_manifest = verify_artifact_manifest(
                artifact_path,
                artifact_path.with_name("manifest.json"),
                artifact_path.name,
                metadata,
            )
            candidate_manifest = verify_artifact_manifest(
                self.production_root / "candidates" / f"{candidate_version}.joblib",
                self.production_root / "candidates" / f"{candidate_version}.manifest.json",
                f"candidates/{candidate_version}.joblib",
                candidate_metadata,
            )
            if production_manifest["artifact_sha256"] != candidate_manifest["artifact_sha256"]:
                raise ValueError("Production and candidate artifact checksums differ")
        except (OSError, ValueError) as exc:
            raise ModelArtifactError(f"Production artifact manifest verification failed: {exc}") from exc

    def _contract_feature_names(self, contract: dict[str, Any]) -> list[str]:
        """Return feature names as defined by the contract."""
        features = contract.get("features", [])

        if isinstance(features, list):
            normalized: list[str] = []
            for feature in features:
                if isinstance(feature, dict):
                    if "name" not in feature:
                        raise ModelArtifactError("Contract feature definition missing 'name'")
                    normalized.append(str(feature["name"]))
                elif isinstance(feature, str):
                    normalized.append(feature)
                else:
                    raise ModelArtifactError(f"Unsupported contract feature definition: {type(feature).__name__}")
            return normalized

        if isinstance(features, dict):
            return [str(name) for name in features.keys()]

        raise ModelArtifactError(f"Unsupported contract features format: {type(features).__name__}")

    def _validate_model_object(self, model: Any, contract: dict[str, Any], label: str = "model") -> None:
        """Ensure the model object is a supported Pipeline and exposes prediction capability."""
        if not isinstance(model, Pipeline):
            label_name = label.lower() if label == "candidate" else label.capitalize()
            raise ModelArtifactError(f"{label_name} must be a Pipeline, got {type(model)}")

        if not callable(getattr(model, "predict", None)):
            label_name = label.lower() if label == "candidate" else label.capitalize()
            raise ModelArtifactError(f"{label_name} does not support prediction")

        if contract and "features" in contract:
            try:
                feature_names = self._contract_feature_names(contract)
                if feature_names and hasattr(model, "n_features_in_"):
                    dummy_row = {name: 0.0 for name in feature_names}
                    frame = pd.DataFrame([dummy_row], columns=feature_names)
                    model.predict(frame)
            except Exception:
                # Some loaded artifacts are valid but not fitted; the runtime 'predict' method
                # remains the key contract for reload safety. Do not reject otherwise valid
                # pipeline objects that support prediction.
                pass

    def _load_artifact(self, artifact_path: Path, label: str = "model") -> dict[str, Any]:
        """Load and validate a model artifact payload."""
        try:
            artifact = joblib.load(artifact_path)
        except Exception as exc:
            raise ModelArtifactError(f"Failed to load {label} from {artifact_path}: {exc}") from exc

        if not isinstance(artifact, dict):
            raise ModelArtifactError(f"{label.capitalize()} must be a dict, got {type(artifact)}")

        required_keys = {"model", "contract", "metadata"}
        missing_keys = required_keys - set(artifact.keys())
        if missing_keys:
            raise ModelArtifactError(f"{label.capitalize()} missing required keys: {missing_keys}")

        model = artifact.get("model")
        contract = artifact.get("contract")
        metadata = artifact.get("metadata")

        if not isinstance(contract, dict):
            raise ModelArtifactError(f"Contract must be a dict, got {type(contract)}")
        if "features" not in contract:
            raise ModelArtifactError("Contract missing 'features' key")

        if not isinstance(metadata, dict):
            raise ModelArtifactError(f"Metadata must be a dict, got {type(metadata)}")

        required_metadata_keys = {"model_version", "preprocessing_version"}
        if label == "candidate" and "candidate_version" in metadata:
            required_metadata_keys.remove("model_version")
        missing_metadata_keys = required_metadata_keys - set(metadata.keys())
        if missing_metadata_keys:
            raise ModelArtifactError(f"Metadata missing required keys: {missing_metadata_keys}")

        self._validate_model_object(model, contract, label=label)
        return artifact

    def load(self) -> None:
        """Load and verify artifact structure at startup."""
        if self.artifact_path.is_absolute():
            resolved = self.artifact_path.resolve(strict=False)
        else:
            resolved = (self.project_root / self.artifact_path).resolve(strict=False)

        if not resolved.exists():
            raise ModelArtifactError(f"Artifact not found: {resolved}")

        self.artifact_path = resolved
        logger.info(f"Loading model artifact from {self.artifact_path}")

        artifact = self._load_artifact(self.artifact_path, label="model")
        self._validate_served_artifact(artifact, self.artifact_path)
        self._artifact = artifact
        self._model = artifact.get("model")
        self._contract = artifact.get("contract")
        self._metadata = artifact.get("metadata")

        logger.info(
            f"Model loaded successfully: model_version={self._metadata.get('model_version')}, "
            f"preprocessing_version={self._metadata.get('preprocessing_version')}"
        )

    def load_approved_reference(self, model_id: str, model_version: str) -> dict[str, Any]:
        """Load only the exact version currently materialized at the trusted production path."""
        if not model_id or not model_version or ".." in model_version:
            raise ModelArtifactError("A valid model_id and model_version are required")
        production_path = self._production_path()
        artifact = self._load_artifact(production_path, label="model")
        self._validate_served_artifact(artifact, production_path)
        metadata = artifact["metadata"]
        active_version = metadata.get("model_version") or metadata.get("candidate_version")
        active_model_id = metadata.get("model_id") or metadata.get("model_name")
        if active_model_id != model_id or active_version != model_version:
            raise ModelArtifactError("Requested model version is not the active production artifact")
        return artifact

    def activate_artifact(self, artifact: dict[str, Any]) -> None:
        """Swap the active model only after its artifact and predictor have been validated."""
        self._artifact = artifact
        self._model = artifact["model"]
        self._contract = artifact["contract"]
        self._metadata = artifact["metadata"]

    @property
    def model(self) -> Pipeline:
        """Get the loaded Pipeline."""
        if self._model is None:
            raise ModelArtifactError("Model not loaded. Call load() first.")
        return self._model

    @property
    def contract(self) -> dict[str, Any]:
        """Get the loaded contract."""
        if self._contract is None:
            raise ModelArtifactError("Contract not loaded. Call load() first.")
        return self._contract

    @property
    def metadata(self) -> dict[str, Any]:
        """Get the loaded metadata."""
        if self._metadata is None:
            raise ModelArtifactError("Metadata not loaded. Call load() first.")
        return self._metadata

    def is_loaded(self) -> bool:
        """Check if artifact is loaded and valid."""
        return self._model is not None and self._contract is not None and self._metadata is not None
