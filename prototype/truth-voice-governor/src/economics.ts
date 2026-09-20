import type { MerchantEconomics } from './types.js'
import { assertMerchantEconomics } from './validation.js'

export type ThresholdComparison = 'ABOVE' | 'AT' | 'BELOW' | 'UNKNOWN'

export function buildMerchantEconomics(input: MerchantEconomics): MerchantEconomics {
  assertMerchantEconomics(input)
  return Object.freeze({
    ...input,
    cashConstraint: input.cashConstraint ? Object.freeze({ ...input.cashConstraint }) : undefined,
    inventoryConstraint: input.inventoryConstraint ? Object.freeze({ ...input.inventoryConstraint }) : undefined,
    growthTarget: input.growthTarget ? Object.freeze({ ...input.growthTarget }) : undefined,
  })
}

export function compareRoasToBreakEven(
  roas: number,
  economics: MerchantEconomics,
  tolerance = 1e-9,
): ThresholdComparison {
  if (economics.breakEvenRoas === undefined) return 'UNKNOWN'
  const delta = roas - economics.breakEvenRoas
  if (Math.abs(delta) <= tolerance) return 'AT'
  return delta > 0 ? 'ABOVE' : 'BELOW'
}

export function merchantThresholdValue(
  economics: MerchantEconomics,
  key: keyof MerchantEconomics,
): number | undefined {
  const value = economics[key]
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'number') {
    return value.value
  }
  return undefined
}
