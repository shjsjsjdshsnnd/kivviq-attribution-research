/** Deterministic arithmetic only. No observations, causal truth or model calls. */
function finite(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError("Non-finite arithmetic input");
}
function sum(values: readonly number[]): number {
  // Compensated summation reduces cancellation error for offsetting effects.
  let result = 0, correction = 0;
  for (const value of values) {
    finite(value);
    const adjusted = value - correction;
    const next = result + adjusted;
    correction = (next - result) - adjusted;
    result = next;
  }
  finite(result);
  return result;
}
function product(values: readonly number[]): number {
  const result = values.reduce((a, b) => a * b, 1);
  finite(result);
  return result;
}
function permutations(ids: readonly number[]): number[][] {
  if (ids.length === 0) return [[]];
  return ids.flatMap(id => permutations(ids.filter(other => other !== id)).map(tail => [id, ...tail]));
}

/**
 * Exact permutation-average allocation of a product change, for 2 or 3 factors.
 * All interaction terms are shared once. This is an accounting identity, NOT a
 * causal attribution estimator. Returns fractional units; round only at output.
 */
export function allocateProductChange(reference: readonly number[], current: readonly number[]): number[] {
  if (reference.length !== current.length || reference.length < 2 || reference.length > 3) {
    throw new RangeError("Expected matching arrays of two or three factors");
  }
  [...reference, ...current].forEach(finite);
  const orders = permutations(reference.map((_, index) => index));
  const terms: number[][] = reference.map(() => []);
  for (const order of orders) {
    const point = [...reference];
    for (const index of order) {
      const before = product(point);
      point[index] = current[index]!;
      const after = product(point);
      terms[index]!.push((after - before) / orders.length);
    }
  }
  return terms.map(sum);
}

/** Integer-minor-unit allocation, preserving the rounded sum, including negatives. */
export function roundEffects(effects: readonly number[]): number[] {
  effects.forEach(finite);
  if (effects.some(value => Math.abs(value) > Number.MAX_SAFE_INTEGER / 8)) {
    throw new RangeError("Effect exceeds safe monetary arithmetic range");
  }
  const target = Math.round(sum(effects));
  const rounded = effects.map(value => Math.floor(value));
  const remaining = target - sum(rounded);
  const priority = effects.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  if (remaining < 0 || remaining > effects.length) throw new RangeError("Unsafe rounding residual");
  for (let i = 0; i < remaining; i++) rounded[priority[i]!.index]! += 1;
  return rounded.map(value => Object.is(value, -0) ? 0 : value);
}

export interface RateSegment {
  readonly id: string;
  readonly referenceNumerator: number;
  readonly referenceDenominator: number;
  readonly currentNumerator: number;
  readonly currentDenominator: number;
}
export interface MixDecomposition {
  readonly referenceRate: number;
  readonly currentRate: number;
  readonly delta: number;
  readonly withinSegmentEffect: number;
  readonly mixEffect: number;
  readonly residual: number;
  readonly simpsonReversal: boolean;
  readonly interpretation: "arithmetic_allocation_not_causation";
}
/**
 * Symmetric rate/mix accounting identity for a complete, disjoint partition.
 * The caller MUST establish completeness and disjointness from source evidence.
 * Zero-denominator and entering/exiting segments require a different estimator;
 * never invent a rate for an unobserved segment.
 */
export function decomposeRateMix(segments: readonly RateSegment[]): MixDecomposition {
  if (segments.length < 2) throw new RangeError("At least two segments are required");
  if (new Set(segments.map(row => row.id)).size !== segments.length || segments.some(row => !row.id)) {
    throw new RangeError("Segment IDs must be nonempty and unique");
  }
  for (const row of segments) {
    const counts = [row.referenceNumerator, row.referenceDenominator, row.currentNumerator, row.currentDenominator];
    if (counts.some(value => !Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 8)
      || row.referenceDenominator === 0 || row.currentDenominator === 0
      || row.referenceNumerator > row.referenceDenominator || row.currentNumerator > row.currentDenominator) {
      throw new RangeError("Expected observed binomial counts with positive denominators");
    }
  }
  const total0 = sum(segments.map(row => row.referenceDenominator));
  const total1 = sum(segments.map(row => row.currentDenominator));
  const referenceRate = sum(segments.map(row => row.referenceNumerator)) / total0;
  const currentRate = sum(segments.map(row => row.currentNumerator)) / total1;
  const within: number[] = [], mix: number[] = [], rateDeltas: number[] = [];
  for (const row of segments) {
    const r0 = row.referenceNumerator / row.referenceDenominator;
    const r1 = row.currentNumerator / row.currentDenominator;
    const w0 = row.referenceDenominator / total0;
    const w1 = row.currentDenominator / total1;
    within.push((w0 + w1) / 2 * (r1 - r0));
    mix.push((r0 + r1) / 2 * (w1 - w0));
    rateDeltas.push(r1 - r0);
  }
  const delta = currentRate - referenceRate;
  const withinSegmentEffect = sum(within), mixEffect = sum(mix);
  const epsilon = 1e-12;
  const simpsonReversal = (delta < -epsilon && rateDeltas.every(value => value > epsilon))
    || (delta > epsilon && rateDeltas.every(value => value < -epsilon));
  return { referenceRate, currentRate, delta, withinSegmentEffect, mixEffect,
    residual: delta - withinSegmentEffect - mixEffect, simpsonReversal,
    interpretation: "arithmetic_allocation_not_causation" };
}
