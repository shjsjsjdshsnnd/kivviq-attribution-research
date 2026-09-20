import type {
  MaterialityInput,
  MaterialityPolicy,
  MaterialityResult,
  MaterialityState,
} from './types.js'

export const DEFAULT_MATERIALITY_POLICY: MaterialityPolicy = {
  minSampleSize: 20,
  minCompleteness: 0.7,
  noiseBandRelative: 0.02,
  watchRelative: 0.05,
  materialRelative: 0.15,
  criticalRelative: 0.3,
}

function abs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.abs(value)
}

function atLeast(value: number | undefined, threshold: number | undefined): boolean {
  return value !== undefined && threshold !== undefined && value >= threshold
}

function maxState(left: MaterialityState, right: MaterialityState): MaterialityState {
  const rank: Readonly<Record<MaterialityState, number>> = {
    UNKNOWN: -1,
    IMMATERIAL: 0,
    WATCH: 1,
    MATERIAL: 2,
    CRITICAL: 3,
  }
  return rank[right] > rank[left] ? right : left
}

export function evaluateMateriality(
  input: MaterialityInput,
  policy: MaterialityPolicy = DEFAULT_MATERIALITY_POLICY,
): MaterialityResult {
  if (!Number.isFinite(input.currentValue) || !Number.isFinite(input.completeness)) {
    return { state: 'UNKNOWN', reasons: ['non-finite input'] }
  }
  if (input.completeness < policy.minCompleteness) {
    return { state: 'UNKNOWN', reasons: ['data completeness below policy minimum'] }
  }
  if (input.sampleSize !== undefined && input.sampleSize < policy.minSampleSize) {
    return { state: 'UNKNOWN', reasons: ['sample size below policy minimum'] }
  }

  const absoluteChange =
    input.comparisonValue === undefined ? undefined : input.currentValue - input.comparisonValue
  const relativeChange =
    input.comparisonValue === undefined || input.comparisonValue === 0
      ? undefined
      : absoluteChange === undefined
        ? undefined
        : absoluteChange / Math.abs(input.comparisonValue)

  const absoluteMagnitude = abs(absoluteChange)
  const relativeMagnitude = abs(relativeChange)
  const economicMagnitude = abs(input.economicImpact)
  const reasons: string[] = []
  let state: MaterialityState = 'IMMATERIAL'

  if (
    (policy.noiseBandAbsolute === undefined || absoluteMagnitude === undefined || absoluteMagnitude <= policy.noiseBandAbsolute) &&
    (policy.noiseBandRelative === undefined || relativeMagnitude === undefined || relativeMagnitude <= policy.noiseBandRelative)
  ) {
    reasons.push('change is inside configured noise bands')
  }

  if (
    atLeast(absoluteMagnitude, policy.watchAbsolute) ||
    atLeast(relativeMagnitude, policy.watchRelative) ||
    atLeast(economicMagnitude, policy.watchEconomicImpact)
  ) {
    state = maxState(state, 'WATCH')
    reasons.push('change exceeds watch threshold')
  }
  if (
    atLeast(absoluteMagnitude, policy.materialAbsolute) ||
    atLeast(relativeMagnitude, policy.materialRelative) ||
    atLeast(economicMagnitude, policy.materialEconomicImpact) ||
    input.merchantThresholdCrossed === true
  ) {
    state = maxState(state, 'MATERIAL')
    reasons.push(input.merchantThresholdCrossed ? 'merchant threshold crossed' : 'change exceeds material threshold')
  }
  if (
    atLeast(absoluteMagnitude, policy.criticalAbsolute) ||
    atLeast(relativeMagnitude, policy.criticalRelative) ||
    atLeast(economicMagnitude, policy.criticalEconomicImpact)
  ) {
    state = 'CRITICAL'
    reasons.push('change exceeds critical threshold')
  }

  return {
    state,
    absoluteChange,
    relativeChange,
    economicImpact: input.economicImpact,
    reasons: Object.freeze(reasons),
  }
}
