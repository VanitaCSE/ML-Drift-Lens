"""Candidate retraining from verified production labels.

This module deliberately writes only versioned candidate artifacts. It never
changes the deployed model artifact or performs model promotion.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
from math import ceil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib
import pandas as pd
from sklearn.model_selection import train_test_split

from .model.config import load_contract
from .model.data import normalize_label
from .model.artifact_manifest import write_artifact_manifest
from .model.pipeline import build_model_pipeline
from .model.train import evaluate

logger = logging.getLogger(__name__)


def _feature_names(contract: dict[str, Any]) -> list[str]:
    return [feature["name"] for feature in contract["features"]]


def prepare_retraining_data(
    records: list[dict[str, Any]],
    contract: dict[str, Any],
) -> tuple[pd.DataFrame, pd.Series]:
    """Convert labeled prediction records into contract-ordered X and y."""
    feature_names = _feature_names(contract)
    rows: list[dict[str, Any]] = []
    labels: list[int] = []
    record_ids: set[object] = set()
    request_ids: set[object] = set()

    for record in records:
        if record.get("actual_label") is None:
            continue

        if not record.get("actual_label_source") or not record.get("actual_label_verified_at"):
            raise ValueError("Training labels must include a verified source and timestamp")
        record_id = record.get("id")
        request_id = record.get("request_id")
        if record_id is not None:
            if record_id in record_ids:
                raise ValueError(f"Duplicate labelled prediction id: {record_id}")
            record_ids.add(record_id)
        if request_id is not None:
            if request_id in request_ids:
                raise ValueError(f"Duplicate labelled request id: {request_id}")
            request_ids.add(request_id)

        input_features = record.get("input_features")
        if not isinstance(input_features, dict):
            raise ValueError("input_features must be an object")

        missing = [name for name in feature_names if name not in input_features]
        extra = sorted(set(input_features) - set(feature_names))
        if missing:
            raise ValueError(f"Missing required features: {missing}")
        if extra:
            raise ValueError(f"Unexpected features: {extra}")

        normalized_label = str(record["actual_label"]).strip().lower().removesuffix(".")
        if normalized_label not in {"normal", "attack"}:
            raise ValueError(f"Unsupported verified binary label: {record['actual_label']!r}")
        rows.append({name: input_features[name] for name in feature_names})
        labels.append(normalize_label(normalized_label))

    features = pd.DataFrame(rows, columns=feature_names)
    if features.isna().any().any():
        raise ValueError("Missing values are not allowed in verified training features")
    for feature in contract["features"]:
        name = feature["name"]
        if feature["kind"] == "numerical":
            try:
                features[name] = pd.to_numeric(features[name], errors="raise")
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Numerical feature '{name}' contains non-numeric values") from exc
            if not all(math.isfinite(float(value)) for value in features[name]):
                raise ValueError(f"Numerical feature '{name}' contains non-finite values")
        elif not all(isinstance(value, str) and value.strip() for value in features[name]):
            raise ValueError(f"Categorical feature '{name}' contains invalid values")
    return features, pd.Series(labels, dtype="int8")


def retrain_candidate(
    records: list[dict[str, Any]],
    contract_path: Path,
    candidate_dir: Path,
    model_id: str,
    min_samples: int = 150,
    old_model_version: str | None = None,
    candidate_version: str | None = None,
    min_evaluation_samples: int | None = None,
) -> dict[str, Any]:
    """Train and persist a candidate model from labeled prediction records."""
    if min_samples < 1:
        raise ValueError("min_samples must be positive")
    if not model_id or not model_id.strip():
        raise ValueError("model_id is required")

    contract = load_contract(contract_path)
    features, labels = prepare_retraining_data(records, contract)
    sample_count = len(labels)

    if sample_count < min_samples:
        return {
            "status": "insufficient_data",
            "model_id": model_id,
            "sample_count": sample_count,
            "min_samples": min_samples,
            "candidate_version": None,
            "artifact_path": None,
        }

    if labels.nunique() < 2:
        raise ValueError("At least two label classes are required for retraining")

    validation_fraction = contract["split"]["validation_fraction"]
    random_seed = contract["split"]["random_seed"]
    evaluation_minimum = min_evaluation_samples or int(
        os.environ.get("RETRAINING_MIN_EVALUATION_SAMPLES", "30")
    )
    if evaluation_minimum < 1:
        raise ValueError("min_evaluation_samples must be positive")
    train_features, validation_features, train_labels, validation_labels = train_test_split(
        features,
        labels,
        test_size=validation_fraction,
        random_state=random_seed,
        stratify=labels,
    )
    evaluation_sample_count = len(validation_labels)
    if evaluation_sample_count < evaluation_minimum:
        return {
            "status": "insufficient_data",
            "model_id": model_id,
            "sample_count": sample_count,
            "evaluation_sample_count": evaluation_sample_count,
            "min_samples": min_samples,
            "min_evaluation_samples": evaluation_minimum,
            "required_samples": ceil(evaluation_minimum / validation_fraction),
            "candidate_version": None,
            "artifact_path": None,
        }

    model = build_model_pipeline(contract)
    model.fit(train_features, train_labels)
    metrics = evaluate(model, validation_features, validation_labels)
    if not all(
        math.isfinite(float(metrics[key])) and 0 <= float(metrics[key]) <= 1
        for key in ("accuracy", "precision", "recall", "f1")
    ):
        raise ValueError("Candidate evaluation produced invalid metrics")

    incumbent_path = candidate_dir.parent / "model.joblib"
    if not incumbent_path.is_file():
        raise ValueError("Current production model artifact is unavailable for comparison")
    incumbent_artifact = joblib.load(incumbent_path)
    if not isinstance(incumbent_artifact, dict) or not {
        "model", "contract", "metadata"
    }.issubset(incumbent_artifact):
        raise ValueError("Current production model artifact has an invalid format")
    incumbent_metadata = incumbent_artifact["metadata"]
    incumbent_contract = incumbent_artifact["contract"]
    incumbent_version = (
        incumbent_metadata.get("model_version")
        or incumbent_metadata.get("candidate_version")
    )
    if old_model_version and incumbent_version != old_model_version:
        raise ValueError("Current production artifact changed before candidate evaluation")
    if (
        incumbent_metadata.get("model_id") != model_id
        or incumbent_contract.get("contract_version") != contract.get("contract_version")
        or incumbent_metadata.get("preprocessing_version")
        != contract["preprocessing"]["version"]
        or _feature_names(incumbent_contract) != _feature_names(contract)
    ):
        raise ValueError("Current production model is incompatible with the data contract")

    incumbent_metrics = evaluate(
        incumbent_artifact["model"], validation_features, validation_labels
    )
    if not all(
        math.isfinite(float(incumbent_metrics[key]))
        and 0 <= float(incumbent_metrics[key]) <= 1
        for key in ("accuracy", "precision", "recall", "f1")
    ):
        raise ValueError("Incumbent evaluation produced invalid metrics")

    run_id = candidate_version or (
        f"candidate-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    )
    candidate_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = candidate_dir / f"{run_id}.joblib"
    metadata_path = candidate_dir / f"{run_id}.json"
    metadata = {
        "model_id": model_id,
        "candidate_version": run_id,
        "artifact_manifest_version": 1,
        "model_type": "xgboost",
        "feature_schema_version": contract["contract_version"],
        "preprocessing_version": contract["preprocessing"]["version"],
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "sample_count": sample_count,
        "min_samples": min_samples,
        "old_model_version": old_model_version,
        "metrics": metrics,
        "evaluation": {
            "dataset": "verified_labelled_prediction_records",
            "sample_count": evaluation_sample_count,
            "source": "verified_prediction_records",
            "source_version": "verified_prediction_records-v1",
            "label_sources": sorted({
                str(record["actual_label_source"]).strip()
                for record in records
                if record.get("actual_label") is not None
            }),
            "feature_schema_version": contract["contract_version"],
            "preprocessing_version": contract["preprocessing"]["version"],
            "config": {
                "validation_fraction": validation_fraction,
                "random_seed": random_seed,
                "minimum_evaluation_samples": evaluation_minimum,
            },
            "incumbent_model_id": model_id,
            "incumbent_model_version": incumbent_version,
            "incumbent_metrics": incumbent_metrics,
        },
        "promoted": False,
    }

    joblib.dump({"model": model, "contract": contract, "metadata": metadata}, artifact_path)
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    mlflow_run_id = None
    try:
        from .mlflow_integration import MLflowIntegration

        mlflow_run_id = MLflowIntegration().track_candidate(artifact_path, metadata_path)["run_id"]
    except Exception as err:
        logger.warning("MLflow candidate tracking unavailable; keeping candidate local: %s", err)

    if mlflow_run_id:
        metadata["mlflow_run_id"] = mlflow_run_id
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        joblib.dump({"model": model, "contract": contract, "metadata": metadata}, artifact_path)

    manifest_path = artifact_path.with_suffix(".manifest.json")
    write_artifact_manifest(
        artifact_path,
        manifest_path,
        f"candidates/{artifact_path.name}",
        metadata,
    )

    return {
        "status": "completed",
        "model_id": model_id,
        "sample_count": sample_count,
        "min_samples": min_samples,
        "candidate_version": run_id,
        "artifact_path": str(artifact_path),
        "metadata_path": str(metadata_path),
        "manifest_path": str(manifest_path),
        "metrics": metrics,
        "evaluation": metadata["evaluation"],
        "mlflow_run_id": mlflow_run_id,
        "promoted": False,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--min-samples", type=int, default=150)
    parser.add_argument("--old-model-version")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    records = json.load(__import__("sys").stdin)
    result = retrain_candidate(
        records=records,
        contract_path=args.contract,
        candidate_dir=args.candidate_dir,
        model_id=args.model_id,
        min_samples=args.min_samples,
        old_model_version=args.old_model_version,
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()