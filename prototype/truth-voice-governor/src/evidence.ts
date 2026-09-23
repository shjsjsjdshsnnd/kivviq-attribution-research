import type { Period } from './types.js'

export type CoverageState = 'complete' | 'partial' | 'missing' | 'not_applicable'
export type Metric = 'store_profit' | 'store_contribution' | 'paid_channel_contribution' | 'revenue' | 'paid_spend' | 'transaction_revenue' | 'acquisition_revenue' | string
export type Scope = 'whole_business' | 'paid_attributed_orders' | 'transaction_channel' | 'acquisition_channel' | string
export type Dimension = 'none' | 'transaction_channel' | 'acquisition_channel' | string
export interface EvidenceRequest {
  requested_metric: Metric
  requested_scope: Scope
  period: Period
  currency: string
  required_evidence: readonly string[]
  dimension?: Dimension
  dimension_value?: string
  population?: string
}
export interface Coverage {
  state: CoverageState
  reason?: string
  covered?: number
  total?: number
}
export interface GovernedFact {
  id: string
  metric: Metric
  scope: Scope
  dimension: Dimension
  dimension_value: string | null
  population: string
  period: Period
  currency: string
  source: string
  methodology: string
  coverage: Coverage
  freshness: string
  status: CoverageState
  value: number | null
}
export interface EvidenceDecision {
  primary: boolean
  reasons: readonly string[]
  fact: GovernedFact
}

export function assertEvidenceRequest(request: EvidenceRequest): void {
  if (!request.requested_metric || !request.requested_scope || !request.currency || !request.period?.start || !request.period.end || !Array.isArray(request.required_evidence)) throw new Error('invalid evidence request')
  if ((request.dimension && request.dimension !== 'none') && !request.dimension_value) throw new Error('dimension value required')
}
export function assertGovernedFact(fact: GovernedFact): void {
  if (!fact.id || !fact.metric || !fact.scope || !fact.dimension || !fact.population || !fact.period?.start || !fact.period.end || !fact.currency || !fact.source || !fact.methodology || !fact.freshness || !fact.coverage?.state || !fact.status) throw new Error('incomplete governed fact')
  if ((fact.dimension === 'none') !== (fact.dimension_value === null)) throw new Error('invalid fact dimension')
  if (fact.status === 'complete' && (fact.coverage.state !== 'complete' || fact.value === null || !Number.isFinite(fact.value))) throw new Error('invalid complete fact')
  if (fact.status === 'missing' && fact.value !== null) throw new Error('missing fact has a value')
  if (fact.value !== null && !Number.isFinite(fact.value)) throw new Error('non-finite fact')
  if (fact.coverage.covered !== undefined && fact.coverage.total !== undefined && (fact.coverage.covered < 0 || fact.coverage.total < fact.coverage.covered)) throw new Error('invalid coverage count')
}
export function compareEvidence(request: EvidenceRequest, fact: GovernedFact): EvidenceDecision {
  assertEvidenceRequest(request)
  assertGovernedFact(fact)
  const reasons: string[] = []
  if (request.requested_metric !== fact.metric) reasons.push('METRIC_MISMATCH')
  if (request.requested_scope !== fact.scope) reasons.push('SCOPE_MISMATCH')
  if ((request.dimension ?? 'none') !== fact.dimension || (request.dimension_value ?? null) !== fact.dimension_value) reasons.push('DIMENSION_MISMATCH')
  if (request.population && request.population !== fact.population) reasons.push('POPULATION_MISMATCH')
  if (request.period.start !== fact.period.start || request.period.end !== fact.period.end) reasons.push('PERIOD_MISMATCH')
  if (request.currency !== fact.currency) reasons.push('CURRENCY_MISMATCH')
  if (fact.status !== 'complete' || fact.coverage.state !== 'complete') reasons.push('INCOMPLETE_EVIDENCE')
  return { primary: reasons.length === 0, reasons, fact }
}
export function governEvidence(request: EvidenceRequest, facts: readonly GovernedFact[]): { primary: readonly GovernedFact[]; secondary: readonly EvidenceDecision[] } {
  const decisions = facts.map(fact => compareEvidence(request, fact))
  return { primary: decisions.filter(d => d.primary).map(d => d.fact), secondary: decisions.filter(d => !d.primary) }
}
