"""Provider-neutral interface for durable model artifact storage."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class ArtifactStore(Protocol):
    """Storage operations required to publish and retrieve a verified artifact."""

    def publish(self, artifact_path: Path, artifact_id: str) -> str:
        """Publish an artifact and return an immutable provider URI."""
        ...

    def retrieve(self, artifact_uri: str, destination: Path) -> None:
        """Retrieve the exact artifact identified by its immutable provider URI."""
        ...
