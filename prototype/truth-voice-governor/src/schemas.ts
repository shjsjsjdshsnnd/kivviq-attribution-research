import { buildClaimLedger } from './claim-ledger.js'
import { buildMerchantEconomics } from './economics.js'
import type {
  ClaimInput,
  ClaimLedger,
  ClaimType,
  ContradictionStatus,
  DecisionState,
  Dimensions,
  DraftAnswer,
  LanguageStrength,
  MaterialityState,
  Measure,
  MerchantEconomics,
  Period,
  Provenance,
} from './types.js'
import { assertClaimInput } from './validation.js'

type JsonRecord = Record<string, unknown>

const CLAIM_TYPES: readonly ClaimType[] = ['FACT', 'DERIVED_FACT', 'INFERENCE', 'CAUSAL_INFERENCE', 'UNKNOWN']
const MATERIALITY: readonly MaterialityState[] = ['IMMATERIAL', 'WATCH', 'MATERIAL', 'CRITICAL', 'UNKNOWN']
const CONTRADICTION: readonly ContradictionStatus[] = ['NONE', 'RESOLVED', 'UNRESOLVED']
const LANGUAGE: readonly LanguageStrength[] = ['UNKNOWN_ONLY', 'QUALIFIED', 'SUGGESTIVE', 'ASSERTIVE', 'CAUSAL']
const DECISIONS: readonly DecisionState[] = ['SCALE', 'KEEP', 'REDUCE', 'STOP', 'INVESTIGATE', 'INSUFFICIENT_EVIDENCE']
const ECONOMIC_KEYS: readonly (keyof MerchantEconomics)[] = [
  'contributionMargin',
  'grossMargin',
  'breakEvenRoas',
  'cacTarget',
  'ltv',
  'paybackRequirementDays',
  'cashConstraint',
  'inventoryConstraint',
  'growthTarget',
]

function record(value: unknown, name: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(name + ' must be an object')
  return value as JsonRecord
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(name + ' must be a non-empty string')
  return value
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(name + ' must be a finite number')
  return value
}

function optionalFinite(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : finite(value, name)
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(name + ' must be boolean')
  return value
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(name + ' must be a string array')
  return [...value]
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(name + ' has an unsupported value')
  return value as T
}

function measure(value: unknown, name: string): Measure | undefined {
  if (value === undefined) return undefined
  const input = record(value, name)
  return {
    value: finite(input.value, name + '.value'),
    unit: stringValue(input.unit, name + '.unit'),
    currency: input.currency === undefined ? undefined : stringValue(input.currency, name + '.currency'),
  }
}

function dimensions(value: unknown): Dimensions {
  const input = record(value, 'dimensions')
  const output: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(input)) {
    if (typeof item === 'string' || typeof item === 'boolean') output[key] = item
    else if (typeof item === 'number' && Number.isFinite(item)) output[key] = item
    else throw new Error('dimensions.' + key + ' must be string, finite number, or boolean')
  }
  return output
}

function period(value: unknown): Period {
  const input = record(value, 'period')
  const comparisonInput = input.comparison === undefined ? undefined : record(input.comparison, 'period.comparison')
  return {
    start: stringValue(input.start, 'period.start'),
    end: stringValue(input.end, 'period.end'),
    comparison: comparisonInput
      ? {
          start: stringValue(comparisonInput.start, 'period.comparison.start'),
          end: stringValue(comparisonInput.end, 'period.comparison.end'),
        }
      : undefined,
  }
}

function provenance(value: unknown): Provenance {
  const input = record(value, 'provenance')
  return {
    sourceSystem: stringValue(input.sourceSystem, 'provenance.sourceSystem'),
    evidenceType: enumValue(input.evidenceType, ['DIRECT', 'DERIVED', 'MODELLED'] as const, 'provenance.evidenceType'),
    method: stringValue(input.method, 'provenance.method'),
    transformations: stringArray(input.transformations, 'provenance.transformations'),
    observedAt: input.observedAt === undefined ? undefined : stringValue(input.observedAt, 'provenance.observedAt'),
  }
}

export function parseClaimInput(value: unknown): ClaimInput {
  const input = record(value, 'claim')
  const metric = record(input.metric, 'claim.metric')
  const parsed: ClaimInput = {
    id: stringValue(input.id, 'claim.id'),
    type: enumValue(input.type, CLAIM_TYPES, 'claim.type'),
    metric: {
      id: stringValue(metric.id, 'claim.metric.id'),
      name: stringValue(metric.name, 'claim.metric.name'),
    },
    dimensions: dimensions(input.dimensions),
    period: period(input.period),
    currentValue: measure(input.currentValue, 'claim.currentValue'),
    comparisonValue: measure(input.comparisonValue, 'claim.comparisonValue'),
    evidenceIds: stringArray(input.evidenceIds, 'claim.evidenceIds'),
    sourceIds: stringArray(input.sourceIds, 'claim.sourceIds'),
    provenance: provenance(input.provenance),
    measurementConfidence: finite(input.measurementConfidence, 'claim.measurementConfidence'),
    causalConfidence: finite(input.causalConfidence, 'claim.causalConfidence'),
    completeness: finite(input.completeness, 'claim.completeness'),
    materiality: enumValue(input.materiality, MATERIALITY, 'claim.materiality'),
    contradictionStatus: enumValue(input.contradictionStatus, CONTRADICTION, 'claim.contradictionStatus'),
    statement: stringValue(input.statement, 'claim.statement'),
  }
  assertClaimInput(parsed)
  return parsed
}

export function parseClaimLedger(value: unknown): ClaimLedger {
  const input = record(value, 'claimLedger')
  if (!Array.isArray(input.claims)) throw new Error('claimLedger.claims must be an array')
  return buildClaimLedger(input.claims.map(parseClaimInput))
}

export function parseMerchantEconomics(value: unknown): MerchantEconomics {
  const input = record(value, 'merchantEconomics')
  const cash = input.cashConstraint === undefined ? undefined : record(input.cashConstraint, 'cashConstraint')
  const inventory = input.inventoryConstraint === undefined ? undefined : record(input.inventoryConstraint, 'inventoryConstraint')
  const growth = input.growthTarget === undefined ? undefined : record(input.growthTarget, 'growthTarget')
  return buildMerchantEconomics({
    contributionMargin: optionalFinite(input.contributionMargin, 'contributionMargin'),
    grossMargin: optionalFinite(input.grossMargin, 'grossMargin'),
    breakEvenRoas: optionalFinite(input.breakEvenRoas, 'breakEvenRoas'),
    cacTarget: measure(input.cacTarget, 'cacTarget'),
    ltv: measure(input.ltv, 'ltv'),
    paybackRequirementDays: optionalFinite(input.paybackRequirementDays, 'paybackRequirementDays'),
    cashConstraint: cash
      ? {
          maxMonthlySpend: measure(cash.maxMonthlySpend, 'cashConstraint.maxMonthlySpend'),
          minCashReserve: measure(cash.minCashReserve, 'cashConstraint.minCashReserve'),
        }
      : undefined,
    inventoryConstraint: inventory
      ? {
          constrained: booleanValue(inventory.constrained, 'inventoryConstraint.constrained'),
          availableUnits: optionalFinite(inventory.availableUnits, 'inventoryConstraint.availableUnits'),
          maxSellThroughRate: optionalFinite(inventory.maxSellThroughRate, 'inventoryConstraint.maxSellThroughRate'),
        }
      : undefined,
    growthTarget: growth
      ? {
          metricId: stringValue(growth.metricId, 'growthTarget.metricId'),
          relativeChange: optionalFinite(growth.relativeChange, 'growthTarget.relativeChange'),
          absoluteValue: measure(growth.absoluteValue, 'growthTarget.absoluteValue'),
        }
      : undefined,
  })
}

export function parseDraftAnswer(value: unknown): DraftAnswer {
  const input = record(value, 'draft')
  const recommendationInput = input.recommendation === undefined ? undefined : record(input.recommendation, 'draft.recommendation')
  if (!Array.isArray(input.usedClaimIds)) throw new Error('draft.usedClaimIds must be an array')
  if (!Array.isArray(input.claimLanguage)) throw new Error('draft.claimLanguage must be an array')
  if (!Array.isArray(input.numericMentions)) throw new Error('draft.numericMentions must be an array')
  if (!Array.isArray(input.sourceAttributions)) throw new Error('draft.sourceAttributions must be an array')
  if (!Array.isArray(input.acknowledgedContradictionIds)) throw new Error('draft.acknowledgedContradictionIds must be an array')
  if (!Array.isArray(input.acknowledgedUnknownClaimIds)) throw new Error('draft.acknowledgedUnknownClaimIds must be an array')
  if (!Array.isArray(input.acknowledgedDisclosureIds)) throw new Error('draft.acknowledgedDisclosureIds must be an array')
  if (!Array.isArray(input.merchantThresholdMentions)) throw new Error('draft.merchantThresholdMentions must be an array')

  return {
    text: stringValue(input.text, 'draft.text'),
    usedClaimIds: stringArray(input.usedClaimIds, 'draft.usedClaimIds'),
    claimLanguage: input.claimLanguage.map((entry, index) => {
      const item = record(entry, 'draft.claimLanguage[' + index + ']')
      return {
        claimId: stringValue(item.claimId, 'draft.claimLanguage.claimId'),
        strength: enumValue(item.strength, LANGUAGE, 'draft.claimLanguage.strength'),
      }
    }),
    numericMentions: input.numericMentions.map((entry, index) => {
      const item = record(entry, 'draft.numericMentions[' + index + ']')
      return {
        value: finite(item.value, 'draft.numericMentions.value'),
        claimId: item.claimId === undefined ? undefined : stringValue(item.claimId, 'draft.numericMentions.claimId'),
      }
    }),
    sourceAttributions: input.sourceAttributions.map((entry, index) => {
      const item = record(entry, 'draft.sourceAttributions[' + index + ']')
      return {
        claimId: stringValue(item.claimId, 'draft.sourceAttributions.claimId'),
        sourceId: stringValue(item.sourceId, 'draft.sourceAttributions.sourceId'),
      }
    }),
    acknowledgedContradictionIds: stringArray(input.acknowledgedContradictionIds, 'draft.acknowledgedContradictionIds'),
    acknowledgedUnknownClaimIds: stringArray(input.acknowledgedUnknownClaimIds, 'draft.acknowledgedUnknownClaimIds'),
    acknowledgedDisclosureIds: stringArray(input.acknowledgedDisclosureIds, 'draft.acknowledgedDisclosureIds'),
    recommendation: recommendationInput
      ? {
          state: enumValue(recommendationInput.state, DECISIONS, 'draft.recommendation.state'),
          target: stringValue(recommendationInput.target, 'draft.recommendation.target'),
        }
      : undefined,
    merchantThresholdMentions: input.merchantThresholdMentions.map((entry, index) => {
      const item = record(entry, 'draft.merchantThresholdMentions[' + index + ']')
      return {
        key: enumValue(item.key, ECONOMIC_KEYS, 'draft.merchantThresholdMentions.key'),
        value: finite(item.value, 'draft.merchantThresholdMentions.value'),
      }
    }),
    premiseCorrected: input.premiseCorrected === undefined ? undefined : booleanValue(input.premiseCorrected, 'draft.premiseCorrected'),
  }
}
