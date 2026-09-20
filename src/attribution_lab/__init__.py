"""Synthetic-only marketing attribution research laboratory."""

from attribution_lab.schemas.core import Dataset, Journey
from attribution_lab.simulation.generator import SyntheticWorld, generate_world
from attribution_lab.simulation.manifest import GroundTruthManifest

__all__ = ["Dataset", "GroundTruthManifest", "Journey", "SyntheticWorld", "generate_world"]
