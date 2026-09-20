import type { CalibrationMetric } from "./types.js";

export class PopulationCalibrationError extends Error {}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function logit(probability: number): number {
  const p = clamp(probability, 1e-12, 1 - 1e-12);
  return Math.log(p / (1 - p));
}

export function weightedMean(
  values: readonly number[],
  weights: readonly number[],
): number {
  if (values.length !== weights.length || values.length === 0) {
    throw new PopulationCalibrationError(
      "weighted mean requires equally sized non-empty values and weights",
    );
  }

  let weighted = 0;
  let totalWeight = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const weight = weights[index]!;
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
      throw new PopulationCalibrationError(
        "weighted mean received invalid value or non-positive weight",
      );
    }
    weighted += value * weight;
    totalWeight += weight;
  }
  return weighted / totalWeight;
}

export function calibrateProbabilityMean(
  values: readonly number[],
  weights: readonly number[],
  target: number,
  tolerance: number,
): readonly number[] {
  if (target < 0 || target > 1) {
    throw new PopulationCalibrationError(
      "probability calibration target must be within [0,1]",
    );
  }

  if (target <= tolerance) return values.map(() => 0);
  if (target >= 1 - tolerance) return values.map(() => 1);

  const logits = values.map((value) => logit(value));
  let low = -40;
  let high = 40;
  let result = values.map((value) => clamp(value, 0, 1));

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const shift = (low + high) / 2;
    result = logits.map((value) => sigmoid(value + shift));
    const implied = weightedMean(result, weights);
    if (Math.abs(implied - target) <= tolerance) return result;
    if (implied < target) low = shift;
    else high = shift;
  }

  const implied = weightedMean(result, weights);
  if (Math.abs(implied - target) > tolerance * 2) {
    throw new PopulationCalibrationError(
      `probability calibration failed: target=${target}, implied=${implied}`,
    );
  }
  return result;
}

export function calibratePositiveMean(
  values: readonly number[],
  weights: readonly number[],
  target: number,
): readonly number[] {
  if (target < 0 || !Number.isFinite(target)) {
    throw new PopulationCalibrationError(
      "positive calibration target must be finite and non-negative",
    );
  }
  const implied = weightedMean(values, weights);
  if (implied <= 0) {
    if (target === 0) return values.map(() => 0);
    throw new PopulationCalibrationError(
      "cannot scale a non-positive population mean to a positive target",
    );
  }
  const scale = target / implied;
  return values.map((value) => Math.max(0, value * scale));
}

export function calibrateBoundedMean(
  values: readonly number[],
  weights: readonly number[],
  target: number,
  min: number,
  max: number,
  tolerance: number,
): readonly number[] {
  if (target < min || target > max) {
    throw new PopulationCalibrationError(
      `bounded mean target ${target} lies outside [${min},${max}]`,
    );
  }

  let low = min - max * 3;
  let high = max - min * 3;
  let result = values.map((value) => clamp(value, min, max));

  for (let iteration = 0; iteration < 120; iteration += 1) {
    const shift = (low + high) / 2;
    result = values.map((value) => clamp(value + shift, min, max));
    const implied = weightedMean(result, weights);
    if (Math.abs(implied - target) <= tolerance) return result;
    if (implied < target) low = shift;
    else high = shift;
  }

  const implied = weightedMean(result, weights);
  if (Math.abs(implied - target) > tolerance * 2) {
    throw new PopulationCalibrationError(
      `bounded calibration failed: target=${target}, implied=${implied}`,
    );
  }
  return result;
}

export function calibratePurchaseWeightedAov(
  aovValues: readonly number[],
  expectedPurchases: readonly number[],
  weights: readonly number[],
  targetAov: number,
): readonly number[] {
  if (
    aovValues.length !== expectedPurchases.length ||
    aovValues.length !== weights.length
  ) {
    throw new PopulationCalibrationError(
      "purchase-weighted AOV arrays must have equal length",
    );
  }

  let weightedSpend = 0;
  let weightedPurchases = 0;
  for (let index = 0; index < aovValues.length; index += 1) {
    weightedSpend +=
      aovValues[index]! * expectedPurchases[index]! * weights[index]!;
    weightedPurchases += expectedPurchases[index]! * weights[index]!;
  }

  if (weightedPurchases <= 0 || weightedSpend <= 0) {
    throw new PopulationCalibrationError(
      "purchase-weighted AOV calibration requires positive purchase mass",
    );
  }

  const implied = weightedSpend / weightedPurchases;
  const scale = targetAov / implied;
  return aovValues.map((value) => Math.max(1, value * scale));
}

export function purchaseWeightedMean(
  values: readonly number[],
  expectedPurchases: readonly number[],
  weights: readonly number[],
): number {
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const purchaseWeight = expectedPurchases[index]! * weights[index]!;
    numerator += values[index]! * purchaseWeight;
    denominator += purchaseWeight;
  }
  if (denominator <= 0) {
    throw new PopulationCalibrationError(
      "purchase-weighted mean requires positive purchase mass",
    );
  }
  return numerator / denominator;
}

export function calibrationMetric(
  metric: CalibrationMetric["metric"],
  target: number,
  implied: number,
  tolerance: number,
): CalibrationMetric {
  const absoluteError = Math.abs(implied - target);
  return {
    metric,
    target,
    implied,
    absoluteError,
    tolerance,
    converged: absoluteError <= tolerance,
  };
}
