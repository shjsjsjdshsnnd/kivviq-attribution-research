import type { GroundTruthManifest } from "../ground_truth/manifest.js";

const evaluatorAccessBrand: unique symbol = Symbol(
  "GroundTruthEvaluatorAccess",
);

export interface GroundTruthEvaluatorAccess {
  readonly [evaluatorAccessBrand]: true;
  readonly manifest: GroundTruthManifest;
}

export function createGroundTruthEvaluatorAccess(
  manifest: GroundTruthManifest,
): GroundTruthEvaluatorAccess {
  return Object.freeze({
    [evaluatorAccessBrand]: true as const,
    manifest,
  });
}
