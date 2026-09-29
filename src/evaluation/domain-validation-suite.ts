import { createMediationFixture } from "../cross_channel/adversarial.js";
import { createMarginDestructionTrapFixture } from "../pricing_promotions/adversarial.js";
import { hydratePricingPromotionScenario } from "../pricing_promotions/evaluator.js";
import { priceResponseTruth } from "../pricing_promotions/response.js";
import { createCheapCustomerTrapFixture } from "../retention_ltv/adversarial.js";
import { repeatPurchaseHazardMultiplier, type RetentionCustomerContext } from "../retention_ltv/runtime.js";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import { generateCustomerPopulation } from "../customer_population/generator.js";
import { EXTERNAL_REALITY_MODEL_VERSION, type ExternalEnvironment } from "../external_reality/index.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import { MEASUREMENT_VERSION, measurePerfectWorld } from "../measurement_corruption/index.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { runMeasuredWorld, type EvaluatorWorldBundle, type MeasurementRunOptions } from "./measured-world.js";
import { auditSimulatorBundle } from "./simulator-audit.js";
import { customerValueFromFixedEpisode } from "./customer-value-ledger.js";
import { sha256 } from "./replay-manifest.js";
import type { ExecutableValidationCase } from "./validation-evidence.js";
import type { Phase1Requirement } from "./phase1-acceptance.js";

export const DOMAIN_VALIDATION_VERSION = "phase1-kernel-mechanism-checks/1.0.0" as const;
/** Public regression seeds, fixed by this version. Not sealed holdouts. */
export const DOMAIN_VALIDATION_SEEDS = Object.freeze({
  crossChannel: Object.freeze([93060, 193060]), pricing: Object.freeze([210201, 1210201]),
  retention: Object.freeze([211201, 1211201]), external: Object.freeze([141, 1141]),
});
const START = "2026-01-01T00:00:00.000Z", END = "2026-05-01T00:00:00.000Z";
const CUTOFF = "2026-02-01T00:00:00.000Z", EFFECTIVE = "2026-02-01T00:00:00.001Z";
const measurement = (end: string): MeasurementRunOptions => ({ scope: "explicit_simulated_agents", platformSpend: [], asOf: end,
  corruption: { version: MEASUREMENT_VERSION, seed: 661101, identitySalt: "private-domain-regression-v1",
    missingUtmRate: 0.25, blockedPixelRate: 0.1, cookieLossRate: 0.15, delayedEventRate: 0.2, maxEventDelayMs: 86400000 } });
export interface DomainWorldPair { readonly control: SimulateWorldRequest; readonly treatment: SimulateWorldRequest }
const summary = (b: EvaluatorWorldBundle) => {
  const s = b.latentTruth.simulation;
  const limit = b.latentTruth.request.config?.maxSessionsPerCustomer ?? 24;
  const sessions = new Map<string, number>();
  for (const event of s.observableEvents) if (event.eventType === "session_start") {
    sessions.set(event.anonymousSubjectId, (sessions.get(event.anonymousSubjectId) ?? 0) + 1);
  }
  return { sessionLimitPerCustomer: limit, customersReachingSessionLimit: [...sessions.values()].filter(n => n >= limit).length, orders: s.purchases.length, repeatOrders: s.purchases.filter(p => p.repeatPurchase).length,
    netMerchandiseSalesMinor: s.purchases.reduce((n, p) => n + p.netRevenueMinor, 0),
    brandedSearches: s.observableEvents.filter(e => e.eventType === "search" && e.searchIntent === "branded").length,
    sessions: s.observableEvents.filter(e => e.eventType === "session_start").length };
};
const check = (id: string, passed: boolean) => ({ id, passed });
function execute(pair: DomainWorldPair) {
  const before = sha256(pair);
  const control = runMeasuredWorld(pair.control, measurement(pair.control.endTime));
  const treatment = runMeasuredWorld(pair.treatment, measurement(pair.treatment.endTime));
  const replay = runMeasuredWorld(pair.treatment, measurement(pair.treatment.endTime));
  const audits = [auditSimulatorBundle(control), auditSimulatorBundle(treatment)];
  const checks = [
    check("fixed_population_seed_and_episode", sha256(pair.control.latentPopulation) === sha256(pair.treatment.latentPopulation) &&
      pair.control.simulationSeed === pair.treatment.simulationSeed && pair.control.startTime === pair.treatment.startTime && pair.control.endTime === pair.treatment.endTime),
    check("nonvacuous_orders_in_both_branches", control.latentTruth.simulation.purchases.length > 0 && treatment.latentTruth.simulation.purchases.length > 0),
    check("independent_accounting_and_observation_audits", audits.every(a => a.passed)),
    check("three_level_replay_identical", sha256(treatment) === sha256(replay)),
    check("caller_inputs_unchanged", before === sha256(pair)),
  ];
  return { control, treatment, checks, evidence: { control: summary(control), treatment: summary(treatment),
    controlRequestHash: sha256(pair.control), treatmentRequestHash: sha256(pair.treatment),
    controlWorldHash: sha256(control), treatmentWorldHash: sha256(treatment),
    auditChecks: audits.map(a => a.checks),
    measurement: measurement(pair.control.endTime),
    economicsScope: "explicit_orders_legacy_booked_not_total_paid_contribution",
    inventoryCoverage: "not_enabled_not_claimed_by_these_cases" } };
}
function pastChecks(control: EvaluatorWorldBundle, treatment: EvaluatorWorldBundle) {
  const corruption = measurement(control.latentTruth.request.endTime).corruption;
  const observation = (b: EvaluatorWorldBundle) => measurePerfectWorld(b.perfectObservableTruth, corruption, CUTOFF).observation;
  const events = (b: EvaluatorWorldBundle) => b.perfectObservableTruth.events.filter(e => Date.parse(e.occurredAt) <= Date.parse(CUTOFF));
  return [check("future_change_preserves_perfect_past", sha256(events(control)) === sha256(events(treatment))),
    check("future_change_preserves_corrupted_past", sha256(observation(control)) === sha256(observation(treatment)))];
}
function result(checks: readonly { readonly id: string; readonly passed: boolean }[], measurements: Record<string, unknown>) {
  return { passed: checks.length > 0 && checks.every(c => c.passed), measurements: { ...measurements, checks,
    qualification: "kernel_mechanism_regression_not_canonical_decision_scenario", externalCalibration: false } };
}

/** Intervention on one mediator coefficient, not removal of the entire source channel. */
export function buildCrossChannelValidationPair(seed: number): DomainWorldPair {
  const fixture = createMediationFixture();
  const active = fixture.merchantWorld;
  const disabled = { ...structuredClone(active), manifest: { ...structuredClone(active.manifest),
    channelInteractions: active.manifest.channelInteractions.map(i => i.id === "step6_meta_branded_search"
      ? { ...i, effect: { ...i.effect, value: 0 } } : structuredClone(i)) } };
  validateGroundTruthManifest(disabled.manifest);
  const shared = { latentPopulation: fixture.latentPopulation, simulationSeed: seed, startTime: START, endTime: END,
    config: { maxEvents: 300000, maxSessionsPerCustomer: 22 } };
  return { control: { ...shared, merchantWorld: disabled }, treatment: { ...shared, merchantWorld: active } };
}
export function runCrossChannelValidation(seed: number) {
  const pair = buildCrossChannelValidationPair(seed), run = execute(pair), id = "step6_meta_branded_search";
  const effects = (b: EvaluatorWorldBundle) => b.latentTruth.simulation.godMode.interactionEffects.filter(e => e.mechanismId === id && e.appliedEffect !== 0);
  const active = effects(run.treatment), inactive = effects(run.control);
  return result([...run.checks,
    check("mediator_is_applied_only_in_active_branch", active.length > 0 && inactive.length === 0),
    check("declared_mediation_lag_retained", active.every(e => e.lagMs === 86400000)),
    check("mediator_changes_downstream_branded_search", summary(run.treatment).brandedSearches > summary(run.control).brandedSearches),
  ], { ...run.evidence, seed, mechanismId: id, activeApplications: active.length, controlApplications: inactive.length,
    effectScope: "one_meta_to_google_mediator_not_a_paid_channel_profit_estimate" });
}

export function buildPricingValidationPair(seed: number): DomainWorldPair {
  const fixture = createMarginDestructionTrapFixture().evaluation;
  const scenario = { ...hydratePricingPromotionScenario(fixture), promotions: [] };
  const cheaper = { ...scenario, priceStates: scenario.priceStates.flatMap(p => [
    { ...p, effectiveEnd: EFFECTIVE }, { ...p, currentSellingPriceMinor: Math.max(1, Math.round(p.regularPriceMinor * 0.9)),
      effectivePriceMinor: Math.max(1, Math.round(p.regularPriceMinor * 0.9)), discountAmountMinor: 0, discountPercentage: 0,
      effectiveStart: EFFECTIVE },
  ]) };
  const shared: SimulateWorldRequest = { merchantWorld: fixture.merchantWorld, latentPopulation: fixture.latentPopulation,
    simulationSeed: seed, startTime: START, endTime: END, config: { maxEvents: 300000, maxSessionsPerCustomer: 22 },
    interventions: [{ variable: "promotion.discount_active", operation: "set", value: { kind: "boolean", value: false } }] };
  return { control: { ...shared, commercePolicy: { pricingPromotionScenario: scenario } },
    treatment: { ...shared, commercePolicy: { pricingPromotionScenario: cheaper } } };
}
export function runPricingValidation(seed: number) {
  const pair = buildPricingValidationPair(seed), run = execute(pair);
  const scenario = pair.control.commercePolicy!.pricingPromotionScenario!;
  const target = createMarginDestructionTrapFixture().productAId;
  const state = scenario.priceStates.find(p => p.productId === target)!;
  const structural = pair.control.latentPopulation.customers.map(customer => {
    const evaluate = (ratio: number) => priceResponseTruth(pair.control.merchantWorld, scenario, customer, target,
      state.regularPriceMinor, Math.round(state.regularPriceMinor * ratio), Date.parse(EFFECTIVE)).combinedDemandMultiplier;
    return { baseline: evaluate(1), cheaper: evaluate(0.9), moreExpensive: evaluate(1.1) };
  });
  const prices = new Map(scenario.priceStates.map(p => [p.productId, Math.max(1, Math.round(p.regularPriceMinor * 0.9))]));
  const futureLines = run.treatment.latentTruth.simulation.purchases.filter(p => Date.parse(p.occurredAt) >= Date.parse(EFFECTIVE)).flatMap(p => p.lines);
  return result([...run.checks, ...pastChecks(run.control, run.treatment),
    check("structural_price_response_has_correct_direction", structural.length > 0 && structural.every(r => r.cheaper > r.baseline && r.moreExpensive < r.baseline)),
    check("future_orders_use_effective_prices", futureLines.length > 0 && futureLines.every(l => l.unitPriceMinor === prices.get(l.productId))),
  ], { ...run.evidence, seed, decisionAt: CUTOFF, effectiveAt: EFFECTIVE, customerResponses: structural,
    actualFutureLines: futureLines.length, targetProductId: target,
    interpretation: "structural_direction_and_executed_price_application_not_exact_sales_uplift" });
}

export function buildRetentionValidationPair(seed: number): DomainWorldPair {
  const fixture = createCheapCustomerTrapFixture().evaluation;
  const retained = fixture.retentionScenario!;
  const shared: SimulateWorldRequest = { merchantWorld: fixture.merchantWorld,
    latentPopulation: generateCustomerPopulation({ merchantWorld: fixture.merchantWorld, populationSeed: 211101,
      populationConfig: { maxExplicitAgents: 32, complexity: "complex" } }),
    simulationSeed: seed, startTime: START, endTime: "2027-01-01T00:00:00.000Z", interventions: fixture.interventions ?? [],
    config: { ...fixture.simulationConfig, maxSessionsPerCustomer: 32, maxEvents: 180000 } };
  return { control: { ...shared, commercePolicy: { retentionScenario: { ...retained, merchantRepeatHazardMultiplier: 0.1 } } },
    treatment: { ...shared, commercePolicy: { retentionScenario: retained } } };
}
export function runRetentionValidation(seed: number) {
  const pair = buildRetentionValidationPair(seed), run = execute(pair), asOf = "2026-04-01T00:00:00.000Z";
  const values = customerValueFromFixedEpisode(pair.treatment, run.treatment.latentTruth.simulation, asOf);
  const contexts = pair.treatment.latentPopulation.customers.map((source): RetentionCustomerContext => ({
    source, purchaseCount: 1, lifecycle: "active_customer", brandAffinity: source.brandAffinity, need: source.currentPurchaseNeed,
    repeatHazardQualityMultiplier: 1, promotionDependenceShift: 0, trueChurnState: "active",
    ownedProductQuantities: new Map(), categoryFamiliarity: new Map() }));
  const hazards = contexts.map(c => ({ control: repeatPurchaseHazardMultiplier(pair.control.merchantWorld, pair.control.commercePolicy!.retentionScenario!, c),
    treatment: repeatPurchaseHazardMultiplier(pair.treatment.merchantWorld, pair.treatment.commercePolicy!.retentionScenario!, c) }));
  const purchases = run.treatment.latentTruth.simulation.purchases;
  const totalValue = purchases.reduce((n, p) => n + p.contributionProfitMinor + p.allocatedMarketingSpendMinor, 0);
  return result([...run.checks,
    check("repeat_hazard_responds_to_declared_mechanism", hazards.length > 0 && hazards.every(h => h.treatment > h.control)),
    check("repeat_orders_use_normal_commerce_path", purchases.some(p => p.repeatPurchase) && purchases.filter(p => p.repeatPurchase).every(p =>
      run.treatment.latentTruth.simulation.observableEvents.some(e => e.eventType === "purchase" && e.orderId === p.orderId))),
    check("future_value_is_nonvacuous_and_separate", values.realizedAtAsOf.totals.orders > 0 && values.futureRealizedTruthNotForecast.totals.orders > 0),
    check("customer_value_reconciles_single_episode", values.realizedAtAsOf.totals.bookedContributionBeforeAdvertisingMinor +
      values.futureRealizedTruthNotForecast.totals.bookedContributionBeforeAdvertisingMinor === totalValue),
  ], { ...run.evidence, seed, repeatHazards: hazards, customerValue: values,
    interpretation: "realized_365_day_customer_value_not_expected_lifetime_profit_or_causal_clv" });
}

export function buildExternalValidationPair(seed: number): DomainWorldPair {
  const merchantWorld = generateMerchantWorldRecord({ seed: 64101, archetype: "fashion_apparel", scale: "growth", complexity: "adversarial" });
  const latentPopulation = generateCustomerPopulation({ merchantWorld, populationSeed: 74101,
    populationConfig: { maxExplicitAgents: 64, complexity: "adversarial", maxCategoryPreferences: 4, maxProductPreferences: 6 } });
  const environment: ExternalEnvironment = { version: EXTERNAL_REALITY_MODEL_VERSION, environmentId: "phase1-independent-shock", seed: 1441,
    events: [{ id: "demand-shift", domain: "consumer", kind: "consumer_trend", startsAt: EFFECTIVE, endsAt: END,
      effects: [{ target: "demand", logMultiplier: Math.log(2) }, { target: "purchase_propensity", logMultiplier: Math.log(1.2) }],
      observations: [{ kind: "lagged_report", availableAt: "2026-02-08T00:00:00.000Z", signal: "Demand conditions changed" }] }] };
  const shared = { merchantWorld, latentPopulation, simulationSeed: seed, startTime: START, endTime: END,
    config: { maxEvents: 120000, maxSessionsPerCustomer: 22 } };
  return { control: { ...shared, commercePolicy: { externalRealityEnvironment: { ...environment, events: [] } } },
    treatment: { ...shared, commercePolicy: { externalRealityEnvironment: environment } } };
}
export function runExternalValidation(seed: number) {
  const pair = buildExternalValidationPair(seed), run = execute(pair);
  const effects = run.treatment.latentTruth.simulation.godMode.externalReality!.applications;
  const demand = effects.filter(e => e.target === "demand"), propensity = effects.filter(e => e.target === "purchase_propensity");
  return result([...run.checks, ...pastChecks(run.control, run.treatment),
    check("known_demand_multiplier_applied_exactly", demand.length > 0 && demand.every(e => e.multiplier === 2)),
    check("known_propensity_multiplier_applied_exactly", propensity.length > 0 && propensity.every(e => Math.abs(e.multiplier - 1.2) < 1e-12)),
    check("no_early_or_duplicate_external_application", effects.every(e => Date.parse(e.occurredAt) >= Date.parse(EFFECTIVE)) && new Set(effects.map(e => e.applicationId)).size === effects.length),
    check("external_shock_changes_realized_path", sha256(run.control.latentTruth.simulation.purchases) !== sha256(run.treatment.latentTruth.simulation.purchases)),
    check("external_cause_is_not_a_merchant_intervention", sha256(pair.control.interventions ?? []) === sha256(pair.treatment.interventions ?? [])),
  ], { ...run.evidence, seed, decisionAt: CUTOFF, effectiveAt: EFFECTIVE, demandApplications: demand.length, propensityApplications: propensity.length,
    effectLedgerHash: sha256(effects), interpretation: "exact_latent_multiplier_application_not_a_claim_of_double_sales_or_20_percent_revenue_growth" });
}

export function buildDomainValidationCases(): ExecutableValidationCase[] {
  const cases: ExecutableValidationCase[] = [];
  const add = (name: string, seeds: readonly number[], requirements: readonly Phase1Requirement[], run: (seed: number) => ReturnType<typeof result>) => {
    for (const seed of seeds) cases.push({ spec: { caseId: `domain:${name}:${seed}`, implementationVersion: DOMAIN_VALIDATION_VERSION,
      kind: "simulator_invariant", requirements: [...requirements] }, run: () => run(seed) });
  };
  add("cross-channel-mediator", DOMAIN_VALIDATION_SEEDS.crossChannel, ["cross_channel_interactions"], runCrossChannelValidation);
  add("prospective-price", DOMAIN_VALIDATION_SEEDS.pricing, ["price_elasticity"], runPricingValidation);
  add("retention-customer-value", DOMAIN_VALIDATION_SEEDS.retention, ["retention_clv"], runRetentionValidation);
  add("future-external-shock", DOMAIN_VALIDATION_SEEDS.external, ["external_shocks"], runExternalValidation);
  return cases;
}
