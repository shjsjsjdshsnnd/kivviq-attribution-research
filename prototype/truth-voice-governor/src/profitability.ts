import { assertGovernedFact, type Coverage, type CoverageState, type GovernedFact } from './evidence.js'
import type { Period } from './types.js'

export const PROFIT_COMPONENTS = ['revenue', 'refunds', 'discounts', 'cogs', 'google_ads', 'meta_ads', 'pinterest_ads', 'payment_fees', 'shipping', 'payroll', 'rent', 'other'] as const
export type ProfitComponent = typeof PROFIT_COMPONENTS[number]
export type PaidProvider = 'google_ads' | 'meta_ads' | 'pinterest_ads'
export interface ComponentInput { value: number | null; coverage: Coverage; source: string; served_from: string; served_to: string; currency: string; freshness: string; status: CoverageState }
export type ComponentInputs = Partial<Record<ProfitComponent, ComponentInput>>
export interface ProfitResult { metric: 'store_contribution'; scope: 'whole_business'; value: number | null; currency: string; period: Period; status: CoverageState; coverage: Record<ProfitComponent, Coverage>; missing: readonly ProfitComponent[]; paid_spend: readonly GovernedFact[]; net_profit: null }

export function normalizePaidSpend(inputs: ComponentInputs, period: Period, currency: string): readonly GovernedFact[] {
  return (['google_ads', 'meta_ads', 'pinterest_ads'] as const).map(provider => {
    const item = inputs[provider]
    if (item && (item.currency !== currency || item.served_from !== period.start || item.served_to !== period.end)) throw new Error('paid spend window/currency mismatch: ' + provider)
    const fact: GovernedFact = {
      id: 'paid_spend:' + provider, metric: 'paid_spend', scope: 'whole_business', dimension: 'acquisition_channel', dimension_value: provider,
      population: 'all_served_ads', period, currency, source: item?.source ?? provider, methodology: 'normalized served spend',
      coverage: item?.coverage ?? { state: 'missing', reason: 'provider unavailable' }, freshness: item?.freshness ?? 'unknown', status: item?.status ?? 'missing', value: item?.value ?? null,
    }
    assertGovernedFact(fact)
    if (fact.status === 'complete' && fact.value! < 0) throw new Error('negative spend')
    return Object.freeze(fact)
  })
}
export function reconcileStoreContribution(inputs: ComponentInputs, period: Period, currency: string): ProfitResult {
  const paid_spend = normalizePaidSpend(inputs, period, currency)
  const coverage = {} as Record<ProfitComponent, Coverage>
  let total = 0
  let usable = true
  let partial = false
  for (const component of PROFIT_COMPONENTS) {
    const item = inputs[component]
    if (item && (item.currency !== currency || item.served_from !== period.start || item.served_to !== period.end)) throw new Error('component window/currency mismatch: ' + component)
    const fact = paid_spend.find(f => f.dimension_value === component)
    const state = fact?.status ?? item?.status ?? 'missing'
    coverage[component] = fact?.coverage ?? item?.coverage ?? { state: 'missing', reason: 'component unavailable' }
    if (state !== coverage[component].state) throw new Error('component status/coverage mismatch: ' + component)
    if (state === 'missing' || state === 'partial') partial = true
    if (state === 'complete' && (fact?.value ?? item?.value) === null) throw new Error('complete component without value')
    if (state === 'not_applicable') continue
    const value = fact?.value ?? item?.value
    if (value === null || value === undefined || !Number.isFinite(value)) { usable = false; continue }
    total += component === 'revenue' ? value : -value
  }
  const missing = PROFIT_COMPONENTS.filter(component => coverage[component].state === 'missing' || coverage[component].state === 'partial')
  return { metric: 'store_contribution', scope: 'whole_business', value: usable ? total : null, currency, period, status: partial ? 'partial' : 'complete', coverage, missing, paid_spend, net_profit: null }
}
export function channelSpend(facts: readonly GovernedFact[], provider: PaidProvider): number | null {
  const matches = facts.filter(f => f.metric === 'paid_spend' && f.dimension === 'acquisition_channel' && f.dimension_value === provider)
  if (matches.length !== 1) throw new Error('ambiguous canonical paid spend')
  return matches[0]!.status === 'complete' ? matches[0]!.value : null
}
