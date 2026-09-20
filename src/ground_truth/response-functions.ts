import type { ResponseCurve } from "./ontology.js";

export class FrozenResponseCurveError extends Error {}

function assertSpend(spendMinor: number): void {
  if (!Number.isFinite(spendMinor) || spendMinor < 0) {
    throw new FrozenResponseCurveError(
      "spend must be finite and non-negative",
    );
  }
}

function piecewiseOutcome(
  curve: Extract<ResponseCurve, { kind: "piecewise" }>,
  spendMinor: number,
): number {
  if (curve.points.length < 2) {
    throw new FrozenResponseCurveError(
      "piecewise response curve requires at least two points",
    );
  }

  if (spendMinor <= Number(curve.points[0]!.spend)) {
    const left = curve.points[0]!;
    const right = curve.points[1]!;
    const dx = Number(right.spend) - Number(left.spend);
    if (dx <= 0) return left.outcome;
    return (
      left.outcome +
      ((right.outcome - left.outcome) / dx) *
        (spendMinor - Number(left.spend))
    );
  }

  for (let index = 1; index < curve.points.length; index += 1) {
    const left = curve.points[index - 1]!;
    const right = curve.points[index]!;
    const leftSpend = Number(left.spend);
    const rightSpend = Number(right.spend);
    if (spendMinor <= rightSpend) {
      const dx = Math.max(1, rightSpend - leftSpend);
      const fraction = (spendMinor - leftSpend) / dx;
      return left.outcome +
        fraction * (right.outcome - left.outcome);
    }
  }

  const left = curve.points[curve.points.length - 2]!;
  const right = curve.points[curve.points.length - 1]!;
  const dx = Number(right.spend) - Number(left.spend);
  if (dx <= 0) return right.outcome;
  const slope = (right.outcome - left.outcome) / dx;
  return right.outcome +
    slope * (spendMinor - Number(right.spend));
}

export function evaluateFrozenResponseCurve(
  curve: ResponseCurve,
  spendMinor: number,
): number {
  assertSpend(spendMinor);

  if (curve.kind === "linear") {
    const effectiveSpend =
      curve.maxSpend === undefined
        ? spendMinor
        : Math.min(spendMinor, Number(curve.maxSpend));
    return curve.slopePerMoneyMinor * effectiveSpend;
  }

  if (curve.kind === "hill") {
    if (spendMinor === 0) return 0;
    const h = Number(curve.hillCoefficient);
    const half = Number(curve.halfSaturationSpend);
    const numerator = Math.pow(spendMinor, h);
    const denominator =
      Math.pow(half, h) + numerator;
    return Number(curve.maxIncrementalOutcome) *
      (denominator === 0 ? 0 : numerator / denominator);
  }

  if (curve.kind === "threshold") {
    const threshold = Number(curve.thresholdSpend);
    const belowSpend = Math.min(spendMinor, threshold);
    const aboveSpend = Math.max(0, spendMinor - threshold);
    let outcome =
      belowSpend * curve.belowThresholdSlope +
      aboveSpend * curve.aboveThresholdSlope;

    if (curve.maximumOutcome !== undefined) {
      outcome = Math.min(
        outcome,
        Number(curve.maximumOutcome),
      );
    }
    return outcome;
  }

  return piecewiseOutcome(curve, spendMinor);
}

export function marginalFrozenResponsePerSpendMinor(
  curve: ResponseCurve,
  spendMinor: number,
  blockMinor: number,
): number | null {
  assertSpend(spendMinor);
  if (!Number.isFinite(blockMinor) || blockMinor <= 0) {
    throw new FrozenResponseCurveError(
      "marginal block must be finite and positive",
    );
  }

  const low = Math.max(0, spendMinor - blockMinor / 2);
  const high = spendMinor + blockMinor / 2;
  const deltaSpend = high - low;
  if (deltaSpend <= 0) return null;

  return (
    evaluateFrozenResponseCurve(curve, high) -
    evaluateFrozenResponseCurve(curve, low)
  ) / deltaSpend;
}
