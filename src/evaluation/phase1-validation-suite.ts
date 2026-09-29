import { evaluateExactActionSet, exactDecisionRegret } from "./exact-decision-oracle.js";
import { buildTractableCheckoutControl } from "./tractable-checkout-control.js";
import { buildMeasurementScenario } from "./scenario-library.js";
import { evaluateScheduledDecisionSet } from "./scheduled-decision-oracle.js";
import { SCHEDULED_SPEND_VERSION } from "./scheduled-spend.js";
import { evaluateFrozenResponseCurve } from "../ground_truth/response-functions.js";
import { SeededRandom } from "../generation/rng.js";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import { MERCHANT_ARCHETYPES, MARKETING_CHANNELS } from "../generation/config.js";
import { generateCustomerPopulation } from "../customer_population/generator.js";
import { MEASUREMENT_VERSION, measurePerfectWorld } from "../measurement_corruption/index.js";
import { runMeasuredWorld, type EvaluatorWorldBundle } from "./measured-world.js";
import { sha256 } from "./replay-manifest.js";
import { auditSimulatorBundle, compareEmpiricalDistributions } from "./simulator-audit.js";
import { executeValidationPlan, assessArtifactBackedAcceptance, type ExecutableValidationCase, type ValidationPlan, type ValidationCaseSpec } from "./validation-evidence.js";
import type { Phase1Requirement } from "./phase1-acceptance.js";

export const VALIDATION_SUITE_VERSION = "phase1-executed-world-matrix/1.0.0" as const;
const SEGMENTS = ["new_or_prospect", "returning_oriented", "high_value", "discount_sensitive", "brand_loyal", "low_intent_browser"] as const;
/** Public regression seeds, not a sealed benchmark. These are never sent to an Operator. */
export function buildPhase1ValidationSuite() {
  const cache = new Map<number, { first: EvaluatorWorldBundle; replay: EvaluatorWorldBundle }>();
  const executeWorld = (index: number) => {
    const cached = cache.get(index); if (cached) return cached;
    const seed = 381000 + index;
    const merchantWorld = generateMerchantWorldRecord({ seed, archetype: MERCHANT_ARCHETYPES[index]!,
      scale: "small", complexity: "adversarial", catalogProfile: "tiny_curated", currency: "CAD" });
    const latentPopulation = generateCustomerPopulation({ merchantWorld, populationSeed: 481000 + index,
      populationConfig: { maxExplicitAgents: 64, complexity: "adversarial", maxProductPreferences: 6, maxCategoryPreferences: 4 } });
    const request = { merchantWorld, latentPopulation, simulationSeed: 581000 + index,
      startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-02-01T00:00:00.000Z",
      commercePolicy: { executeInventoryLifecycle: true, enableInventoryDynamics: true },
      config: { maxEvents: 180000, maxSessionsPerCustomer: 12 } };
    const options = { corruption: { version: MEASUREMENT_VERSION, seed: 681000 + index,
      identitySalt: `private-regression-matrix-${index}`, missingUtmRate: 0.2, blockedPixelRate: 0.1,
      duplicateEventRate: 0.1, delayedEventRate: 0.2, maxEventDelayMs: 86400000 },
      platformSpend: [], scope: "explicit_simulated_agents" as const, asOf: request.endTime };
    // This matrix audits orders and inventory, not all-spend store contribution.
    const result = { first: runMeasuredWorld(request, options), replay: runMeasuredWorld(request, options) };
    cache.set(index, result); return result;
  };
  const all = () => MERCHANT_ARCHETYPES.map((_, index) => executeWorld(index).first);
  const cases: ExecutableValidationCase[] = [];
  const add = (caseId: string, requirements: readonly Phase1Requirement[], run: ExecutableValidationCase["run"],
    extra: Partial<ValidationCaseSpec> = {}) => cases.push({ spec: { caseId, implementationVersion: VALIDATION_SUITE_VERSION,
      kind: "simulator_invariant", requirements: [...requirements], ...extra }, run });
  MERCHANT_ARCHETYPES.forEach((archetype, index) => {
    add(`matrix:${archetype}:replay`, ["reproducibility", "merchant_archetypes"], () => {
      const { first, replay } = executeWorld(index);
      return { passed: sha256(first) === sha256(replay), measurements: { archetype,
        simulationHash: sha256(first.latentTruth), perfectHash: sha256(first.perfectObservableTruth), observedHash: sha256(first.corruptedObservation),
        request: first.latentTruth.request, explicitAgents: first.latentTruth.request.latentPopulation.explicitAgentCount } };
    }, { coverage: { merchant_archetypes: [archetype] } });
    add(`matrix:${archetype}:accounting`, ["accounting_reconciliation", "product_economics"], () => {
      const audit = auditSimulatorBundle(executeWorld(index).first);
      const checks = audit.checks.filter(c => ["unique_order_identity", "line_and_order_revenue", "per_order_booked_profit", "perfect_server_orders_reconcile"].includes(c.checkId));
      return { passed: audit.checkedOrders > 0 && checks.every(c => c.status === "PASS"), measurements: { ...audit,
        costScope: "per_order_legacy_booked_costs_not_total_scheduled_paid_spend" } };
    });
    add(`matrix:${archetype}:inventory`, ["zero_impossible_inventory", "inventory_effects"], () => {
      const audit = auditSimulatorBundle(executeWorld(index).first);
      const checks = audit.checks.filter(c => ["inventory_never_negative", "inventory_conservation", "sales_have_stock"].includes(c.checkId));
      return { passed: checks.every(c => c.status === "PASS"), measurements: { checks } };
    });
    add(`matrix:${archetype}:truth-boundary`, ["causal_truth_retained", "zero_future_leakage", "measurement_corruption"], () => {
      const bundle = executeWorld(index).first, before = sha256(bundle), audit = auditSimulatorBundle(bundle);
      const checks = audit.checks.filter(c => ["causal_graph_and_parameters_retained", "customers_exist_before_purchases", "observed_schema_and_time"].includes(c.checkId));
      const asOf = "2026-01-16T00:00:00.000Z";
      const measured = measurePerfectWorld(bundle.perfectObservableTruth, { version: MEASUREMENT_VERSION,
        seed: 99901, identitySalt: "private-prefix-control", blockedPixelRate: 1, consentExclusionRate: 1 }, asOf);
      const noFuture = [...measured.observation.events, ...measured.observation.orders].every(e => Date.parse(e.occurredAt) <= Date.parse(asOf) && Date.parse(e.receivedAt) <= Date.parse(asOf));
      const availableOrders = bundle.perfectObservableTruth.events.filter(e => e.origin === "server" && e.eventType === "purchase" && Date.parse(e.occurredAt) <= Date.parse(asOf));
      return { passed: checks.every(c => c.status === "PASS") && noFuture && before === sha256(bundle) && measured.observation.orders.length === availableOrders.length,
        measurements: { checks, asOf, noFuture, perfectOrderCount: availableOrders.length, observedOrderCount: measured.observation.orders.length, latentUnchanged: before === sha256(bundle) } };
    });
  });
  for (const channel of MARKETING_CHANNELS) add(`matrix:channel:${channel}`, ["core_channels"], () => {
    const eventCount = all().reduce((sum, b) => sum + b.perfectObservableTruth.events.filter(e => e.source === channel).length, 0);
    return { passed: eventCount > 0, measurements: { channel, eventCount } };
  }, { coverage: { core_channels: [channel] } });
  for (const segment of SEGMENTS) add(`matrix:segment:${segment}`, ["customer_segments"], () => {
    const agents = all().reduce((sum, b) => sum + b.latentTruth.request.latentPopulation.customers.filter(c => c.derivedSegments.includes(segment)).length, 0);
    return { passed: agents > 0, measurements: { segment, explicitAgents: agents, overlappingSegments: true } };
  }, { coverage: { customer_segments: [segment] } });
  add("matrix:independent-seed-distributions", ["automated_validation"], () => {
    const sample = (offset: number) => Array.from({ length: 128 }, (_, i) => generateMerchantWorldRecord({ seed: offset + i,
      archetype: new SeededRandom(`validation-archetype:${offset + i}`).pick(MERCHANT_ARCHETYPES), scale: "growth", complexity: "normal", catalogProfile: "tiny_curated" }).summary);
    const left = sample(781000), right = sample(881000);
    const aov = compareEmpiricalDistributions(left.map(s => s.expectedAovMinor), right.map(s => s.expectedAovMinor));
    const repeat = compareEmpiricalDistributions(left.map(s => s.repeatProbability), right.map(s => s.repeatProbability));
    const plausibleConstraints = [...left, ...right].every(s => s.expectedAovMinor > 0 && s.catalogMinPriceMinor > 0 &&
      s.catalogMaxPriceMinor >= s.catalogMinPriceMinor && s.expectedReturnRate >= 0 && s.expectedReturnRate <= 1 && s.expectedCogsRate > 0 && s.expectedCogsRate < 1);
    const heterogeneous = new Set([...left, ...right].map(s => Math.round(s.expectedAovMinor / 1000))).size > 20;
    return { passed: aov.compatibleAtRegisteredThreshold && repeat.compatibleAtRegisteredThreshold && plausibleConstraints && heterogeneous,
      measurements: { aov, repeat, plausibleConstraints, heterogeneous, externalCalibration: false,
        populationUnit: "independent_generated_merchants_from_same_uniform_archetype_mixture", leftSeeds: [781000, 781127], rightSeeds: [881000, 881127] } };
  }, { kind: "distribution" });
  add("matrix:exact-37-action-control", ["decision_oracle", "automated_validation"], async () => {
    const result = await evaluateExactActionSet(buildTractableCheckoutControl());
    const regret = exactDecisionRegret(result, "a0");
    return { passed: result.evaluations === 9472 && result.ranking.length === 37 && regret.regretMinor >= 0 &&
      result.ranking.find(r => r.actionId === "meta-10")?.expectedDeltaVersusBaselineMinor === -100000,
      measurements: { oracleHash: result.resultHash, evaluatedActions: result.ranking.length, outcomes: 256, regret, reference: result.reference } };
  }, { kind: "analytic_control" });
  add("matrix:prospective-zero-effect-and-actual-spend", ["decision_oracle", "counterfactual_interventions", "accounting_reconciliation", "zero_future_leakage"], async () => {
    const fixture = buildMeasurementScenario("adv-013", 1410), startTime = "2026-01-01T00:00:00.000Z", endTime = "2026-02-01T00:00:00.000Z";
    const initial = { ...fixture.request, startTime, endTime,
      latentPopulation: generateCustomerPopulation({ merchantWorld: fixture.request.merchantWorld, populationSeed: 74111,
        populationConfig: { maxExplicitAgents: 48, complexity: "adversarial", maxProductPreferences: 6, maxCategoryPreferences: 4 } }),
      interventions: fixture.request.interventions!.filter(i => !i.variable.startsWith("marketing.")) };
    const result = await evaluateScheduledDecisionSet({ initial,
      decisionAt: "2026-01-02T00:00:00.000Z", measurement: { scope: "explicit_simulated_agents", corruption: fixture.controlCorruption },
      spendPlan: { version: SCHEDULED_SPEND_VERSION, periodStart: startTime, periodEnd: endTime, referencePeriodMs: 86400000,
        scope: "explicit_simulated_agents", execution: "fully_spent_time_prorated_allocation",
        initialAllocation: { meta: 10000, google_search: 20000, google_shopping: 0, pinterest: 0, affiliate: 0 }, changes: [] },
      candidates: [{ actionId: "a0", action: { actionId: "a0", interventions: [], actionCostMinor: 0 } },
        { actionId: "a1", action: { actionId: "a1", interventions: [], actionCostMinor: 100,
          budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: 100000 }] } }],
      baselineActionId: "a0", actionSetVersion: "zero-effect-budget-control/1", universeComplete: true, seeds: [1410], maximumEvaluations: 3 });
    const base = result.branches.find(b => b.actionId === "a0")!, changed = result.branches.find(b => b.actionId === "a1")!;
    const expectedExtraSpend = 30 * 100000 - 1;
    return { passed: base.economics.netSalesMinor > 0 && base.purchaseSignature === changed.purchaseSignature &&
      base.observationHash === changed.observationHash && changed.economics.paidSpendMinor - base.economics.paidSpendMinor === expectedExtraSpend &&
      result.oracle.ranking.find(r => r.actionId === "a1")?.meanDeltaVersusBaselineMinor === -expectedExtraSpend - 100,
      measurements: { resultHash: sha256(result), futureSalesMinor: base.economics.netSalesMinor, expectedExtraSpend,
        scope: result.oracle.scope, method: result.oracle.method, ranking: result.oracle.ranking } };
  });
  add("matrix:declared-saturating-response-curves", ["diminishing_returns"], () => {
    const curves = all().flatMap(b => b.latentTruth.request.merchantWorld.manifest.responseCurves).filter(c => c.kind === "hill");
    const checks = curves.map(c => {
      if (c.kind !== "hill") return false;
      const h = Number(c.halfSaturationSpend), f = (x: number) => evaluateFrozenResponseCurve(c, x);
      return f(h) > 0 && f(2 * h) - f(h) > f(3 * h) - f(2 * h);
    });
    return { passed: checks.length > 0 && checks.every(Boolean), measurements: { evaluatedCurves: checks.length,
      failures: checks.filter(c => !c).length, range: "at_and_above_half_saturation", curveIds: curves.map(c => c.id) } };
  });
  const plan: ValidationPlan = { version: "simulator-validation-plan/1.0.0", suiteId: VALIDATION_SUITE_VERSION, cases: cases.map(c => c.spec) };
  return { plan, cases };
}
export async function runPhase1ValidationMatrix(codeRevision: string, runId: string) {
  const suite = buildPhase1ValidationSuite();
  const artifact = await executeValidationPlan({ codeRevision, runId, plan: suite.plan, executors: suite.cases });
  return { plan: suite.plan, artifact, acceptance: assessArtifactBackedAcceptance(codeRevision, [{ plan: suite.plan, artifact }]) };
}
