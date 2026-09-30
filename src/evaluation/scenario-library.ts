import { generateMerchantWorldRecord } from "../generation/generator.js";
import { MARKETING_CHANNELS } from "../generation/config.js";
import { generateCustomerPopulation } from "../customer_population/generator.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import { measurePerfectWorld, MEASUREMENT_VERSION, type CorruptionConfigInput } from "../measurement_corruption/index.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import type { CorruptedObservation } from "../observation/corrupted-world.js";
import { runMeasuredWorld, operatorPayload, type MeasurementRunOptions, type EvaluatorWorldBundle } from "./measured-world.js";
import { sha256 } from "./replay-manifest.js";
import { SCENARIO_SPEND_VERSION, requestWithScenarioSpend, measurementSpendLedger,
  scenarioBookedEconomics, type ScenarioSpendPlan, type ScenarioAllocation } from "./scenario-spend.js";
import { evaluateFiniteActionSet, type FiniteOracleResult } from "./finite-decision-oracle.js";

export const SCENARIO_LIBRARY_VERSION = "measurement-scenario-library/0.1.0" as const;
export const MEASUREMENT_SCENARIO_IDS = ["adv-008", "adv-009", "adv-010", "adv-012", "adv-013", "adv-014", "adv-015", "adv-016", "identity-001"] as const;
export type MeasurementScenarioId = typeof MEASUREMENT_SCENARIO_IDS[number];
/** Public development/validation seeds, NOT a sealed benchmark holdout. Never filter failed seeds. */
export const SCENARIO_SEED_SPLIT = Object.freeze({ development: Object.freeze([1410, 1411]), validation: Object.freeze([2410, 2411]) });
const START = "2026-01-01T00:00:00.000Z", END = "2026-04-01T00:00:00.000Z";
const BASE_ALLOCATION: ScenarioAllocation = { meta: 45000, google_search: 60000, google_shopping: 20000, pinterest: 0, affiliate: 0 };
const modifications: Record<MeasurementScenarioId, Partial<CorruptionConfigInput>> = {
  "adv-008": { missingUtmRate: 1, directFallbackRate: 1 },
  "adv-009": { crossDeviceIdentityRate: 1 },
  "adv-010": { cookieLossRate: 1 },
  "adv-012": { blockedPixelRate: 1 },
  "adv-013": { duplicateEventRate: 1 },
  "adv-014": { platformReportingDelayMs: 7 * 86400000 },
  "adv-015": { metaOverAttributionRate: 1, googleOverAttributionRate: 1 },
  "adv-016": { incorrectChannelRate: 1 },
  "identity-001": { incompleteCustomerIdentityRate: 1 },
};

function validateId(id: string): asserts id is MeasurementScenarioId {
  if (!(MEASUREMENT_SCENARIO_IDS as readonly string[]).includes(id)) throw new RangeError("unregistered scenario");
}
function validateSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967293) throw new RangeError("invalid scenario seed");
}
export function buildMeasurementScenario(id: string, seed: number): {
  readonly request: SimulateWorldRequest; readonly options: MeasurementRunOptions;
  readonly spendPlan: ScenarioSpendPlan; readonly controlCorruption: CorruptionConfigInput;
} {
  validateId(id); validateSeed(seed);
  const generated = generateMerchantWorldRecord({ seed: 64111, archetype: "fashion_apparel", scale: "growth", complexity: "adversarial",
    overrides: { forceZeroIncrementalityChannels: MARKETING_CHANNELS } });
  // Known null-effect control, including mediated interactions. This is deliberate,
  // not an inference from high/low dashboard ROAS. It is never passed to an Operator.
  const merchantWorld = { ...generated, manifest: { ...generated.manifest,
    channelInteractions: generated.manifest.channelInteractions.map(i => ({ ...i, effect: { ...i.effect, value: 0 } })) } };
  validateGroundTruthManifest(merchantWorld.manifest);
  const initial: SimulateWorldRequest = { merchantWorld,
    latentPopulation: generateCustomerPopulation({ merchantWorld, populationSeed: 74111,
      populationConfig: { maxExplicitAgents: 90, complexity: "adversarial", maxCategoryPreferences: 4, maxProductPreferences: 6 } }),
    simulationSeed: seed, startTime: START, endTime: END,
    interventions: [{ variable: "promotion.discount_active", operation: "set", value: { kind: "boolean", value: false } }],
    config: { maxEvents: 180000, maxSessionsPerCustomer: 16 } };
  // adv-015 is specifically an overlapping-claims world. Both paid platforms
  // need enough observable delivery to make dual-touch orders structurally
  // common across the preregistered seed set. Channel causal effects remain
  // exactly zero, so this changes the measurement opportunity set, not sales.
  const scenarioAllocation: ScenarioAllocation = id === "adv-015"
    ? { ...BASE_ALLOCATION, meta: 500000, google_search: 500000 }
    : { ...BASE_ALLOCATION };
  const spendPlan: ScenarioSpendPlan = { version: SCENARIO_SPEND_VERSION, periodStart: START, periodEnd: END,
    scope: "explicit_simulated_agents", execution: "fully_spent_period_allocation", allocation: scenarioAllocation };
  const controlCorruption: CorruptionConfigInput = { version: MEASUREMENT_VERSION, seed: 88213,
    identitySalt: "scenario-validation-private-identity-v1" };
  return { request: requestWithScenarioSpend(initial, spendPlan), spendPlan, controlCorruption,
    options: { corruption: { ...controlCorruption, ...modifications[id] }, asOf: END,
      platformSpend: measurementSpendLedger(spendPlan), scope: "explicit_simulated_agents" } };
}
export interface ScenarioPredicate { readonly id: string; readonly passed: boolean; readonly values: Readonly<Record<string, number | string | boolean>> }
export interface ScenarioVerification {
  readonly access: "evaluator_only";
  readonly version: typeof SCENARIO_LIBRARY_VERSION;
  readonly scenarioId: MeasurementScenarioId;
  readonly simulationSeed: number;
  readonly status: "PASS" | "FAIL";
  readonly qualification: "measurement_mechanism_only_not_phase1_scenario_acceptance";
  readonly predicates: readonly ScenarioPredicate[];
  readonly hashes: { readonly latent: string; readonly perfect: string; readonly observed: string; readonly controlObserved: string };
}
const browser = (o: CorruptedObservation) => o.events.filter(e => e.origin === "browser");
const uniqueVisitors = (o: CorruptedObservation) => new Set(browser(o).map(e => e.visitorId)).size;
const count = (o: CorruptedObservation, kind: string) => browser(o).filter(e => e.eventType === kind).length;
const revenue = (o: CorruptedObservation) => o.orders.reduce((s, order) => s + order.netSalesMinor, 0);

/** Verifies an actual simulator output and a measurement-only counterfactual. No fabricated KPI rows. */
export function verifyMeasurementScenario(id: MeasurementScenarioId, bundle: EvaluatorWorldBundle,
  control: CorruptedObservation, controlCorruption: CorruptionConfigInput): ScenarioVerification {
  validateId(id);
  const observed = bundle.corruptedObservation;
  const predicates: ScenarioPredicate[] = [];
  const check = (name: string, passed: boolean, values: ScenarioPredicate["values"]) => predicates.push({ id: name, passed, values });
  const rawOrders = bundle.latentTruth.simulation.purchases.filter(p => Date.parse(p.occurredAt) < Date.parse(END));
  check("nonvacuous_commerce", rawOrders.length > 0 && browser(control).length > 0,
    { orders: rawOrders.length, browserEvents: browser(control).length });
  check("server_revenue_reconciles", revenue(observed) === rawOrders.reduce((s, p) => s + p.netRevenueMinor, 0),
    { observedRevenueMinor: revenue(observed), actualOrders: rawOrders.length });
  check("measurement_does_not_create_orders", sha256(observed.orders) === sha256(control.orders), { observedOrders: observed.orders.length, controlOrders: control.orders.length });
  switch (id) {
    case "adv-008": {
      const tagged = browser(control).filter(e => e.utmSource !== undefined);
      const byId = new Map(browser(observed).map(e => [e.eventId, e]));
      const lost = tagged.filter(e => byId.get(e.eventId)?.source === "direct" && byId.get(e.eventId)?.utmSource === undefined);
      check("tagged_traffic_disguised_as_direct", tagged.length > 0 && lost.length === tagged.length,
        { taggedEvents: tagged.length, directFallbackEvents: lost.length });
      break;
    }
    case "adv-009": case "adv-010": {
      check("observed_identity_count_inflated", uniqueVisitors(observed) > uniqueVisitors(control),
        { controlVisitors: uniqueVisitors(control), fragmentedVisitors: uniqueVisitors(observed) });
      const accounts = new Set(observed.orders.map(o => o.customerId));
      check("server_customer_identity_unchanged", accounts.size === new Set(control.orders.map(o => o.customerId)).size,
        { serverCustomers: accounts.size });
      // Distinguish device fragmentation from cookie expiry using the evaluator crosswalk.
      const audit = bundle.measurementDiagnostics.rows;
      const key = id === "adv-009" ? "cross_device_fragmentation" : "cookie_fragmentation";
      check("intended_mechanism_applied", audit.some(r => r.reasons.includes(key)), { mechanism: key });
      break;
    }
    case "adv-012":
      check("pixel_outage_not_sales_collapse", count(control, "purchase") > 0 && browser(observed).length === 0,
        { controlBrowserPurchases: count(control, "purchase"), observedBrowserEvents: browser(observed).length });
      break;
    case "adv-013": {
      const n = count(control, "purchase"), duplicated = count(observed, "purchase");
      const distinct = new Set(browser(observed).filter(e => e.eventType === "purchase").map(e => e.eventId)).size;
      check("duplicated_receipts_not_orders", n > 0 && duplicated === 2 * n && distinct === n,
        { cleanPixelPurchases: n, duplicateReceipts: duplicated, distinctPixelPurchases: distinct });
      break;
    }
    case "adv-014": {
      const lag = 7 * 86400000, maturedAt = new Date(Date.parse(END) + lag).toISOString();
      const matured = measurePerfectWorld({ ...bundle.perfectObservableTruth, periodEnd: maturedAt },
        bundle.measurementDiagnostics.config, maturedAt).observation;
      const matureReports = matured.platformReports;
      const backfillMatches = matureReports.every(r => {
        const clean = control.platformReports.find(c => c.platform === r.platform);
        return clean?.attributedOrders === r.attributedOrders && clean.attributedRevenueMinor === r.attributedRevenueMinor && clean.spendMinor === r.spendMinor;
      });
      check("reporting_lag_censors_tail", observed.platformReports.every(r => Date.parse(r.periodEnd) === Date.parse(END) - lag), { lagMs: lag });
      check("mature_backfill_recovers_identical_report", matureReports.length === 2 && backfillMatches, { reportCount: matureReports.length });
      break;
    }
    case "adv-015": {
      const claims = observed.platformReports.reduce((s, r) => s + r.attributedRevenueMinor, 0);
      const metaClaims = new Set(bundle.measurementDiagnostics.platformClaims.meta);
      const googleClaims = new Set(bundle.measurementDiagnostics.platformClaims.google);
      const overlappingOrders = [...metaClaims].filter(orderId => googleClaims.has(orderId)).length;
      check("independent_platform_claims_overlap", overlappingOrders > 0,
        { metaClaimedOrders: metaClaims.size, googleClaimedOrders: googleClaims.size,
          overlappingOrders, summedClaimsMinor: claims, storeRevenueMinor: revenue(observed) });
      break;
    }
    case "adv-016": {
      const clean = new Map(control.events.filter(e => e.origin !== "server").map(e => [e.eventId, e.source]));
      const changed = observed.events.filter(e => e.origin !== "server" && clean.get(e.eventId) !== e.source);
      check("classification_changes_without_new_sales", changed.length > 0 && changed.length === clean.size,
        { reclassifiedEvents: changed.length, eligibleEvents: clean.size });
      break;
    }
    case "identity-001":
      // Order value/ID/time is stable; only the account identifier is deliberately missing.
      predicates.splice(predicates.findIndex(p => p.id === "measurement_does_not_create_orders"), 1);
      check("account_identity_missing_not_new_customer", control.orders.some(o => o.customerId !== undefined) && observed.orders.every(o => o.customerId === undefined),
        { observedIdentifiedOrders: observed.orders.filter(o => o.customerId !== undefined).length });
      check("orders_unchanged_except_identity", sha256(observed.orders) === sha256(control.orders.map(({ customerId: _id, ...o }) => o)), { observedOrders: observed.orders.length });
      break;
  }
  const recomputed = measurePerfectWorld(bundle.perfectObservableTruth, controlCorruption, observed.asOf).observation;
  check("control_is_same_perfect_world", sha256(recomputed) === sha256(control), { controlHash: sha256(control) });
  const wire = operatorPayload(bundle);
  const forbidden = ["latentTruth", "godMode", "simulationSeed", "purchaseIntent", "measurementDiagnostics", "identitySalt", "oracle", id];
  check("operator_wire_excludes_hidden_metadata", forbidden.every(term => !wire.includes(term)), { wireValid: true });
  return { access: "evaluator_only", version: SCENARIO_LIBRARY_VERSION, scenarioId: id,
    simulationSeed: bundle.latentTruth.request.simulationSeed,
    status: predicates.every(p => p.passed) ? "PASS" : "FAIL",
    qualification: "measurement_mechanism_only_not_phase1_scenario_acceptance", predicates,
    hashes: { latent: sha256(bundle.latentTruth), perfect: sha256(bundle.perfectObservableTruth), observed: sha256(observed), controlObserved: sha256(control) } };
}
export function runMeasurementScenario(id: string, seed: number) {
  validateId(id);
  const inputs = buildMeasurementScenario(id, seed);
  const bundle = runMeasuredWorld(inputs.request, inputs.options);
  const control = measurePerfectWorld(bundle.perfectObservableTruth, inputs.controlCorruption, inputs.options.asOf).observation;
  return { bundle, control, verification: verifyMeasurementScenario(id, bundle, control, inputs.controlCorruption) };
}

/** Six explicitly feasible period allocations, not a replacement for the canonical BusinessAction ontology. */
export function scenarioAllocationCandidates(): readonly { readonly actionId: string; readonly action: ScenarioAllocation }[] {
  return [
    { actionId: "a0", action: { ...BASE_ALLOCATION } },
    { actionId: "a1", action: { ...BASE_ALLOCATION, meta: BASE_ALLOCATION.meta + 100000 } },
    { actionId: "a2", action: { ...BASE_ALLOCATION, google_search: BASE_ALLOCATION.google_search + 100000 } },
    { actionId: "a3", action: { ...BASE_ALLOCATION, meta: 0 } },
    { actionId: "a4", action: { ...BASE_ALLOCATION, google_search: 0, google_shopping: 0 } },
    { actionId: "a5", action: { meta: 0, google_search: 0, google_shopping: 0, pinterest: 0, affiliate: 0 } },
  ];
}
/** Integrated finite oracle: each candidate runs the SAME frozen simulator with the SAME seeds. */
export async function evaluateMeasurementScenarioActions(id: string, seeds: readonly number[]): Promise<FiniteOracleResult> {
  validateId(id);
  return evaluateFiniteActionSet({ actionSetVersion: "measurement-controls-six-allocations/1", universeComplete: true,
    baselineActionId: "a0", candidates: scenarioAllocationCandidates(), seeds,
    scope: "explicit_agents_booked_product_contribution_no_returns_no_clv_no_overhead", currency: "CAD",
    horizon: { start: START, end: END }, maximumEvaluations: 120,
    evaluate: ({ candidate, seed }) => {
      const input = buildMeasurementScenario(id, seed);
      const spendPlan = { ...input.spendPlan, allocation: candidate.action };
      const initial = { ...input.request, interventions: (input.request.interventions ?? []).filter(i => !/^marketing\..*\.spend$/.test(i.variable)) };
      const request = requestWithScenarioSpend(initial, spendPlan);
      const bundle = runMeasuredWorld(request, { ...input.options, platformSpend: measurementSpendLedger(spendPlan) });
      return scenarioBookedEconomics(request, bundle.latentTruth.simulation, spendPlan).economics;
    } });
}

/** Admission is separate from code-test success. A failed public validation seed stays failed. */
export function measurementScenarioAdmission(records: readonly ScenarioVerification[]) {
  const expectedSeeds: readonly number[] = [...SCENARIO_SEED_SPLIT.development, ...SCENARIO_SEED_SPLIT.validation];
  const keys = records.map(r => `${r.scenarioId}:${r.simulationSeed}`);
  if (new Set(keys).size !== keys.length || records.length !== MEASUREMENT_SCENARIO_IDS.length * expectedSeeds.length ||
      records.some(r => !(MEASUREMENT_SCENARIO_IDS as readonly string[]).includes(r.scenarioId) || !expectedSeeds.includes(r.simulationSeed))) {
    throw new RangeError("admission requires every preregistered scenario/seed exactly once");
  }
  for (const record of records) {
    const predicateIds = record.predicates.map(p => p.id);
    if (record.access !== "evaluator_only" || record.version !== SCENARIO_LIBRARY_VERSION ||
        record.qualification !== "measurement_mechanism_only_not_phase1_scenario_acceptance" ||
        predicateIds.length < 5 || new Set(predicateIds).size !== predicateIds.length ||
        !["nonvacuous_commerce", "server_revenue_reconciles", "control_is_same_perfect_world",
          "operator_wire_excludes_hidden_metadata"].every(id => predicateIds.includes(id)) ||
        Object.values(record.hashes).some(value => !/^[a-f0-9]{64}$/.test(value)) ||
        record.status !== (record.predicates.every(p => p.passed) ? "PASS" : "FAIL")) {
      throw new RangeError("invalid or incomplete scenario verification record");
    }
  }
  const families = MEASUREMENT_SCENARIO_IDS.map(id => {
    const cases = records.filter(r => r.scenarioId === id);
    if (new Set(cases.map(r => r.simulationSeed)).size !== expectedSeeds.length) throw new RangeError("missing scenario seed");
    const failedSeeds = cases.filter(r => r.status !== "PASS" || r.predicates.some(p => !p.passed)).map(r => r.simulationSeed);
    return { scenarioId: id, status: failedSeeds.length === 0 ? "MECHANISM_VERIFIED" as const : "UNQUALIFIED" as const, failedSeeds };
  });
  return { access: "evaluator_only" as const, version: SCENARIO_LIBRARY_VERSION,
    families, verifiedMeasurementFamilies: families.filter(f => f.status === "MECHANISM_VERIFIED").map(f => f.scenarioId),
    /** Measurement-only qualification cannot satisfy the stronger decision-scenario gate. */
    phase1AcceptedScenarioIds: [] as string[], sealedBenchmarkHoldout: false as const };
}
