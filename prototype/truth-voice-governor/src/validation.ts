import type { ClaimInput, MerchantEconomics, Measure } from './types.js'

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function probability(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertMeasure(name: string, measure: Measure | undefined): void {
  if (!measure) return
  if (!finiteNumber(measure.value)) throw new Error(name + '.value must be finite')
  if (!nonEmptyString(measure.unit)) throw new Error(name + '.unit is required')
  if (measure.currency !== undefined && !nonEmptyString(measure.currency)) {
    throw new Error(name + '.currency must be non-empty when supplied')
  }
}

export function assertClaimInput(claim: ClaimInput): void {
  if (!nonEmptyString(claim.id)) throw new Error('claim.id is required')
  if (!nonEmptyString(claim.metric.id) || !nonEmptyString(claim.metric.name)) {
    throw new Error('claim.metric identity is required')
  }
  if (!nonEmptyString(claim.period.start) || !nonEmptyString(claim.period.end)) {
    throw new Error('claim.period start/end are required')
  }
  if (!probability(claim.measurementConfidence)) throw new Error('measurementConfidence must be 0..1')
  if (!probability(claim.causalConfidence)) throw new Error('causalConfidence must be 0..1')
  if (!probability(claim.completeness)) throw new Error('completeness must be 0..1')
  if (!nonEmptyString(claim.statement)) throw new Error('claim.statement is required')
  assertMeasure('claim.currentValue', claim.currentValue)
  assertMeasure('claim.comparisonValue', claim.comparisonValue)

  if (claim.type === 'UNKNOWN') {
    if (claim.currentValue !== undefined) throw new Error('UNKNOWN claim cannot carry a current value')
    return
  }
  if (claim.evidenceIds.length === 0 || claim.sourceIds.length === 0) {
    throw new Error(claim.type + ' claim requires evidence and sources')
  }
  if ((claim.type === 'FACT' || claim.type === 'DERIVED_FACT') && claim.currentValue === undefined) {
    throw new Error(claim.type + ' requires a current value')
  }
  if (claim.type === 'DERIVED_FACT' && claim.provenance.transformations.length === 0) {
    throw new Error('DERIVED_FACT requires at least one transformation')
  }
}

export function assertMerchantEconomics(input: MerchantEconomics): void {
  for (const [name, value] of [
    ['contributionMargin', input.contributionMargin],
    ['grossMargin', input.grossMargin],
  ] as const) {
    if (value !== undefined && !probability(value)) throw new Error(name + ' must be 0..1')
  }
  if (input.breakEvenRoas !== undefined && (!finiteNumber(input.breakEvenRoas) || input.breakEvenRoas <= 0)) {
    throw new Error('breakEvenRoas must be > 0')
  }
  assertMeasure('cacTarget', input.cacTarget)
  assertMeasure('ltv', input.ltv)
  if (input.paybackRequirementDays !== undefined && (!finiteNumber(input.paybackRequirementDays) || input.paybackRequirementDays < 0)) {
    throw new Error('paybackRequirementDays must be >= 0')
  }
  assertMeasure('cashConstraint.maxMonthlySpend', input.cashConstraint?.maxMonthlySpend)
  assertMeasure('cashConstraint.minCashReserve', input.cashConstraint?.minCashReserve)
  if (input.inventoryConstraint?.availableUnits !== undefined && input.inventoryConstraint.availableUnits < 0) {
    throw new Error('availableUnits must be >= 0')
  }
  if (input.inventoryConstraint?.maxSellThroughRate !== undefined && !probability(input.inventoryConstraint.maxSellThroughRate)) {
    throw new Error('maxSellThroughRate must be 0..1')
  }
  if (input.growthTarget?.relativeChange !== undefined && !finiteNumber(input.growthTarget.relativeChange)) {
    throw new Error('growthTarget.relativeChange must be finite')
  }
  assertMeasure('growthTarget.absoluteValue', input.growthTarget?.absoluteValue)
}
