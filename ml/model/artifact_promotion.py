"""Atomically stage, roll back, and finalize approved model artifacts."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib

from .artifact_manifest import verify_artifact_manifest, write_artifact_manifest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKUP_TOKEN_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _atomic_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        temporary.write(data)
    os.replace(temporary_path, path)


def _atomic_joblib(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        joblib.dump(payload, temporary_path)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _restore_file(source: Path | None, destination: Path) -> None:
    if source is None:
        destination.unlink(missing_ok=True)
        return
    _atomic_bytes(destination, source.read_bytes())


def _backup_files(
    backup_dir: Path,
    files: dict[str, Path],
) -> None:
    backup_dir.mkdir(parents=True, exist_ok=False)
    manifest: dict[str, bool] = {}
    for name, path in files.items():
        present = path.is_file()
        manifest[name] = present
        if present:
            shutil.copy2(path, backup_dir / name)
    (backup_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def rollback_promotion(backup_token: str, artifacts_root: Path | None = None) -> None:
    """Restore the exact candidate and production files from a staged promotion."""
    if not BACKUP_TOKEN_PATTERN.fullmatch(backup_token):
        raise ValueError("Invalid promotion backup reference")

    root = (artifacts_root or PROJECT_ROOT / "ml" / "artifacts").resolve()
    backup_dir = (root / ".promotion-backups" / backup_token).resolve()
    if not backup_dir.is_relative_to((root / ".promotion-backups").resolve()):
        raise ValueError("Promotion backup is outside the approved directory")
    manifest_path = backup_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError("Promotion backup does not exist")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    candidate_version = manifest.get("candidate_version")
    if (
        not isinstance(candidate_version, str)
        or Path(candidate_version).name != candidate_version
        or ".." in candidate_version
    ):
        raise ValueError("Promotion backup has an invalid candidate version")
    targets = {
        "production.joblib": root / "model.joblib",
        "production.json": root / "metadata.json",
        "production.manifest.json": root / "manifest.json",
        "candidate.joblib": root / "candidates" / f"{candidate_version}.joblib",
        "candidate.json": root / "candidates" / f"{candidate_version}.json",
        "candidate.manifest.json": root / "candidates" / f"{candidate_version}.manifest.json",
    }
    for name, destination in targets.items():
        source = backup_dir / name if manifest.get(name) else None
        _restore_file(source, destination)
    shutil.rmtree(backup_dir)


def finalize_promotion(backup_token: str, artifacts_root: Path | None = None) -> None:
    """Discard rollback files after the database transaction commits."""
    if not BACKUP_TOKEN_PATTERN.fullmatch(backup_token):
        raise ValueError("Invalid promotion backup reference")
    root = (artifacts_root or PROJECT_ROOT / "ml" / "artifacts").resolve()
    backup_dir = (root / ".promotion-backups" / backup_token).resolve()
    if not backup_dir.is_relative_to((root / ".promotion-backups").resolve()):
        raise ValueError("Promotion backup is outside the approved directory")
    shutil.rmtree(backup_dir, ignore_errors=True)


def promote_candidate_artifacts(
    model_id: str,
    candidate_version: str,
    artifacts_root: Path | None = None,
) -> dict[str, str]:
    """Mark an approved candidate and atomically materialize it as production."""
    if not model_id or not candidate_version or candidate_version in {".", ".."}:
        raise ValueError("Model identity and candidate version are required")
    if Path(candidate_version).name != candidate_version or ".." in candidate_version:
        raise ValueError("Invalid candidate model version")

    root = (artifacts_root or PROJECT_ROOT / "ml" / "artifacts").resolve()
    candidate_dir = (root / "candidates").resolve()
    candidate_path = (candidate_dir / f"{candidate_version}.joblib").resolve()
    candidate_metadata_path = candidate_path.with_suffix(".json")
    if not candidate_path.is_relative_to(candidate_dir):
        raise ValueError("Candidate artifact is outside the approved directory")
    if not candidate_path.is_file() or not candidate_metadata_path.is_file():
        raise FileNotFoundError("Candidate artifact or metadata is missing")

    candidate_metadata = json.loads(candidate_metadata_path.read_text(encoding="utf-8"))
    candidate_manifest_path = candidate_path.with_suffix(".manifest.json")
    try:
        verify_artifact_manifest(
            candidate_path,
            candidate_manifest_path,
            f"candidates/{candidate_path.name}",
            candidate_metadata,
        )
    except ValueError as exc:
        raise ValueError(f"Candidate artifact manifest is invalid: {exc}") from exc
    payload = joblib.load(candidate_path)
    if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
        raise ValueError("Candidate artifact payload is invalid")
    if payload["metadata"] != candidate_metadata:
        raise ValueError("Candidate artifact and sidecar metadata differ")
    if candidate_metadata.get("model_id") != model_id:
        raise ValueError("Candidate model identity does not match the retraining job")
    if candidate_metadata.get("candidate_version") != candidate_version:
        raise ValueError("Candidate version does not match the retraining job")

    production_path = root / "model.joblib"
    production_metadata_path = root / "metadata.json"
    if not production_path.is_file() or not production_metadata_path.is_file():
        raise FileNotFoundError("Current production artifact or metadata is missing")

    promoted_metadata = dict(candidate_metadata)
    promoted_metadata["model_version"] = candidate_version
    promoted_metadata["promoted"] = True
    if "metrics" in promoted_metadata:
        promoted_metadata["validation_metrics"] = promoted_metadata["metrics"]

    promoted_payload = dict(payload)
    promoted_payload["metadata"] = promoted_metadata
    token = uuid4().hex
    backup_root = root / ".promotion-backups"
    backup_dir = backup_root / token
    files = {
        "production.joblib": production_path,
        "production.json": production_metadata_path,
        "production.manifest.json": root / "manifest.json",
        "candidate.joblib": candidate_dir / "candidate.joblib",
        "candidate.json": candidate_dir / "candidate.json",
        "candidate.manifest.json": candidate_dir / "candidate.manifest.json",
    }
    files["candidate.joblib"] = candidate_path
    files["candidate.json"] = candidate_metadata_path
    files["candidate.manifest.json"] = candidate_manifest_path
    _backup_files(backup_dir, files)
    manifest_path = backup_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["candidate_version"] = candidate_version
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    try:
        _atomic_joblib(candidate_path, promoted_payload)
        _atomic_bytes(
            candidate_metadata_path,
            (json.dumps(promoted_metadata, indent=2) + "\n").encode("utf-8"),
        )
        _atomic_bytes(production_path, candidate_path.read_bytes())
        _atomic_bytes(
            production_metadata_path,
            (json.dumps(promoted_metadata, indent=2) + "\n").encode("utf-8"),
        )
        write_artifact_manifest(
            candidate_path,
            candidate_manifest_path,
            f"candidates/{candidate_path.name}",
            promoted_metadata,
        )
        write_artifact_manifest(
            production_path,
            root / "manifest.json",
            production_path.name,
            promoted_metadata,
        )
    except Exception:
        rollback_promotion(token, root)
        raise

    return {"backup_token": token, "model_id": model_id, "model_version": candidate_version}


def main() -> None:
    request = json.load(sys.stdin)
    action = request.get("action")
    backup_token = request.get("backup_token", "")
    if action == "promote":
        result = promote_candidate_artifacts(request.get("model_id", ""), request.get("model_version", ""))
    elif action == "rollback":
        rollback_promotion(backup_token)
        result = {"status": "rolled_back"}
    elif action == "finalize":
        finalize_promotion(backup_token)
        result = {"status": "finalized"}
    else:
        raise ValueError("Unsupported promotion action")
    print(json.dumps(result))


if __name__ == "__main__":
    main()