import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const build = process.env.KIVVIQ_OPTIMIZER_BUILD ?? resolve('dist');
const load = name => import(pathToFileURL(resolve(build, 'decision_optimizer', name + '.js')).href);
const { optimizeDecision, boundedParameterGrid } = await load('optimizer');
const { DEFAULT_SEARCH_POLICY } = await load('types');
const { objectiveFromIntent, metricValue, aggregateMetricTotals, distribution } = await load('math');
const { assessStopRule, buildLearningFeedback, submitLearningFeedback, estimateInformationValue } = await load('lifecycle');

const clone = value => structuredClone(value);
function metrics(patch = {}) {
  return { netRevenue: 1000, costOfGoods: 300, fulfillmentCost: 50, paidMediaCost: 100,
    otherVariableCost: 20, interventionCost: 0, newCustomers: 10, orders: 20, sessions: 100,
    inventoryUnits: 50, retainedCustomers: 5, eligibleCustomers: 10, netCash: 400, ...patch };
}
function option(name, patch = {}) {
  return { optionId: name, opportunityId: 'opp_' + name, merchantId: 'merchant_demo', snapshotId: 'snapshot_one',
    actionId: 'action_' + name, actionFingerprint: 'fingerprint:' + name, label: name,
    actionType: 'paid_media.set_budget', targetRef: 'channel_' + name, parameters: { budget: 100 },
    startDay: 0, endDay: 7, resources: [{ resourceId: 'cash', quantity: 100 }],
    exclusiveGroups: [], conflictKeys: [], dependencies: [], reversibility: 'FULL', owner: 'merchant',
    evidenceRefs: ['evidence_measurement'], assumptions: ['Synthetic test fixture, not a calibrated merchant forecast'], stopRules: [], ...patch };
}
function input(options = [option('a')], patch = {}) {
  return { decisionId: 'decision_test', context: { merchantId: 'merchant_demo', snapshotId: 'snapshot_one',
    currency: 'CAD', moneyUnit: 'MAJOR', asOf: '2026-10-03T00:00:00Z', timeZone: 'UTC',
    dayBoundaries: Array.from({ length: 8 }, (_, index) => new Date(Date.UTC(2026, 9, 3 + index)).toISOString()) },
    objective: objectiveFromIntent('maximize contribution profit'), options,
    resources: [{ resourceId: 'cash', unit: 'MONEY', kind: 'CONSUMABLE', capacityByDay: Array(7).fill(1000), evidenceRefs: ['evidence_budget'] }],
    metricConstraints: [], policy: { ...DEFAULT_SEARCH_POLICY, uncertaintyPenalty: 0, downsidePenalty: 0, practicalTieUtility: 0 }, ...patch };
}
const validGate = { assess() { return { status: 'VALID', reasons: [] }; } };
function twin(effects = {}, configuration = {}) {
  return { predict(request) {
    configuration.onRequest?.(request);
    const baseline = (configuration.baselines ?? [metrics(), metrics(), metrics()]).map((value, index) => ({
      scenarioId: 'scenario_' + index, probability: configuration.probabilities?.[index] ?? 1 / (configuration.baselines?.length ?? 3), metrics: clone(value) }));
    const batch = { modelVersion: 'synthetic-test-model/1', context: clone(request.context), calibrationEvidenceRefs: ['evidence_synthetic_calibration'],
      evidenceRefs: ['evidence_synthetic_model'], assumptions: ['Fixture only; this is not live causal calibration'], baseline,
      forecasts: request.candidates.filter(candidate => candidate.optionIds.length).map(candidate => ({ candidateId: candidate.candidateId,
        outcomes: baseline.map((scenario, index) => {
          const effect = effects[candidate.optionIds.join('+')];
          const patch = typeof effect === 'function' ? effect(index, clone(scenario.metrics)) : Array.isArray(effect) ? effect[index] : effect;
          return { scenarioId: scenario.scenarioId, metrics: { ...scenario.metrics, ...(patch ?? { netRevenue: scenario.metrics.netRevenue + 100 }) } };
        }) })) };
    return configuration.transform ? configuration.transform(batch) : batch;
  } };
}
const selected = decision => decision.candidates.find(item => item.candidate.candidateId === decision.selectedCandidateId);

// Economic and uncertainty adversaries.
test('misleading attributed ROAS cannot beat positive incremental contribution', async () => {
  const decision = await optimizeDecision(input([option('meta'), option('checkout')], { policy: { ...input().policy, maxPortfolioSize: 1 } }),
    twin({ meta: { netRevenue: 1100, paidMediaCost: 400, attributedRevenue: 100000, reportedRoas: 99 }, checkout: { netRevenue: 1100, interventionCost: 20 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:checkout');
  assert.equal(selected(decision).metrics.contributionProfit.incremental.mean, 80);
  assert.equal(decision.candidates.find(item => item.candidate.candidateId === 'candidate:meta').metrics.contributionProfit.incremental.mean, -200);
});
test('promotion volume cannot disguise discount and margin destruction', async () => {
  const decision = await optimizeDecision(input(), twin({ a: { netRevenue: 1050, costOfGoods: 500, fulfillmentCost: 80, orders: 35 } }), validGate);
  assert.equal(decision.status, 'HOLD');
});
test('never fills missing cost evidence with zero', async () => {
  const decision = await optimizeDecision(input(), twin({}, { transform(batch) { delete batch.forecasts[0].outcomes[1].metrics.costOfGoods; return batch; } }), validGate);
  assert.equal(decision.status, 'INCOMPLETE'); assert.equal(decision.selectedCandidateId, null);
});
test('all interventions worse than baseline produce a hold', async () => {
  const decision = await optimizeDecision(input(), twin({ a: { netRevenue: 900 } }), validGate);
  assert.equal(decision.status, 'HOLD'); assert.equal(decision.executionPlan.length, 0);
});
test('shared baseline cancels common scenario variation rather than overstating uncertainty', async () => {
  const baselines = [metrics({ netRevenue: 500 }), metrics({ netRevenue: 1000 }), metrics({ netRevenue: 3000 })];
  const decision = await optimizeDecision(input(), twin({ a: (_index, baseline) => ({ netRevenue: baseline.netRevenue + 100 }) }, { baselines }), validGate);
  assert.equal(selected(decision).utility.mean, 100); assert.equal(selected(decision).utility.standardDeviation, 0);
});
test('uncertainty penalty favors stable economics over fragile upside', async () => {
  const request = input([option('fragile'), option('stable')]); request.policy.maxPortfolioSize = 1; request.policy.uncertaintyPenalty = 1;
  const decision = await optimizeDecision(request, twin({ fragile: [{ netRevenue: 1050 }, { netRevenue: 1250 }, { netRevenue: 1550 }], stable: { netRevenue: 1200 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:stable');
});
test('downside-tail penalty is separate from expected upside', async () => {
  const request = input(); request.policy.downsidePenalty = 5;
  const decision = await optimizeDecision(request, twin({ a: [{ netRevenue: 900 }, { netRevenue: 1200 }, { netRevenue: 1500 }] }), validGate);
  assert.equal(decision.status, 'HOLD');
  assert.equal(decision.candidates.find(item => item.candidate.candidateId === 'candidate:a').penalties.downside, 500);
});
test('rare high-value outlier is retained but does not erase risk', async () => {
  const request = input([option('outlier'), option('stable')]); request.policy.maxPortfolioSize = 1; request.policy.uncertaintyPenalty = 0.5;
  const decision = await optimizeDecision(request, twin({ outlier: [{ netRevenue: 1001 }, { netRevenue: 1001 }, { netRevenue: 1001000 }], stable: { netRevenue: 1100 } }, { probabilities: [0.4995, 0.4995, 0.001] }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:stable');
  assert.ok(decision.candidates.find(item => item.candidate.candidateId === 'candidate:outlier').utility.mean > 1000);
});
test('weighted lower-tail mean uses fractional probability mass', () => {
  const result = distribution([0, 10, 100], [0.05, 0.2, 0.75], 0.1);
  assert.equal(result.lowerTailMean, 5); assert.equal(result.mean, 77);
});
test('practically indistinguishable estimates prefer lower commitment, not 17 dollars of fake precision', async () => {
  const request = input([option('a', { resources: [{ resourceId: 'cash', quantity: 50 }] }), option('b')]);
  request.policy.maxPortfolioSize = 1; request.policy.practicalTieUtility = 20;
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 44087 }, b: { netRevenue: 44104 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:a'); assert.equal(decision.tiedCandidateIds.length, 2);
});
test('predictively indistinguishable weak intervention loses tie to status quo', async () => {
  const decision = await optimizeDecision(input(), twin({ a: [{ netRevenue: 990 }, { netRevenue: 1010 }, { netRevenue: 1030 }] }), validGate);
  assert.equal(decision.status, 'HOLD'); assert.ok(decision.tiedCandidateIds.includes('candidate:a'));
});
test('ratios are recomputed from pooled segment totals (Simpson mix)', () => {
  const before = aggregateMetricTotals([{ orders: 9, sessions: 10 }, { orders: 20, sessions: 100 }]);
  const after = aggregateMetricTotals([{ orders: 80, sessions: 100 }, { orders: 1, sessions: 10 }]);
  assert.ok(0.8 < 0.9 && 0.1 < 0.2); // Both within-segment rates fell.
  assert.ok(metricValue(after, 'conversionRate') > metricValue(before, 'conversionRate'));
  assert.equal(metricValue(after, 'conversionRate'), 81 / 110);
});
test('objectives have a controlled vocabulary and reject attributed revenue or ambiguous prose', async () => {
  assert.equal(objectiveFromIntent('reduce inventory').terms[0].direction, 'MINIMIZE');
  assert.throws(() => objectiveFromIntent('maximize ROAS'));
  assert.throws(() => objectiveFromIntent('maximize contribution profit while keeping CAC under $80'));
  const request = input(); request.objective.terms[0].metric = 'attributedRevenue';
  await assert.rejects(optimizeDecision(request, twin(), validGate), /Unsupported objective/);
});
test('explicit multi-objective utility retains original business metrics', async () => {
  const request = input(); request.objective.terms.push({ metric: 'newCustomers', direction: 'MAXIMIZE', weight: 2, scale: 1 });
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 1050, newCustomers: 20 } }), validGate);
  assert.equal(selected(decision).utility.mean, 70); assert.equal(selected(decision).metrics.newCustomers.incremental.mean, 10);
});
test('revenue-growth floor can reject the profit-maximizing intervention', async () => {
  const request = input(); request.metricConstraints.push({ constraintId: 'revenue_floor', metric: 'netRevenue', basis: 'INCREMENTAL', operator: 'AT_LEAST', threshold: 0, enforcement: 'EVERY_SCENARIO' });
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 950, paidMediaCost: 0 } }), validGate);
  assert.equal(decision.status, 'HOLD'); assert.ok(decision.candidates[1].reasons.includes('METRIC_CONSTRAINT:revenue_floor'));
});
test('contradictory hard objectives do not fabricate a feasible decision', async () => {
  const request = input(); request.metricConstraints = [
    { constraintId: 'min', metric: 'netRevenue', basis: 'TOTAL', operator: 'AT_LEAST', threshold: 5000, enforcement: 'EXPECTED' },
    { constraintId: 'max', metric: 'netRevenue', basis: 'TOTAL', operator: 'AT_MOST', threshold: 500, enforcement: 'EXPECTED' }];
  const decision = await optimizeDecision(request, twin(), validGate);
  assert.equal(decision.status, 'NO_FEASIBLE_CANDIDATE'); assert.equal(decision.selectedCandidateId, null);
});
test('undefined CAC denominator is unresolved, not zero acquisition cost', async () => {
  const request = input(); request.metricConstraints.push({ constraintId: 'cac_limit', metric: 'cac', basis: 'TOTAL', operator: 'AT_MOST', threshold: 80, enforcement: 'EVERY_SCENARIO' });
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 1100, newCustomers: 0 } }), validGate);
  assert.equal(decision.status, 'INCOMPLETE');
});

// Shared resources, interactions, time and sequencing.
test('shared budget rejects independently attractive but unaffordable portfolio', async () => {
  const request = input([option('a', { resources: [{ resourceId: 'cash', quantity: 600 }] }), option('b', { resources: [{ resourceId: 'cash', quantity: 600 }] })]);
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 1100 }, b: { netRevenue: 1200 }, 'a+b': { netRevenue: 5000 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:b'); assert.equal(decision.candidates.find(item => item.candidate.candidateId === 'candidate:a+b').status, 'REJECTED');
});
test('joint portfolio forecast, not the sum of singleton estimates, determines allocation', async () => {
  const decision = await optimizeDecision(input([option('a'), option('b')]), twin({ a: { netRevenue: 1100 }, b: { netRevenue: 1100 }, 'a+b': { netRevenue: 1500 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:a+b'); assert.equal(selected(decision).utility.mean, 500);
});
test('cannibalizing portfolio is not credited two independent lifts', async () => {
  const decision = await optimizeDecision(input([option('a'), option('b')]), twin({ a: { netRevenue: 1200 }, b: { netRevenue: 1150 }, 'a+b': { netRevenue: 1050 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:a');
});
test('same budget cannot be simultaneously increased and decreased', async () => {
  const decision = await optimizeDecision(input([option('up', { conflictKeys: ['meta_budget'] }), option('down', { conflictKeys: ['meta_budget'] })]), twin(), validGate);
  assert.match(decision.candidates.find(item => item.candidate.optionIds.length === 2).reasons.join(), /OVERLAPPING_CONTROL/);
});
test('alternative parameters from the same opportunity cannot be stacked', async () => {
  const decision = await optimizeDecision(input([option('ten', { opportunityId: 'opp_meta' }), option('twenty', { opportunityId: 'opp_meta' })]), twin(), validGate);
  assert.match(decision.candidates.find(item => item.candidate.optionIds.length === 2).reasons.join(), /MUTUALLY_EXCLUSIVE/);
});
test('stockout prevents an inventory-consuming promotion', async () => {
  const request = input([option('promo', { resources: [{ resourceId: 'stock', quantity: 10 }] })]);
  request.resources = [{ resourceId: 'stock', kind: 'CONSUMABLE', unit: 'UNITS', capacityByDay: Array(7).fill(0), evidenceRefs: ['evidence_inventory'] }];
  const decision = await optimizeDecision(request, twin({ promo: { netRevenue: 9999 } }), validGate);
  assert.equal(decision.status, 'HOLD'); assert.match(decision.candidates[1].reasons.join(), /RESOURCE_LIMIT/);
});
test('inventory arrival changes feasible execution day without lending future stock to today', async () => {
  const request = input([option('early', { resources: [{ resourceId: 'stock', quantity: 10 }] }), option('later', { startDay: 2, resources: [{ resourceId: 'stock', quantity: 10 }] })]);
  request.resources = [{ resourceId: 'stock', kind: 'CONSUMABLE', unit: 'UNITS', capacityByDay: [0, 0, 10, 10, 10, 10, 10], evidenceRefs: ['evidence_purchase_order'] }];
  const decision = await optimizeDecision(request, twin(), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:later'); assert.equal(decision.executionPlan[0].startsAt, request.context.dayBoundaries[2]);
});
test('renewable staffing can be reused after a task finishes', async () => {
  const request = input([option('a', { startDay: 0, endDay: 2, resources: [{ resourceId: 'staff', quantity: 5 }] }), option('b', { startDay: 2, endDay: 4, resources: [{ resourceId: 'staff', quantity: 5 }] })]);
  request.resources = [{ resourceId: 'staff', kind: 'RENEWABLE', unit: 'HOURS', capacityByDay: Array(7).fill(5), evidenceRefs: ['evidence_staff'] }];
  const decision = await optimizeDecision(request, twin({ 'a+b': { netRevenue: 1400 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:a+b');
});
test('checkout then measurement then scale retains an outcome gate and cannot execute simultaneously', async () => {
  const a = option('fix', { endDay: 1 });
  const b = option('scale', { startDay: 3, dependencies: [{ opportunityId: 'opp_fix', minimumLagDays: 2, outcomeGate: true }] });
  const decision = await optimizeDecision(input([a, b]), twin({ fix: { netRevenue: 1050 }, 'fix+scale': { netRevenue: 1400 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:fix+scale');
  assert.deepEqual(decision.executionPlan[1].outcomeGates, ['opp_fix']); assert.equal(decision.executionState, 'NOT_AUTHORIZED');
  assert.match(decision.candidates.find(item => item.candidate.candidateId === 'candidate:scale').reasons.join(), /DEPENDENCY/);
});
test('cyclic dependencies cannot become a feasible portfolio', async () => {
  const decision = await optimizeDecision(input([option('a', { dependencies: [{ opportunityId: 'opp_b', minimumLagDays: 0, outcomeGate: false }] }), option('b', { dependencies: [{ opportunityId: 'opp_a', minimumLagDays: 0, outcomeGate: false }] })]), twin(), validGate);
  assert.equal(decision.status, 'HOLD');
});
test('reversibility penalty can favor a slightly smaller reversible return', async () => {
  const request = input([option('a', { reversibility: 'NONE' }), option('b')]); request.policy.irreversiblePenalty = 100; request.policy.maxPortfolioSize = 1;
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 1250 }, b: { netRevenue: 1100 } }), validGate);
  assert.equal(decision.selectedCandidateId, 'candidate:b');
});
test('unknown resource capacity is not silently infinite', async () => {
  const request = input(); request.options[0].resources[0].resourceId = 'unbounded';
  await assert.rejects(optimizeDecision(request, twin(), validGate), /Unbounded resource/);
});
test('calendar checks reject a collapsed/non-daily horizon and accept Toronto DST', async () => {
  const invalid = input(); invalid.context.dayBoundaries[1] = '2026-10-03T01:00:00Z';
  await assert.rejects(optimizeDecision(invalid, twin(), validGate), /midnight/);
  const request = input(); request.context.timeZone = 'America/Toronto'; request.context.asOf = '2026-10-31T04:00:00Z';
  request.context.dayBoundaries = ['2026-10-31T04:00:00Z', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', '2026-11-03T05:00:00Z', '2026-11-04T05:00:00Z', '2026-11-05T05:00:00Z', '2026-11-06T05:00:00Z', '2026-11-07T05:00:00Z'];
  assert.equal((await optimizeDecision(request, twin(), validGate)).status, 'SELECTED');
});

// Failure isolation, bound reporting and canonical invariants.
for (const field of ['merchantId', 'snapshotId', 'currency', 'moneyUnit', 'timeZone', 'asOf', 'dayBoundaries']) {
  test('forecast context cannot substitute ' + field, async () => {
    const decision = await optimizeDecision(input(), twin({}, { transform(batch) { batch.context[field] = field === 'dayBoundaries' ? batch.context.dayBoundaries.slice(0, 2) : 'changed'; return batch; } }), validGate);
    assert.equal(decision.status, 'INCOMPLETE'); assert.equal(decision.selectedCandidateId, null);
  });
}
test('missing one otherwise-feasible forecast withholds the entire selection', async () => {
  const decision = await optimizeDecision(input([option('a'), option('b')]), twin({}, { transform(batch) { batch.forecasts.pop(); return batch; } }), validGate);
  assert.equal(decision.status, 'INCOMPLETE'); assert.equal(decision.selectedCandidateId, null);
});
test('duplicate, missing or unpaired scenarios are rejected', async () => {
  for (const corrupt of [batch => batch.forecasts[0].outcomes.pop(), batch => batch.baseline[1].scenarioId = batch.baseline[0].scenarioId, batch => batch.forecasts[0].outcomes[0].scenarioId = 'not_paired']) {
    const decision = await optimizeDecision(input(), twin({}, { transform(batch) { corrupt(batch); return batch; } }), validGate);
    assert.equal(decision.status, 'INCOMPLETE');
  }
});
test('candidate and scenario ordering cannot change the result', async () => {
  const a = input([option('b'), option('a')]); const b = clone(a); b.options.reverse();
  const effects = { a: { netRevenue: 1200 }, b: { netRevenue: 1100 }, 'a+b': { netRevenue: 1050 } };
  const first = await optimizeDecision(a, twin(effects), validGate);
  const second = await optimizeDecision(b, twin(effects, { transform(batch) { batch.forecasts.reverse(); for (const forecast of batch.forecasts) forecast.outcomes.reverse(); return batch; } }), validGate);
  assert.equal(first.selectedCandidateId, second.selectedCandidateId); assert.deepEqual(first.candidates, second.candidates);
});
test('unknown canonical readiness does not look like a definitely bad alternative', async () => {
  const decision = await optimizeDecision(input(), twin(), { assess() { return { status: 'UNKNOWN', reasons: ['Missing eligibility evidence'] }; } });
  assert.equal(decision.status, 'INCOMPLETE'); assert.equal(decision.selectedCandidateId, null);
});
test('explicit canonical gate is mandatory and errors fail closed', async () => {
  await assert.rejects(optimizeDecision(input(), twin(), undefined), /gate/);
  const decision = await optimizeDecision(input(), twin(), { assess() { throw new Error('source unavailable'); } });
  assert.equal(decision.status, 'INCOMPLETE');
});
test('one joint Twin request is immutable and uses the same baseline for all candidates', async () => {
  let calls = 0; const request = input(); const before = clone(request);
  const decision = await optimizeDecision(request, twin({}, { onRequest(value) { calls++; assert.ok(Object.isFrozen(value.context)); assert.ok(Object.isFrozen(value.options[0])); assert.throws(() => value.context.currency = 'USD'); } }), validGate);
  assert.equal(calls, 1); assert.deepEqual(request, before); assert.ok(Object.isFrozen(decision));
});
test('source snapshot mismatch and duplicate action identities are invalid input', async () => {
  const first = input(); first.options[0].snapshotId = 'other'; await assert.rejects(optimizeDecision(first, twin(), validGate), /snapshot/);
  const second = input([option('a'), option('b', { actionId: 'action_a' })]); await assert.rejects(optimizeDecision(second, twin(), validGate), /Duplicate/);
});
test('hidden evaluator truth, cyclic inputs, NaN and accessors cannot enter the core', async () => {
  const truth = input(); truth.options[0].parameters.oracleAnswer = 42; await assert.rejects(optimizeDecision(truth, twin(), validGate), /evaluator/);
  const cyclic = input(); cyclic.options[0].parameters.loop = cyclic; await assert.rejects(optimizeDecision(cyclic, twin(), validGate), /Cyclic/);
  const nan = input(); nan.options[0].resources[0].quantity = NaN; await assert.rejects(optimizeDecision(nan, twin(), validGate), /finite/);
  let invoked = false; const getter = input(); Object.defineProperty(getter.options[0], 'hidden', { get() { invoked = true; return 1; } });
  await assert.rejects(optimizeDecision(getter, twin(), validGate), /accessors/); assert.equal(invoked, false);
});
test('uncalibrated forecasts require explicit exploratory opt-in', async () => {
  const gateway = twin({}, { transform(batch) { batch.calibrationEvidenceRefs = []; return batch; } });
  assert.equal((await optimizeDecision(input(), gateway, validGate)).status, 'INCOMPLETE');
  const request = input(); request.policy.requireCalibration = false;
  assert.equal((await optimizeDecision(request, gateway, validGate)).status, 'SELECTED');
});
test('bounded search reports truncation and never claims global optimality', async () => {
  const request = input([option('a'), option('b'), option('c')]); request.policy.maxCandidates = 3;
  const decision = await optimizeDecision(request, twin(), validGate);
  assert.equal(decision.search.examined, 3); assert.equal(decision.search.truncated, true); assert.equal(decision.search.scope, 'BEST_EVALUATED_ONLY');
  request.policy.maxPortfolioSize = 1; request.policy.maxCandidates = 4;
  assert.equal((await optimizeDecision(request, twin(), validGate)).search.truncated, false);
});
test('finite parameter/timing grid does not mutate axes or generate unbounded alternatives', () => {
  const axes = { increasePercent: [10, 20, 30], startDay: [0, 2] }; const before = clone(axes);
  const grid = boundedParameterGrid(axes, 4); assert.equal(grid.points.length, 4); assert.equal(grid.truncated, true); assert.deepEqual(axes, before);
  assert.equal(boundedParameterGrid(axes, 6).truncated, false); assert.throws(() => boundedParameterGrid({ x: [1, 1] }, 3));
});
test('opportunity cost is a diagnostic difference and is not double charged', async () => {
  const request = input([option('a'), option('b')]); request.policy.maxPortfolioSize = 1;
  const decision = await optimizeDecision(request, twin({ a: { netRevenue: 1200 }, b: { netRevenue: 1100 } }), validGate);
  const b = decision.candidates.find(item => item.candidate.candidateId === 'candidate:b');
  assert.equal(b.score, 100); assert.equal(b.foregoneUtilityVersusBestEvaluated, 100);
});

// Measurement, learning and value of information.
const rule = { ruleId: 'cac_stop', metric: 'marginalCac', operator: 'ABOVE', threshold: 95, consecutiveCompleteDays: 3, response: 'STOP' };
const measurement = day => ({ day, complete: true, metrics: metrics({ paidMediaCost: 300, newCustomers: 11 }), counterfactual: metrics(), causalEvidenceRefs: ['evidence_test'] });
test('stop scaling only after three consecutive complete days of independently estimated marginal CAC breach', () => {
  assert.equal(assessStopRule(rule, [measurement(0), measurement(1), measurement(2)], 2).status, 'TRIGGERED');
  assert.equal(assessStopRule(rule, [measurement(0), measurement(2)], 2).status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(assessStopRule(rule, [measurement(0), measurement(1), { ...measurement(2), complete: false }], 2).status, 'INSUFFICIENT_EVIDENCE');
});
test('attributed orders or yesterday totals cannot silently supply causal marginal CAC', () => {
  const values = [measurement(0), measurement(1), measurement(2)]; delete values[2].causalEvidenceRefs;
  assert.equal(assessStopRule(rule, values, 2).status, 'INSUFFICIENT_EVIDENCE');
});
test('positive incremental spend with no incremental customers breaches a marginal CAC guardrail', () => {
  const values = [measurement(0), measurement(1), measurement(2)].map(value => ({ ...value, metrics: metrics({ paidMediaCost: 300, newCustomers: 10 }) }));
  assert.equal(assessStopRule(rule, values, 2).status, 'TRIGGERED');
});
test('irreversible action cannot promise automatic rollback', async () => {
  const request = input([option('a', { reversibility: 'NONE', stopRules: [{ ...rule, response: 'ROLLBACK' }] })]);
  await assert.rejects(optimizeDecision(request, twin(), validGate), /reversibility/);
});
function observation(decision, patch = {}) {
  return { decisionId: decision.decisionId, merchantId: 'merchant_demo', snapshotId: 'snapshot_one', currency: 'CAD',
    dayBoundaries: decision.input.context.dayBoundaries, recordedAt: '2026-10-11T00:00:00Z', complete: true,
    method: 'OBSERVATIONAL', evidenceRefs: ['evidence_observed'], metrics: metrics({ netRevenue: 1120 }), ...patch };
}
test('observational forecast errors are not automatically learned as causal treatment effects', async () => {
  const decision = await optimizeDecision(input(), twin(), validGate);
  const feedback = buildLearningFeedback(decision, observation(decision));
  assert.equal(feedback.eligibleForCausalCalibration, false);
  const contribution = feedback.errors.find(item => item.metric === 'contributionProfit'); assert.equal(contribution.totalError, 20); assert.equal(contribution.incrementalError, undefined);
});
test('causal feedback compares predicted and independently observed incremental economics', async () => {
  const decision = await optimizeDecision(input(), twin(), validGate);
  const observed = observation(decision, { method: 'RANDOMIZED_EXPERIMENT', counterfactual: metrics() });
  const feedback = buildLearningFeedback(decision, observed);
  assert.equal(feedback.eligibleForCausalCalibration, true); assert.equal(feedback.errors.find(item => item.metric === 'contributionProfit').incrementalError, 20);
  let called = false;
  const receipt = await submitLearningFeedback(decision, observed, { record(value) { called = true; assert.ok(Object.isFrozen(value)); return 'receipt_one'; } });
  assert.equal(called, true); assert.equal(receipt, 'receipt_one');
});
test('immature, cross-merchant and unsupported causal outcomes cannot feed learning', async () => {
  const decision = await optimizeDecision(input(), twin(), validGate);
  assert.throws(() => buildLearningFeedback(decision, observation(decision, { complete: false })), /Immature/);
  assert.throws(() => buildLearningFeedback(decision, observation(decision, { merchantId: 'other' })), /mismatch/);
  assert.throws(() => buildLearningFeedback(decision, observation(decision, { method: 'CAUSAL_ESTIMATE' })), /counterfactual/);
});
test('finite-belief information value respects the perfect-information upper bound and study cost', () => {
  const study = { evidenceRefs: ['evidence_study'], stateProbabilities: [0.5, 0.5], signalLikelihoodByState: [[0.8, 0.2], [0.2, 0.8]], downstreamUtilityByActionAndState: [[100, 0], [0, 100]], studyCostInUtilityUnits: 10 };
  const value = estimateInformationValue(study); assert.equal(value.expectedSampleInformationValue, 30); assert.equal(value.perfectInformationUpperBound, 50); assert.equal(value.netInformationValue, 20);
  study.signalLikelihoodByState = [[0.5, 0.5], [0.5, 0.5]];
  assert.equal(estimateInformationValue(study).expectedSampleInformationValue, 0);
});
test('1000 seeded allocations preserve feasibility, accounting and deterministic selection', async () => {
  let state = 94812;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let iteration = 0; iteration < 1000; iteration++) {
    const options = ['a', 'b', 'c'].map(name => option(name, { resources: [{ resourceId: 'cash', quantity: Math.floor(random() * 900) + 1 }] }));
    const request = input(options); const effects = {};
    for (const key of ['a', 'b', 'c', 'a+b', 'a+c', 'b+c', 'a+b+c']) effects[key] = { netRevenue: 500 + Math.floor(random() * 1500), paidMediaCost: Math.floor(random() * 500) };
    const decision = await optimizeDecision(request, twin(effects), validGate);
    assert.notEqual(decision.status, 'INCOMPLETE');
    const winner = selected(decision); assert.equal(winner.status, 'FEASIBLE');
    const used = options.filter(value => winner.candidate.optionIds.includes(value.optionId)).reduce((sum, value) => sum + value.resources[0].quantity, 0);
    assert.ok(used <= 1000); assert.equal(winner.score, winner.metrics.contributionProfit.incremental.mean);
    if (iteration < 20) assert.equal((await optimizeDecision(request, twin(effects), validGate)).selectedCandidateId, decision.selectedCandidateId);
  }
});
