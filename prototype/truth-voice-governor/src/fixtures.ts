import { buildClaimLedger } from './claim-ledger.js'
import { buildContradiction, type ContradictionInput } from './contradictions.js'
import { governDecision } from './decision.js'
import { buildMerchantEconomics } from './economics.js'
import { buildAnswerSpec } from './governor.js'
import { evaluateMateriality } from './materiality.js'
import type {
  AnswerSpec,
  ClaimInput,
  DecisionCandidate,
  DecisionState,
  DraftAnswer,
  MaterialityInput,
  MaterialityState,
  MerchantEconomics,
  UserPremise,
} from './types.js'

const PERIOD = { start: '2026-08-01', end: '2026-08-30' }

function claim(
  id: string,
  type: ClaimInput['type'],
  metricId: string,
  statement: string,
  currentValue: number | undefined,
  options: {
    comparisonValue?: number
    source?: string
    evidence?: string
    measurementConfidence?: number
    causalConfidence?: number
    completeness?: number
    materiality?: MaterialityState
    unit?: string
  } = {},
): ClaimInput {
  return {
    id,
    type,
    metric: { id: metricId, name: metricId.replaceAll('_', ' ') },
    dimensions: {},
    period: PERIOD,
    currentValue: currentValue === undefined ? undefined : { value: currentValue, unit: options.unit ?? 'unit' },
    comparisonValue: options.comparisonValue === undefined ? undefined : { value: options.comparisonValue, unit: options.unit ?? 'unit' },
    evidenceIds: type === 'UNKNOWN' ? [] : [options.evidence ?? 'evidence-' + id],
    sourceIds: type === 'UNKNOWN' ? [] : [options.source ?? 'source-' + id],
    provenance: {
      sourceSystem: options.source ?? (type === 'UNKNOWN' ? 'none' : 'source-' + id),
      evidenceType: type === 'DERIVED_FACT' ? 'DERIVED' : type === 'INFERENCE' || type === 'CAUSAL_INFERENCE' ? 'MODELLED' : 'DIRECT',
      method: type === 'UNKNOWN' ? 'unavailable' : 'synthetic deterministic fixture',
      transformations: type === 'DERIVED_FACT' ? ['deterministic arithmetic'] : [],
    },
    measurementConfidence: options.measurementConfidence ?? (type === 'UNKNOWN' ? 0 : 0.95),
    causalConfidence: options.causalConfidence ?? 0,
    completeness: options.completeness ?? (type === 'UNKNOWN' ? 0 : 0.95),
    materiality: options.materiality ?? 'WATCH',
    contradictionStatus: 'NONE',
    statement,
  }
}

export interface AdversarialFixture {
  id: string
  evidence: readonly string[]
  claims: readonly ClaimInput[]
  contradictionInputs?: readonly ContradictionInput[]
  economics?: MerchantEconomics
  materialityInput: MaterialityInput
  expectedMateriality: MaterialityState
  candidate?: DecisionCandidate
  expectedDecision: DecisionState
  forbiddenClaims: readonly string[]
  premise?: UserPremise
  conclusionClaimIds: readonly string[]
}

export const ADVERSARIAL_FIXTURES: readonly AdversarialFixture[] = Object.freeze([
  {
    id: 'meta-roas-vs-shopify-disagreement',
    evidence: ['Meta attributes revenue of 21000.', 'Shopify-linked revenue for the same governed scope is 12000.'],
    claims: [
      claim('meta-revenue', 'FACT', 'attributed_revenue', 'Meta-attributed revenue was 21000.', 21000, { source: 'meta', unit: 'CAD' }),
      claim('shopify-revenue', 'FACT', 'attributed_revenue', 'Shopify-linked revenue in the same scope was 12000.', 12000, { source: 'shopify', unit: 'CAD' }),
    ],
    contradictionInputs: [{ id: 'revenue-source-disagreement', claimIds: ['meta-revenue', 'shopify-revenue'] }],
    materialityInput: { currentValue: 21000, comparisonValue: 12000, completeness: 0.95, sampleSize: 100 },
    expectedMateriality: 'CRITICAL',
    candidate: {
      state: 'SCALE',
      target: 'Meta',
      reason: 'Scale only if the governed revenue evidence supports it.',
      supportingClaimIds: ['meta-revenue'],
      risk: 'HIGH',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['Reconcile Meta and Shopify revenue.'],
    },
    expectedDecision: 'INVESTIGATE',
    forbiddenClaims: ['Meta definitely generated 21000 of incremental revenue.', 'Scale Meta because platform ROAS is excellent.'],
    conclusionClaimIds: ['meta-revenue', 'shopify-revenue'],
  },
  {
    id: 'revenue-up-orders-flat',
    evidence: ['Revenue increased from 100000 to 124000.', 'Orders were unchanged at 300.'],
    claims: [
      claim('revenue', 'FACT', 'revenue', 'Revenue was 124000.', 124000, { comparisonValue: 100000, source: 'shopify', unit: 'CAD', materiality: 'MATERIAL' }),
      claim('orders', 'FACT', 'orders', 'Orders were 300.', 300, { comparisonValue: 300, source: 'shopify', materiality: 'IMMATERIAL' }),
    ],
    materialityInput: { currentValue: 124000, comparisonValue: 100000, completeness: 1, sampleSize: 300 },
    expectedMateriality: 'MATERIAL',
    candidate: {
      state: 'KEEP',
      target: 'current growth plan',
      reason: 'Revenue improved while order volume did not.',
      supportingClaimIds: ['revenue', 'orders'],
      risk: 'MEDIUM',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['Order volume materially declines.'],
    },
    expectedDecision: 'KEEP',
    forbiddenClaims: ['Customer demand increased.', 'More customers purchased.'],
    conclusionClaimIds: ['revenue', 'orders'],
  },
  {
    id: 'spend-faster-than-revenue',
    evidence: ['Spend increased from 10000 to 13000.', 'Revenue increased from 50000 to 54000.'],
    claims: [
      claim('spend', 'FACT', 'spend', 'Spend was 13000.', 13000, { comparisonValue: 10000, source: 'ads', unit: 'CAD', materiality: 'CRITICAL' }),
      claim('revenue-growth', 'DERIVED_FACT', 'revenue_growth', 'Revenue growth was 0.08.', 0.08, { source: 'shopify', unit: 'ratio', materiality: 'WATCH' }),
    ],
    materialityInput: { currentValue: 13000, comparisonValue: 10000, completeness: 0.95, sampleSize: 100 },
    expectedMateriality: 'CRITICAL',
    candidate: {
      state: 'REDUCE',
      target: 'paid spend',
      reason: 'Spend growth materially outpaced observed revenue growth.',
      supportingClaimIds: ['spend', 'revenue-growth'],
      risk: 'MEDIUM',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['Efficiency recovers above the merchant target.'],
    },
    expectedDecision: 'REDUCE',
    forbiddenClaims: ['The spend increase caused weak revenue growth.'],
    conclusionClaimIds: ['spend', 'revenue-growth'],
  },
  {
    id: 'tiny-sample-huge-change',
    evidence: ['Three observations produced a 200 percent change.'],
    claims: [
      claim('tiny-change', 'DERIVED_FACT', 'conversion_change', 'Observed change was 2.0.', 2, { source: 'analytics', unit: 'ratio', completeness: 0.9, materiality: 'UNKNOWN' }),
    ],
    materialityInput: { currentValue: 3, comparisonValue: 1, completeness: 0.9, sampleSize: 3 },
    expectedMateriality: 'UNKNOWN',
    candidate: {
      state: 'SCALE',
      target: 'campaign',
      reason: 'Large observed percentage change.',
      supportingClaimIds: ['tiny-change'],
      risk: 'HIGH',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['More observations accrue.'],
    },
    expectedDecision: 'SCALE',
    forbiddenClaims: ['Performance materially improved with confidence.'],
    conclusionClaimIds: ['tiny-change'],
  },
  {
    id: 'missing-data',
    evidence: ['Revenue evidence is unavailable for the requested scope.'],
    claims: [
      claim('revenue-unknown', 'UNKNOWN', 'revenue', 'Revenue cannot be determined from available evidence.', undefined),
    ],
    materialityInput: { currentValue: 0, completeness: 0.2 },
    expectedMateriality: 'UNKNOWN',
    expectedDecision: 'INSUFFICIENT_EVIDENCE',
    forbiddenClaims: ['Revenue was zero.', 'Revenue declined.'],
    conclusionClaimIds: ['revenue-unknown'],
  },
  {
    id: 'zero-vs-unavailable',
    evidence: ['Spend is observed as zero.', 'Revenue is unavailable.'],
    claims: [
      claim('spend-zero', 'FACT', 'spend', 'Spend was 0.', 0, { source: 'ads', unit: 'CAD' }),
      claim('revenue-unavailable', 'UNKNOWN', 'revenue', 'Revenue is unavailable.', undefined),
    ],
    materialityInput: { currentValue: 0, completeness: 0.4 },
    expectedMateriality: 'UNKNOWN',
    expectedDecision: 'INSUFFICIENT_EVIDENCE',
    forbiddenClaims: ['Revenue was zero.'],
    conclusionClaimIds: ['spend-zero', 'revenue-unavailable'],
  },
  {
    id: 'attribution-vs-incrementality',
    evidence: ['Platform-attributed revenue is observed.', 'No incrementality experiment exists.'],
    claims: [
      claim('platform-attributed', 'FACT', 'platform_attributed_revenue', 'Platform-attributed revenue was 10000.', 10000, { source: 'meta', unit: 'CAD' }),
      claim('incremental-unknown', 'UNKNOWN', 'incremental_revenue', 'Incremental revenue cannot be determined.', undefined),
    ],
    materialityInput: { currentValue: 10000, comparisonValue: 9500, completeness: 0.9, sampleSize: 50 },
    expectedMateriality: 'WATCH',
    candidate: {
      state: 'INVESTIGATE',
      target: 'incrementality',
      reason: 'Attribution is observed but incremental contribution is unknown.',
      supportingClaimIds: ['platform-attributed'],
      risk: 'MEDIUM',
      reversibility: 'EASY',
      measurementRequirement: 'Run an incrementality-capable measurement design.',
      conditionsThatWouldChangeDecision: ['Causal evidence becomes available.'],
    },
    expectedDecision: 'INVESTIGATE',
    forbiddenClaims: ['Meta generated 10000 in incremental revenue.'],
    conclusionClaimIds: ['platform-attributed', 'incremental-unknown'],
  },
  {
    id: 'contradictory-sources',
    evidence: ['Source A reports 500.', 'Source B reports 350.'],
    claims: [
      claim('source-a', 'FACT', 'orders', 'Source A reports 500 orders.', 500, { source: 'source-a' }),
      claim('source-b', 'FACT', 'orders', 'Source B reports 350 orders.', 350, { source: 'source-b' }),
    ],
    contradictionInputs: [{ id: 'order-conflict', claimIds: ['source-a', 'source-b'] }],
    materialityInput: { currentValue: 500, comparisonValue: 350, completeness: 0.9, sampleSize: 100 },
    expectedMateriality: 'CRITICAL',
    candidate: {
      state: 'KEEP',
      target: 'plan',
      reason: 'Hold until order discrepancy is resolved.',
      supportingClaimIds: ['source-a'],
      risk: 'MEDIUM',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['Reconcile source definitions.'],
    },
    expectedDecision: 'INVESTIGATE',
    forbiddenClaims: ['Orders were definitely 500.'],
    conclusionClaimIds: ['source-a', 'source-b'],
  },
  {
    id: 'correlation-without-causality',
    evidence: ['Spend and revenue moved together.', 'No causal design exists.'],
    claims: [
      claim('correlation', 'INFERENCE', 'spend_revenue_association', 'Spend and revenue movement are associated.', 0.72, { source: 'analysis', unit: 'correlation', causalConfidence: 0.2 }),
    ],
    materialityInput: { currentValue: 0.72, comparisonValue: 0.6, completeness: 0.9, sampleSize: 80 },
    expectedMateriality: 'MATERIAL',
    candidate: {
      state: 'KEEP',
      target: 'spend',
      reason: 'Association alone does not justify a causal spend change.',
      supportingClaimIds: ['correlation'],
      risk: 'MEDIUM',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['Causal evidence is obtained.'],
    },
    expectedDecision: 'KEEP',
    forbiddenClaims: ['Higher spend caused higher revenue.'],
    conclusionClaimIds: ['correlation'],
  },
  {
    id: 'false-leading-premise',
    evidence: ['Spend declined from 120 to 100.'],
    claims: [
      claim('spend-decline', 'FACT', 'spend', 'Spend was 100.', 100, { comparisonValue: 120, source: 'ads', unit: 'CAD', materiality: 'MATERIAL' }),
    ],
    materialityInput: { currentValue: 100, comparisonValue: 120, completeness: 1, sampleSize: 50 },
    expectedMateriality: 'MATERIAL',
    candidate: {
      state: 'KEEP',
      target: 'budget',
      reason: 'The premise of increased spend is contradicted by observed spend.',
      supportingClaimIds: ['spend-decline'],
      risk: 'LOW',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['New spend evidence changes the comparison.'],
    },
    expectedDecision: 'KEEP',
    forbiddenClaims: ['Yes, spend increased.'],
    premise: { text: 'Spend increased, so should we cut it?', status: 'CONTRADICTED', correctingClaimIds: ['spend-decline'] },
    conclusionClaimIds: ['spend-decline'],
  },
  {
    id: 'good-roas-unprofitable',
    evidence: ['Observed ROAS is 2.1.', 'Merchant break-even ROAS is supplied as 2.7.'],
    claims: [
      claim('roas', 'FACT', 'roas', 'Observed ROAS was 2.1.', 2.1, { source: 'ads', unit: 'x', materiality: 'MATERIAL' }),
    ],
    economics: { breakEvenRoas: 2.7 },
    materialityInput: { currentValue: 2.1, comparisonValue: 2.7, completeness: 0.95, sampleSize: 100, merchantThresholdCrossed: true },
    expectedMateriality: 'MATERIAL',
    candidate: {
      state: 'REDUCE',
      target: 'campaign',
      reason: 'Observed ROAS is below the supplied merchant break-even ROAS.',
      supportingClaimIds: ['roas'],
      risk: 'MEDIUM',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['ROAS rises above break-even.'],
    },
    expectedDecision: 'REDUCE',
    forbiddenClaims: ['2.1x is profitable.', 'Break-even is 2.7x when no threshold is supplied.'],
    conclusionClaimIds: ['roas'],
  },
  {
    id: 'insufficient-observation-period',
    evidence: ['Only five observations exist in the current period.'],
    claims: [
      claim('early-signal', 'INFERENCE', 'performance_signal', 'Early performance may be weaker.', -0.2, { source: 'analysis', unit: 'ratio', measurementConfidence: 0.5, completeness: 0.8, materiality: 'UNKNOWN' }),
    ],
    materialityInput: { currentValue: 80, comparisonValue: 100, completeness: 0.8, sampleSize: 5 },
    expectedMateriality: 'UNKNOWN',
    candidate: {
      state: 'STOP',
      target: 'campaign',
      reason: 'Early signal is weak.',
      supportingClaimIds: ['early-signal'],
      risk: 'HIGH',
      reversibility: 'EASY',
      conditionsThatWouldChangeDecision: ['Observation period matures.'],
    },
    expectedDecision: 'INSUFFICIENT_EVIDENCE',
    forbiddenClaims: ['Stop the campaign because performance is conclusively weak.'],
    conclusionClaimIds: ['early-signal'],
  },
  {
    id: 'recommendation-requested-with-inadequate-evidence',
    evidence: ['The requested decision metric is unavailable.'],
    claims: [
      claim('decision-metric-unknown', 'UNKNOWN', 'decision_metric', 'The decision metric is unavailable.', undefined),
    ],
    materialityInput: { currentValue: 0, completeness: 0.1 },
    expectedMateriality: 'UNKNOWN',
    expectedDecision: 'INSUFFICIENT_EVIDENCE',
    forbiddenClaims: ['Scale.', 'Reduce.', 'Stop.'],
    conclusionClaimIds: ['decision-metric-unknown'],
  },
])

export function materializeFixture(fixture: AdversarialFixture): AnswerSpec {
  const ledger = buildClaimLedger(fixture.claims)
  const contradictions = (fixture.contradictionInputs ?? []).map((item) => buildContradiction(ledger, item))
  const materiality = evaluateMateriality(fixture.materialityInput)
  const economics = buildMerchantEconomics(fixture.economics ?? {})
  const decision = governDecision(ledger, contradictions, fixture.candidate)
  return buildAnswerSpec({
    question: 'Synthetic adversarial fixture: ' + fixture.id,
    claimLedger: ledger,
    materiality: [materiality],
    contradictions,
    decision,
    merchantEconomics: economics,
    conclusionClaimIds: fixture.conclusionClaimIds,
    userPremise: fixture.premise,
  })
}

export function makeValidDraft(spec: AnswerSpec): DraftAnswer {
  const usedClaims = spec.claimLedger.claims.filter((claim) => claim.type !== 'UNKNOWN')
  const textParts = ['The governed evidence supports the stated decision.']
  if (spec.requiredContradictionIds.length > 0) textParts.push('A material contradiction remains unresolved.')
  if (spec.unknownClaimIds.length > 0) textParts.push('Kivviq cannot determine the governed unknowns from available evidence.')
  if (spec.userPremise?.status === 'CONTRADICTED') textParts.push('The user premise is contradicted by the governed evidence.')

  return {
    text: textParts.join(' '),
    usedClaimIds: usedClaims.map((claim) => claim.id),
    claimLanguage: usedClaims.map((claim) => ({ claimId: claim.id, strength: claim.allowedLanguage })),
    numericMentions: usedClaims.flatMap((claim) => claim.currentValue ? [{ claimId: claim.id, value: claim.currentValue.value }] : []),
    sourceAttributions: usedClaims.flatMap((claim) => {
      const source = claim.sourceIds[0]
      return source ? [{ claimId: claim.id, sourceId: source }] : []
    }),
    acknowledgedContradictionIds: [...spec.requiredContradictionIds],
    acknowledgedUnknownClaimIds: [...spec.unknownClaimIds],
    acknowledgedDisclosureIds: [...spec.requiredDisclosureIds],
    recommendation: spec.decision.state === 'INSUFFICIENT_EVIDENCE'
      ? undefined
      : { state: spec.decision.state, target: spec.decision.target },
    merchantThresholdMentions: [],
    premiseCorrected: spec.userPremise?.status === 'CONTRADICTED' ? true : undefined,
  }
}
