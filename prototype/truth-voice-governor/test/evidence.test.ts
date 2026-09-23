import assert from 'node:assert/strict'
import test from 'node:test'
import { compareEvidence, governEvidence, reconcileStoreContribution, channelSpend, routeEvidenceRequest, type EvidenceRequest, type GovernedFact, type ComponentInputs, PROFIT_COMPONENTS, buildAnswerSpec, materializeFixture, ADVERSARIAL_FIXTURES, makeValidDraft, verifyDraft } from '../src/index.js'
const period = { start: '2026-08-01', end: '2026-08-30' }
const request: EvidenceRequest = { requested_metric: 'store_profit', requested_scope: 'whole_business', period, currency: 'CAD', required_evidence: ['shopify', 'cogs', 'paid_spend'] }
const fact: GovernedFact = { id: 'store', metric: 'store_profit', scope: 'whole_business', dimension: 'none', dimension_value: null, population: 'all_orders', period, currency: 'CAD', source: 'shopify', methodology: 'reconciled', coverage: {state: 'complete'}, freshness: '2026-09-01', status: 'complete', value: 100 }
const mismatchCases: Array<[string, Partial<GovernedFact>, string]> = [
  ['paid channel contribution', {metric:'paid_channel_contribution', value:6919}, 'METRIC_MISMATCH'],
  ['store contribution', {metric:'store_contribution', value:37625}, 'METRIC_MISMATCH'],
  ['revenue', {metric:'revenue'}, 'METRIC_MISMATCH'],
  ['paid spend', {metric:'paid_spend'}, 'METRIC_MISMATCH'],
  ['attributed scope', {scope:'paid_attributed_orders'}, 'SCOPE_MISMATCH'],
  ['transaction scope', {scope:'transaction_channel'}, 'SCOPE_MISMATCH'],
  ['acquisition scope', {scope:'acquisition_channel'}, 'SCOPE_MISMATCH'],
  ['transaction dimension', {dimension:'transaction_channel',dimension_value:'draft_order'}, 'DIMENSION_MISMATCH'],
  ['acquisition dimension', {dimension:'acquisition_channel',dimension_value:'google_ads'}, 'DIMENSION_MISMATCH'],
  ['USD', {currency:'USD'}, 'CURRENCY_MISMATCH'],
  ['prior period', {period:{start:'2026-07-01',end:'2026-07-30'}}, 'PERIOD_MISMATCH'],
  ['missing', {status:'missing',value:null,coverage:{state:'missing'}}, 'INCOMPLETE_EVIDENCE'],
  ['partial', {status:'partial',coverage:{state:'partial'}}, 'INCOMPLETE_EVIDENCE'],
]
for (const [name, change, reason] of mismatchCases) test('semantic mismatch: '+name, () => {
  const result = compareEvidence(request,{...fact,...change})
  assert.equal(result.primary,false)
  assert.ok(result.reasons.includes(reason))
})
for (const population of ['paid_attributed_orders','online_orders','pos_orders','draft_orders','consented_orders','tracked_sessions','all_sessions','new_customers','returning_customers','all_customers']) test('population mismatch: '+population, () => {
  const result=compareEvidence({...request,population:'all_orders'},{...fact,population})
  assert.equal(result.primary,false)
  assert.ok(result.reasons.includes('POPULATION_MISMATCH'))
})
for (const metric of ['store_profit','store_contribution','paid_channel_contribution','revenue','transaction_revenue','acquisition_revenue']) for (const scope of ['whole_business','paid_attributed_orders','transaction_channel','acquisition_channel']) test('metric and scope matrix: '+metric+'/'+scope, () => {
  const result=compareEvidence(request,{...fact,metric,scope})
  assert.equal(result.primary,metric==='store_profit' && scope==='whole_business')
})
for (const [dimension,value] of [['transaction_channel','draft_order'],['transaction_channel','online_store'],['acquisition_channel','google_ads'],['acquisition_channel','meta_ads'],['acquisition_channel','pinterest_ads']] as const) test('dimension pairing: '+dimension+'/'+value, () => {
  const candidate={...fact,metric:dimension==='transaction_channel'?'transaction_revenue':'acquisition_revenue',scope:dimension,dimension,dimension_value:value,value:dimension==='transaction_channel'?33978:27995}
  const matching={...request,requested_metric:candidate.metric,requested_scope:dimension,dimension,dimension_value:value}
  assert.equal(compareEvidence(matching,candidate).primary,true)
  const wrong=dimension==='transaction_channel'?'acquisition_channel':'transaction_channel'
  assert.equal(compareEvidence({...matching,dimension:wrong},candidate).primary,false)
})
test('incident paid contribution cannot become store profit',()=>{
  const result=governEvidence(request,[{...fact,metric:'paid_channel_contribution',scope:'paid_attributed_orders',population:'paid_attributed_orders',value:6919}])
  assert.equal(result.primary.length,0)
  assert.equal(result.secondary.length,1)
})
test('Meta question cannot consume whole-store contribution',()=>{
  assert.equal(compareEvidence({...request,requested_metric:'paid_channel_contribution',requested_scope:'paid_attributed_orders',dimension:'acquisition_channel',dimension_value:'meta_ads'},{...fact,metric:'store_contribution',value:37625}).primary,false)
})
test('Draft Orders and Google are distinct dimensions, not competing facts',()=>{
  const draft={...fact,id:'draft',metric:'transaction_revenue',scope:'transaction_channel',dimension:'transaction_channel',dimension_value:'draft_order',value:33978}
  const google={...fact,id:'google',metric:'acquisition_revenue',scope:'acquisition_channel',dimension:'acquisition_channel',dimension_value:'google_ads',value:27995}
  assert.equal(governEvidence({...request,requested_metric:'transaction_revenue',requested_scope:'transaction_channel',dimension:'transaction_channel',dimension_value:'draft_order'},[draft,google]).primary[0]?.id,'draft')
})
test('Kivviq context persists for revenue follow-up',()=>{
  assert.equal(routeEvidenceRequest('Revenue last 30 days',{kivviqEstablished:true}),'kivviq')
  assert.equal(routeEvidenceRequest('Revenue last 30 days',{kivviqEstablished:false}),'unspecified')
})
test('governor rejects an incompatible primary conclusion before model generation',()=>{
  const spec=materializeFixture(ADVERSARIAL_FIXTURES[1]!)
  assert.throws(()=>buildAnswerSpec({question:'What was my profit last month?',claimLedger:spec.claimLedger,materiality:spec.materiality,contradictions:spec.contradictions,decision:spec.decision,merchantEconomics:spec.merchantEconomics,conclusionClaimIds:spec.conclusion.claimIds,evidenceRequest:request,evidence:[{...fact,metric:'paid_channel_contribution',scope:'paid_attributed_orders',value:6919}]}),/no semantically compatible/)
  const unsafe={...spec,evidenceRequest:request,evidence:[{...fact,metric:'paid_channel_contribution',scope:'paid_attributed_orders',value:6919}]}
  assert.ok(verifyDraft(unsafe,makeValidDraft(spec)).violations.some(v=>v.code==='SEMANTIC_EVIDENCE_MISMATCH'))
})
test('canonical spend flows through store and channel consumers',()=>{
  const inputs:ComponentInputs={}
  for(const component of PROFIT_COMPONENTS) inputs[component]={value:component==='revenue'?1000:10,coverage:{state:'complete'},source:component,served_from:period.start,served_to:period.end,currency:'CAD',freshness:'2026-09-01',status:'complete'}
  const result=reconcileStoreContribution(inputs,period,'CAD')
  assert.equal(result.value,890)
  assert.equal(result.status,'complete')
  assert.equal(result.net_profit,null)
  assert.equal(channelSpend(result.paid_spend,'google_ads'),10)
  assert.equal(result.coverage.google_ads.state,'complete')
  delete inputs.google_ads
  const partial=reconcileStoreContribution(inputs,period,'CAD')
  assert.equal(partial.status,'partial')
  assert.equal(partial.value,null)
  assert.equal(channelSpend(partial.paid_spend,'google_ads'),null)
  assert.ok(partial.missing.includes('google_ads'))
})
