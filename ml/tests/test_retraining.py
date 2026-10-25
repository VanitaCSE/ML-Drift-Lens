import json
from pathlib import Path

import joblib
import pytest

from ml.model.config import load_contract
from ml.model.pipeline import build_model_pipeline
from ml.retraining import prepare_retraining_data, retrain_candidate


CONTRACT_PATH = Path(__file__).parents[1] / "contracts" / "nsl_kdd_data_contract.json"
CONTRACT = load_contract(CONTRACT_PATH)
FEATURES = [feature["name"] for feature in CONTRACT["features"]]


def records(count: int = 150) -> list[dict]:
    result = []
    for index in range(count):
        features = {name: float(index + 1) for name in FEATURES}
        features.update({"protocol_type": "tcp" if index % 2 else "udp", "service": "http", "flag": "SF"})
        result.append(
            {
                "input_features": features,
                "actual_label": "attack" if index % 2 else "normal",
                "actual_label_source": "verified-test-source",
                "actual_label_verified_at": "2026-10-01T00:00:00Z",
                "prediction": "normal" if index % 2 else "attack",
            }
        )
    return result


def test_fewer_than_minimum_labeled_samples_returns_insufficient_data(tmp_path: Path) -> None:
    result = retrain_candidate(records(29), CONTRACT_PATH, tmp_path, "intrusion-detector-v1")

    assert result["status"] == "insufficient_data"
    assert result["sample_count"] == 29
    assert list(tmp_path.iterdir()) == []

def test_small_held_out_set_returns_required_sample_count(tmp_path: Path) -> None:
    result = retrain_candidate(
        records(30),
        CONTRACT_PATH,
        tmp_path,
        "intrusion-detector-v1",
        min_samples=30,
    )

    assert result["status"] == "insufficient_data"
    assert result["evaluation_sample_count"] == 6
    assert result["required_samples"] == 150
    assert list(tmp_path.iterdir()) == []


def test_actual_label_is_used_as_target_and_prediction_is_ignored() -> None:
    features, labels = prepare_retraining_data(records(30), CONTRACT)

    assert list(features.columns) == FEATURES
    assert labels.tolist() == [0, 1] * 15
    assert "prediction" not in features.columns


def test_missing_required_feature_is_rejected(tmp_path: Path) -> None:
    invalid = records(30)
    invalid[0]["input_features"].pop(FEATURES[0])

    with pytest.raises(ValueError, match="Missing required features"):
        retrain_candidate(invalid, CONTRACT_PATH, tmp_path, "intrusion-detector-v1")


def test_unverified_or_duplicate_labelled_records_are_rejected() -> None:
    invalid = records(2)
    invalid[0]["actual_label_verified_at"] = None

    with pytest.raises(ValueError, match="verified source and timestamp"):
        prepare_retraining_data(invalid, CONTRACT)

    duplicate = records(2)
    duplicate[0]["id"] = duplicate[1]["id"] = 9
    with pytest.raises(ValueError, match="Duplicate labelled prediction id"):
        prepare_retraining_data(duplicate, CONTRACT)


def test_candidate_artifact_and_metrics_are_created_without_touching_production(tmp_path: Path) -> None:
    production_artifact = tmp_path / "model.joblib"
    features, labels = prepare_retraining_data(records(), CONTRACT)
    incumbent = build_model_pipeline(CONTRACT)
    incumbent.fit(features, labels)
    joblib.dump(
        {
            "model": incumbent,
            "contract": CONTRACT,
            "metadata": {
                "model_id": "intrusion-detector-v1",
                "model_version": "0.1.0",
                "preprocessing_version": CONTRACT["preprocessing"]["version"],
            },
        },
        production_artifact,
    )

    result = retrain_candidate(
        records(),
        CONTRACT_PATH,
        tmp_path / "candidates",
        "intrusion-detector-v1",
        candidate_version="candidate-test-001",
        old_model_version="0.1.0",
    )

    assert result["status"] == "completed"
    assert result["promoted"] is False
    assert set(result["metrics"]) >= {"accuracy", "precision", "recall", "f1"}
    assert result["evaluation"]["dataset"] == "verified_labelled_prediction_records"
    assert result["evaluation"]["sample_count"] == 30
    assert set(result["evaluation"]["incumbent_metrics"]) >= {"accuracy", "precision", "recall", "f1"}
    assert Path(result["artifact_path"]).exists()
    assert joblib.load(production_artifact)["metadata"]["model_version"] == "0.1.0"

    artifact = joblib.load(result["artifact_path"])
    metadata = json.loads(Path(result["metadata_path"]).read_text(encoding="utf-8"))
    assert artifact["metadata"]["model_id"] == "intrusion-detector-v1"
    assert metadata["feature_schema_version"] == "1.0.0"
    assert metadata["sample_count"] == 150
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == 1
    assert manifest["model_id"] == "intrusion-detector-v1"
    assert manifest["model_version"] == "candidate-test-001"
    assert manifest["artifact_location"] == "candidates/candidate-test-001.joblib"
    assert manifest["evaluation"] == metadata["evaluation"]
    assert manifest["provenance"]["label_sources"] == ["verified-test-source"]
    assert manifest["storage"] == {
        "provider": "local_filesystem",
        "durability": "environment_dependent",
    }
