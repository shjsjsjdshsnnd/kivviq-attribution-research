/** Runtime response revision, separate from the unchanged v1 scenario schema. */
export const WEBSITE_RUNTIME_REVISION = "website-runtime/1.0.1" as const;

/** Same weak-imagery boundary used by the v1 PDP friction diagnostic. */
export const WEAK_PDP_IMAGERY_THRESHOLD = 0.52;

/**
 * Synthetic confidence bottleneck, not an empirically calibrated conversion lift.
 * A severe imagery deficit cannot be completely compensated by healthy unrelated
 * PDP attributes. The quadratic shortfall is monotone, bounded, continuous and
 * has zero slope at the existing weak-imagery boundary. Acceptable imagery and
 * zero category imagery importance leave the legacy response exactly unchanged.
 */
export function pdpImageryConfidenceFactor(imagery: number, importance: number): number {
  if (![imagery, importance].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError("Imagery quality and importance must be finite values in [0, 1]");
  }
  const shortfall = Math.max(0, WEAK_PDP_IMAGERY_THRESHOLD - imagery);
  return 1 - importance * shortfall * shortfall;
}
