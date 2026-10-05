import test from 'node:test'
import assert from 'node:assert/strict'
import { selectExperiment, calculatePower, informationValue, fingerprint, designRegistry } from '../../.selector-test-build/experiment_selector/core.js'
import { assessExperimentResult, sampleRatioMismatch } from '../../.selector-test-build/experiment_selector/results.js'

const copy = x => structuredClone(x)
const ready = { assess: () => ({ status: 'READY', reasons: [], evidenceRefs: ['canonical:readiness'] }) }
function model(i) {
  const { workspaceId, snapshotId, currency, horizonDays } = i.context
  return { context: { workspaceId, snapshotId, currency, horizonDays }, actionFingerprint: i.action.fingerprint, evidenceRefs: ['posterior:validated'], scenarios: [
    { id: 'benefit', probability: .5, actionNetValue: 12000, signals: { positive: .9, negative: .1 } },
    { id: 'harm', probability: .5, actionNetValue: -8000, signals: { positive: .1, negative: .9 } },
  ] }
}
function fixture() {
  const i = {
    question: 'Should we change the shipping threshold?',
    context: { workspaceId: 'workspace:test', snapshotId: 'snapshot:1', asOf: '2026-10-05T12:00:00.000Z', timeZone: 'America/Toronto', currency: 'CAD', horizonDays: 90, evidenceRefs: ['state:1'] },
    action: { id: 'action_shipping', fingerprint: 'fnv1a64:1234567890123456', domain: 'shipping', targetRef: 'shop:test', populationRef: 'population:customers', controlActionRef: 'action_baseline', controlFingerprint: 'fnv1a64:6543210987654321', reversibility: 'FULL', constraints: 'PASS' },
    objective: { ref: 'metric:contribution', kind: 'continuous', direction: 'MAXIMIZE', unit: 'CAD/customer', minimumWorthwhileEffect: 1, definitionRef: 'metric-definition:1', outcomeHorizonDays: 14, isContribution: true, contributionGuardrailRef: null, secondaryRefs: ['metric:revenue'], guardrails: [] },
    evidence: { retrieval: 'OK', measurement: 'PASS', refs: ['shopify:observed'], causal: [], confounders: ['seasonality'] },
    economics: { plausibleUpside: 20000, worstCaseActionLoss: 10000, maxActionLoss: 12000, maxTestLoss: 3000, implementationCost: 100, materialityThreshold: 500, fullyCosted: true, evidenceRefs: ['commerce:costs'] },
    sample: { populationRef: 'population:customers', unit: 'CUSTOMER', eligibleUnits: 100000, unitsPerDay: 1000, enrollment: 'ARRIVING', outcomeLagDays: 7, minimumExposureDays: 7, baseline: 10, variance: 100, expectedEffect: 2, independentUnits: true, distributionValidated: true, observedAt: '2026-10-04T12:00:00.000Z', validUntil: '2026-10-12T12:00:00.000Z', evidenceRefs: ['sample:1'] },
    designs: [{ id: 'design:a', design: 'customer_ab', unit: 'CUSTOMER', populationRef: 'population:customers', capability: 'AVAILABLE', capabilityExpiresAt: '2026-10-12T12:00:00.000Z', assignment: 'PASS', contamination: 'PASS', instrumentation: 'PASS', controlFraction: .5, maxEnrollmentDays: 45, washoutDays: 0, setupCost: 200, exposureCost: 300, delayCost: 100, worstCaseLoss: 1000, operationalCheck: 'PASS', evidenceRefs: ['engine:verified'], information: null }], investigation: null, exemption: null,
  }
  return rebind(i)
}
function rebind(i) {
  for (const d of i.designs) {
    const p = calculatePower(i, d)
    d.information = p ? { ...model(i), planFingerprint: p.fingerprint } : null
  }
  return i
}
function causal(i, overrides = {}) {
  return { workspaceId: i.context.workspaceId, actionFingerprint: i.action.fingerprint, populationRef: i.action.populationRef, metricRef: i.objective.ref, metricDefinitionRef: i.objective.definitionRef, horizonDays: i.objective.outcomeHorizonDays, currency: i.context.currency, completedAt: '2026-10-01T12:00:00.000Z', validUntil: '2026-12-01T12:00:00.000Z', evidenceRef: 'result:1', methodology: 'randomized', validity: 'PASS', economicGuardrails: 'PASS', causalClaimPermitted: true, low: 1.2, high: 2.5, level: .95, ...overrides }
}

test('returns a powered economically positive experiment, never authorization', () => {
  const i = fixture(), before = copy(i), s = selectExperiment(i, ready)
  assert.equal(s.status, 'RUN_EXPERIMENT')
  assert.equal(s.executionAuthorization, 'NOT_AUTHORIZED')
  assert.equal(s.proposedActionDisposition, 'DEFER')
  assert.ok(s.experiment.power.control >= 1570)
  assert.equal(s.experiment.power.durationDays, 18)
  assert.equal(s.experiment.power.enrollmentDays, 4)
  assert.equal(s.experiment.expectedEconomicImpact.evsi, 3000)
  assert.equal(s.experiment.expectedEconomicImpact.netLearningValue, 2400)
  assert.deepEqual(i, before)
  assert.deepEqual(selectExperiment(i, ready), s)
})

test('known causal effect permits recommendation but not execution', () => {
  const i = fixture(); i.evidence.causal = [causal(i)]
  const s = selectExperiment(i, ready)
  assert.equal(s.status, 'ACT_NOW'); assert.equal(s.causalStatus, 'IDENTIFIED')
  assert.equal(s.executionAuthorization, 'NOT_AUTHORIZED')
})
for (const [label, change] of [
  ['other tenant', { workspaceId: 'other' }], ['other dose', { actionFingerprint: 'other' }],
  ['other population', { populationRef: 'other' }], ['other KPI', { metricRef: 'other' }],
  ['other definition', { metricDefinitionRef: 'other' }], ['other currency', { currency: 'USD' }],
  ['other outcome horizon', { horizonDays: 90 }], ['expired evidence', { validUntil: '2026-10-01T12:00:00.000Z' }],
  ['future result', { completedAt: '2027-01-01T12:00:00.000Z' }], ['observational method', { methodology: 'observational' }],
  ['contaminated result', { validity: 'FAIL' }], ['no causal permission', { causalClaimPermitted: false }],
  ['profit guardrail failed', { economicGuardrails: 'FAIL' }], ['low confidence', { level: .9 }],
]) test(`does not ACT_NOW on ${label}`, () => {
  const i = fixture(); i.evidence.causal = [causal(i, change)]
  assert.notEqual(selectExperiment(i, ready).status, 'ACT_NOW')
})

test('contradictory valid experiments are not silently pooled or discarded', () => {
  const i = fixture(); i.evidence.causal = [causal(i), causal(i, { evidenceRef: 'result:2', low: -4, high: -1, economicGuardrails: 'FAIL' })]
  assert.notEqual(selectExperiment(i, ready).status, 'ACT_NOW')
})
for (const state of ['FAIL', 'UNKNOWN']) test(`measurement ${state} prevents a test`, () => {
  const i = fixture(); i.evidence.measurement = state
  assert.equal(selectExperiment(i, ready).status, 'INVESTIGATE_MORE')
})
test('failed experiment retrieval is not no experiments', () => {
  const i = fixture(); i.evidence.retrieval = 'UNAVAILABLE'
  const s = selectExperiment(i, ready)
  assert.equal(s.causalStatus, 'UNAVAILABLE'); assert.ok(s.reasonCodes.includes('EVIDENCE_RETRIEVAL_FAILED'))
})
test('mechanical repair need not experiment on broken measurement', () => {
  const i = fixture(); i.action.domain = 'remediation'; i.evidence.measurement = 'FAIL'
  i.exemption = { kind: 'REMEDIATION', verified: true, proofRef: 'trace:root-cause', replacementActionRef: 'action_repair' }
  assert.equal(selectExperiment(i).status, 'ACT_NOW')
})
test('behavioral action cannot masquerade as a mechanical fix', () => {
  const i = fixture(); i.exemption = { kind: 'REMEDIATION', verified: true, proofRef: 'trace:fake', replacementActionRef: 'action_shipping' }
  assert.notEqual(selectExperiment(i).status, 'ACT_NOW')
})
test('dominated proposal is rejected in favor of the proven alternative', () => {
  const i = fixture(); i.exemption = { kind: 'DOMINATED', verified: true, proofRef: 'proof:1', replacementActionRef: 'action_baseline' }
  const s = selectExperiment(i); assert.equal(s.status, 'ACT_NOW'); assert.equal(s.proposedActionDisposition, 'REJECT')
})
test('low economic exposure selects monitoring, not arbitrary experimentation', () => {
  const i = fixture(); i.economics.plausibleUpside = 200
  assert.equal(selectExperiment(i, ready).status, 'MONITOR')
})
test('implementation cost exceeding upside rejects proposal without a test', () => {
  const i = fixture(); i.economics.implementationCost = 21000
  assert.equal(selectExperiment(i).proposedActionDisposition, 'REJECT')
})
test('unknown costs are not zero', () => {
  const i = fixture(); i.designs[0].setupCost = null
  assert.equal(selectExperiment(i, ready).status, 'INVESTIGATE_MORE')
})
test('underpowered business is told testing is infeasible', () => {
  const i = fixture(); i.sample.eligibleUnits = 50; rebind(i)
  const s = selectExperiment(i, ready)
  assert.equal(s.status, 'EXPERIMENT_NOT_FEASIBLE'); assert.ok(s.reasonCodes.includes('INSUFFICIENT_SAMPLE'))
})
test('finite audience pool is not counted again each day', () => {
  const i = fixture(); i.sample.enrollment = 'FIXED_POOL'; i.sample.eligibleUnits = 200; i.sample.unitsPerDay = null; rebind(i)
  assert.equal(selectExperiment(i, ready).status, 'EXPERIMENT_NOT_FEASIBLE')
})
test('fixed pool has a maturation window even without recruitment', () => {
  const i = fixture(); i.sample.enrollment = 'FIXED_POOL'; i.sample.unitsPerDay = null; rebind(i)
  assert.equal(selectExperiment(i, ready).experiment.power.durationDays, 14)
})
for (const [key, value, status] of [
  ['capability', 'UNKNOWN', 'INVESTIGATE_MORE'], ['capability', 'UNAVAILABLE', 'EXPERIMENT_NOT_FEASIBLE'],
  ['assignment', 'FAIL', 'EXPERIMENT_NOT_FEASIBLE'], ['contamination', 'FAIL', 'EXPERIMENT_NOT_FEASIBLE'],
  ['instrumentation', 'UNKNOWN', 'INVESTIGATE_MORE'], ['worstCaseLoss', 5000, 'EXPERIMENT_NOT_FEASIBLE'],
  ['maxEnrollmentDays', 1, 'EXPERIMENT_NOT_FEASIBLE'],
]) test(`${key}=${value} gates selection`, () => {
  const i = fixture(); i.designs[0][key] = value
  assert.equal(selectExperiment(i, ready).status, status)
})
test('a failed or unavailable canonical gate cannot be skipped', () => {
  assert.equal(selectExperiment(fixture()).status, 'INVESTIGATE_MORE')
  assert.equal(selectExperiment(fixture(), { assess() { throw Error('not loaded') } }).status, 'INVESTIGATE_MORE')
  assert.equal(selectExperiment(fixture(), { assess: () => ({ status: 'BLOCKED', reasons: ['overlap'], evidenceRefs: ['gate:1'] }) }).status, 'EXPERIMENT_NOT_FEASIBLE')
})
for (const design of ['geo_randomized', 'switchback', 'randomized_rollout', 'platform_lift']) test(`never reuses independent-customer power for ${design}`, () => {
  const i = fixture(); i.action.domain = 'paid_media'; i.designs[0].design = design
  const s = selectExperiment(i, ready)
  assert.equal(s.status, 'EXPERIMENT_NOT_FEASIBLE'); assert.ok(s.reasonCodes.includes('METHOD_NOT_IMPLEMENTED'))
})
test('different plausible causes require causal evidence, not more attribution labels', () => {
  const i = fixture(); i.evidence.confounders = ['promotion', 'seasonality', 'selection_bias']; rebind(i)
  assert.equal(selectExperiment(i, ready).status, 'RUN_EXPERIMENT')
})
test('information value respects imperfect signals and does not double count costs', () => {
  const m = model(fixture()), v = informationValue(m, 600)
  assert.equal(v.evpi, 4000); assert.equal(v.evsi, 3000); assert.equal(v.currentBestValue, 2000)
  assert.equal(v.candidateValue, 4400); assert.equal(v.netLearningValue, 2400)
  for (const w of m.scenarios) w.signals = { positive: .5, negative: .5 }
  assert.equal(informationValue(m, 600).evsi, 0)
})
test('bad probabilities and missing signals do not get repaired into a score', () => {
  const m = model(fixture()); m.scenarios[0].probability = .6
  assert.equal(informationValue(m, 0), null)
  m.scenarios[0].probability = .5; delete m.scenarios[0].signals.positive
  assert.equal(informationValue(m, 0), null)
})
test('noisy-result forecast must be bound to this exact sample plan', () => {
  const i = fixture(); i.designs[0].controlFraction = .2
  assert.equal(selectExperiment(i, ready).status, 'INVESTIGATE_MORE')
})
test('all learning options must use the same prior economics', () => {
  const i = fixture(); i.designs.push(copy(i.designs[0])); i.designs[1].id = 'design:b'; rebind(i)
  i.designs[1].information.scenarios[0].actionNetValue = 100000
  assert.ok(selectExperiment(i, ready).reasonCodes.includes('INVALID_INPUT'))
})
test('cheaper targeted investigation can beat experimentation', () => {
  const i = fixture(); i.investigation = { id: 'investigate:1', question: 'Read existing holdout', evidenceRequest: 'Retrieve the archived assignment and control outcomes.', cost: 50, delayCost: 20, durationDays: 1, information: model(i) }
  assert.equal(selectExperiment(i, ready).selectedActionRef, 'investigate:1')
})
test('negative net information value selects monitoring', () => {
  const i = fixture(); i.designs[0].setupCost = 3000; i.economics.maxTestLoss = 10000
  assert.equal(selectExperiment(i, ready).status, 'MONITOR')
})
test('binary sample-size matches statsmodels two-proportion reference', () => {
  const i = fixture(); i.objective.kind = 'binary'; i.objective.minimumWorthwhileEffect = .004; i.sample.baseline = .02
  const p = calculatePower(i, i.designs[0])
  assert.equal(p.control, 21109); assert.equal(p.treatment, 21109)
})
test('unequal allocation costs more total sample', () => {
  const i = fixture(), balanced = calculatePower(i, i.designs[0]); i.designs[0].controlFraction = .2
  assert.ok(calculatePower(i, i.designs[0]).total > balanced.total)
})
for (const mutation of [
  i => { i.economics = null }, i => { i.economics.fullyCosted = false },
  i => { i.sample.variance = null }, i => { i.sample.independentUnits = false },
  i => { i.sample.distributionValidated = false }, i => { i.sample.unitsPerDay = 0 },
  i => { i.sample.observedAt = '2027-01-01T12:00:00.000Z' },
]) test('missing or invalid statistical/economic evidence fails closed', () => {
  const i = fixture(); mutation(i)
  assert.notEqual(selectExperiment(i, ready).status, 'RUN_EXPERIMENT')
})

test('strict JSON contract rejects hidden oracle and malformed values', () => {
  for (const mutate of [i => { i.groundTruth = {} }, i => { i.context.oracle = 100 }, i => { i.economics.plausibleUpside = NaN }, i => { i.designs[0].design = 'constructor' }, i => { i.sample.independentUnits = 'true' }, i => { i.context.asOf = '2026-02-30T12:00:00Z' }, i => { i.action.controlFingerprint = i.action.fingerprint }]) {
    const i = fixture(); mutate(i); const s = selectExperiment(i, ready)
    assert.equal(s.status, 'INVESTIGATE_MORE'); assert.ok(s.reasonCodes.includes('INVALID_INPUT'))
  }
  const circular = fixture(); circular.context.evidenceRefs = circular
  assert.ok(selectExperiment(circular, ready).reasonCodes.includes('INVALID_INPUT'))
})
test('1000 deterministic adversarial low-volume/high-risk cases never recommend a test', () => {
  for (let k = 0; k < 1000; k++) {
    const i = fixture(); i.sample.eligibleUnits = k % 50; i.designs[0].worstCaseLoss = 4000 + k; rebind(i)
    const s = selectExperiment(i, ready); assert.notEqual(s.status, 'RUN_EXPERIMENT'); assert.equal(s.executionAuthorization, 'NOT_AUTHORIZED')
  }
})
test('registry callers cannot mutate global design support', () => {
  const r = designRegistry(); r.geo_randomized.implemented = true; r.customer_ab.domains.push('paid_media')
  assert.equal(designRegistry().geo_randomized.implemented, false)
  assert.ok(!designRegistry().customer_ab.domains.includes('paid_media'))
})

function resultFixture() {
  const i = fixture(), spec = selectExperiment(i, ready).experiment, n = Math.max(spec.power.control, spec.power.treatment)
  const arm = (mean, variance = 100) => ({ assigned: n, measured: n, sum: n * mean, sumSquares: (n - 1) * variance + n * mean * mean })
  const context = { ...i.context, asOf: '2026-11-05T12:00:00.000Z' }
  const result = { workspaceId: i.context.workspaceId, snapshotId: i.context.snapshotId, experimentId: spec.id, specificationFingerprint: fingerprint(spec), resultRef: 'result:validated', revision: 1, completedAt: '2026-11-01T12:00:00.000Z', validUntil: '2026-12-01T12:00:00.000Z', elapsedCompleteDays: spec.power.durationDays, preregisteredBeforeExposure: true, integrity: { assignment: 'PASS', exposure: 'PASS', contamination: 'PASS', outcomeMaturity: 'PASS', stoppingRule: 'PASS' }, primary: { metricRef: spec.primaryKpi.ref, definitionRef: spec.primaryKpi.definitionRef, control: arm(10), treatment: arm(12) }, guardrails: [] }
  return { i, spec, context, result, arm }
}
test('valid completed result produces a scoped idempotent learning event', () => {
  const { spec, context, result } = resultFixture(), a = assessExperimentResult(context, spec, result)
  assert.equal(a.validity, 'VALID'); assert.equal(a.economicDecision, 'ADOPT')
  assert.equal(a.causalEvidence.horizonDays, spec.primaryKpi.outcomeHorizonDays)
  assert.deepEqual(a.learningEvent, assessExperimentResult(context, spec, result).learningEvent)
  assert.equal(a.learningEvent.executionAuthorization, 'NOT_AUTHORIZED')
})
for (const mutation of [r => { r.integrity.contamination = 'FAIL' }, r => { r.preregisteredBeforeExposure = false }, r => { r.integrity.stoppingRule = 'FAIL' }, r => { r.primary.control.measured -= 10 }, r => { r.specificationFingerprint = 'other' }, r => { r.workspaceId = 'other' }, r => { r.elapsedCompleteDays = 0 }]) test('invalid or premature result never updates learning', () => {
  const { spec, context, result } = resultFixture(); mutation(result)
  assert.equal(assessExperimentResult(context, spec, result).learningEvent, null)
})
test('significant primary lift with harmful profit guardrail is not a success', () => {
  const { spec, context, result, arm } = resultFixture()
  spec.primaryKpi.isContribution = false; spec.primaryKpi.contributionGuardrailRef = 'metric:profit'
  spec.guardrails = [{ ref: 'metric:profit', operator: 'AT_LEAST', threshold: 0, unit: 'CAD/customer', definitionRef: 'profit-definition:1' }]
  result.specificationFingerprint = fingerprint(spec)
  result.guardrails = [{ metricRef: 'metric:profit', definitionRef: 'profit-definition:1', control: arm(10), treatment: arm(7) }]
  const a = assessExperimentResult(context, spec, result)
  assert.equal(a.statisticalOutcome, 'POSITIVE'); assert.equal(a.economicDecision, 'REJECT')
  assert.equal(a.causalEvidence.economicGuardrails, 'FAIL')
})
test('inconclusive means uncertain, not zero effect', () => {
  const { spec, context, result, arm } = resultFixture(); result.primary.treatment = arm(10.1)
  const a = assessExperimentResult(context, spec, result)
  assert.equal(a.statisticalOutcome, 'INCONCLUSIVE'); assert.equal(a.economicDecision, 'INCONCLUSIVE')
  assert.ok(a.estimate.low < 0 && a.estimate.high > 0)
})
test('SRM checks assignment population, not conversions', () => {
  assert.equal(sampleRatioMismatch(5000, 5000, .5), false)
  assert.equal(sampleRatioMismatch(5000, 7000, .5), true)
  assert.equal(sampleRatioMismatch(2000, 8000, .2), false)
})


// Timing is civil-calendar based; DST does not silently shorten a test.
import { measurementWindowFits } from '../../.selector-test-build/experiment_selector/timing.js'
const timing = { asOf: '2026-10-31T04:00:00Z', approvedClock: '2026-10-31T04:00:00Z', timeZone: 'America/Toronto', horizonDays: 90, start: '2026-10-31T04:00:00Z', end: '2026-11-14T05:00:00Z', minimumDurationDays: 14 }
test('powered measurement window survives the 25-hour DST day', () => assert.equal(measurementWindowFits(timing), true))
test('unpowered shortened window is rejected', () => assert.equal(measurementWindowFits({ ...timing, end: '2026-11-13T05:00:00Z' }), false))
test('UTC midnight is not merchant-local midnight', () => assert.equal(measurementWindowFits({ ...timing, start: '2026-10-31T00:00:00Z' }), false))
test('stale approved clock is rejected', () => assert.equal(measurementWindowFits({ ...timing, approvedClock: '2026-10-30T04:00:00Z' }), false))
