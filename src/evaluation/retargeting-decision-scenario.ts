import { createRetargetingTrapFixture } from "../advertising_economics/adversarial.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { MEASUREMENT_VERSION } from "../measurement_corruption/index.js";
import { parseOperatorObservation } from "../observation/corrupted-world.js";
import { SCHEDULED_SPEND_VERSION, type ScheduledSpendPlan } from "./scheduled-spend.js";
import { evaluateScheduledDecisionSet, type ScheduledDecisionAction } from "./scheduled-decision-oracle.js";
import type { OracleCandidate } from "./finite-decision-oracle.js";
import { sha256 } from "./replay-manifest.js";

export const RETARGETING_DECISION_VERSION = "retargeting-budget-decision/0.1.0" as const;
/** Registered before validation; public replication seeds, not sealed holdouts. */
export const RETARGETING_SEEDS = { development: [105002, 105003], validation: [205002, 205003] } as const;
export function buildRetargetingDecisionScenario() {
  const fixture = createRetargetingTrapFixture();
  const e = fixture.evaluation;
  const initial: SimulateWorldRequest = { merchantWorld: fixture.merchantWorld, latentPopulation: fixture.latentPopulation,
    startTime: e.periodStart, endTime: e.periodEnd, simulationSeed: e.simulationSeed,
    ...(e.simulationConfig === undefined ? {} : { config: e.simulationConfig }),
    interventions: [{ variable: "promotion.discount_active", operation: "set", value: { kind: "boolean", value: false } }] };
  const spendPlan: ScheduledSpendPlan = { version: SCHEDULED_SPEND_VERSION,
    periodStart: initial.startTime, periodEnd: initial.endTime,
    referencePeriodMs: Date.parse(initial.endTime) - Date.parse(initial.startTime),
    scope: "explicit_simulated_agents", execution: "fully_spent_time_prorated_allocation",
    initialAllocation: { meta: 45000, google_search: 260000, google_shopping: 0, pinterest: 0, affiliate: 0 }, changes: [] };
  const candidate = (action: ScheduledDecisionAction): OracleCandidate<ScheduledDecisionAction> => ({ actionId: action.actionId, action });
  const candidates = [
    candidate({ actionId: "a0", interventions: [], actionCostMinor: 0 }),
    candidate({ actionId: "a1", interventions: [], actionCostMinor: 0,
      budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: 100000 }] }),
    candidate({ actionId: "a2", interventions: [], actionCostMinor: 0,
      budgetAdjustments: [{ channel: "meta", operation: "set", amountMinor: 0 }] }),
    candidate({ actionId: "a3", interventions: [], actionCostMinor: 0,
      budgetAdjustments: [{ channel: "google_search", operation: "delta", amountMinor: 100000 }] }),
    candidate({ actionId: "a4", interventions: [], actionCostMinor: 0,
      budgetAdjustments: [{ channel: "google_search", operation: "set", amountMinor: 0 }] }),
  ];
  return { initial, spendPlan, candidates, decisionAt: "2026-02-01T00:00:00.000Z",
    measurement: { corruption: { version: MEASUREMENT_VERSION, seed: 88215,
      identitySalt: "evaluator-private-retargeting-salt-v1", metaOverAttributionRate: 1,
      missingUtmRate: 0.2, cookieLossRate: 0.1, crossDeviceIdentityRate: 0.2 }, scope: "explicit_simulated_agents" as const },
    actionSetVersion: "registered-retargeting-budget-subspace/1.0.0", baselineActionId: "a0", universeComplete: true as const };
}

/**
 * Verifies the misleading PRE-decision report against actual FUTURE budget replays.
 * All candidate actions receive the exact same warmup observation. The finite
 * subspace is disclosed and is not the full canonical BusinessAction universe.
 */
export async function runRetargetingDecisionScenario(seed: number) {
  const result = await evaluateScheduledDecisionSet({ ...buildRetargetingDecisionScenario(), seeds: [seed], maximumEvaluations: 6 });
  const observed = parseOperatorObservation(JSON.parse(result.observationBySeed[0]!.payload));
  const meta = observed.platformReports.find(r => r.platform === "meta")!;
  const baseline = result.branches.find(r => r.actionId === "a0")!;
  const increased = result.branches.find(r => r.actionId === "a1")!;
  const disabled = result.branches.find(r => r.actionId === "a2")!;
  const baseRank = result.oracle.ranking.find(r => r.actionId === "a0")!;
  const metaRank = result.oracle.ranking.find(r => r.actionId === "a1")!;
  const offRank = result.oracle.ranking.find(r => r.actionId === "a2")!;
  const predicates = [
    { id: "predecision_meta_roas_above_one", passed: meta.spendMinor > 0 && meta.attributedRevenueMinor > meta.spendMinor },
    { id: "nonvacuous_future_commerce", passed: baseline.economics.netSalesMinor > 0 },
    { id: "same_purchases_when_meta_disabled", passed: disabled.purchaseSignature === baseline.purchaseSignature },
    { id: "more_meta_budget_does_not_increase_purchases", passed: increased.purchaseSignature === baseline.purchaseSignature },
    { id: "meta_scale_loses_true_contribution", passed: metaRank.meanContributionMinor < baseRank.meanContributionMinor },
    { id: "meta_off_beats_scaling", passed: offRank.meanContributionMinor > metaRank.meanContributionMinor },
    { id: "future_actions_do_not_change_decision_information", passed: new Set(result.branches.map(b => b.observationHash)).size === 1 },
  ];
  return { access: "evaluator_only" as const, version: RETARGETING_DECISION_VERSION, seed,
    status: predicates.every(p => p.passed) ? "PASS" as const : "FAIL" as const,
    qualification: "finite_budget_subspace_not_full_phase1_acceptance" as const,
    predicates, metrics: { metaObservedRoas: meta.spendMinor === 0 ? null : meta.attributedRevenueMinor / meta.spendMinor,
      baselineFutureSalesMinor: baseline.economics.netSalesMinor,
      extraMetaExpenseMinor: increased.economics.paidSpendMinor - baseline.economics.paidSpendMinor,
      metaIncreaseContributionDeltaMinor: metaRank.meanDeltaVersusBaselineMinor,
      metaOffContributionDeltaMinor: offRank.meanDeltaVersusBaselineMinor }, result };
}


export type RetargetingDecisionRecord = Awaited<
  ReturnType<typeof runRetargetingDecisionScenario>
>;

/**
 * Candidate admission is deliberately stricter than "the test passed once".
 * It requires every preregistered public development/validation seed, the same
 * finite action universe and economic scope, complete mechanism predicates and
 * an Operator payload that contains none of the evaluator-only answer fields.
 *
 * This still does NOT count toward Phase 1 adversarial coverage: the scenario's
 * five-action budget subspace has not yet been translated through the complete
 * canonical BusinessAction universe.
 */
export function retargetingScenarioCandidateAdmission(
  records: readonly RetargetingDecisionRecord[],
) {
  const expectedSeeds = [
    ...RETARGETING_SEEDS.development,
    ...RETARGETING_SEEDS.validation,
  ];
  if (
    records.length !== expectedSeeds.length ||
    new Set(records.map((record) => record.seed)).size !== expectedSeeds.length ||
    records.some((record) => !expectedSeeds.includes(record.seed as never))
  ) {
    throw new RangeError(
      "candidate admission requires every preregistered retargeting seed exactly once",
    );
  }
  const ordered = [...records].sort((a, b) => a.seed - b.seed);
  const expectedPredicateIds = [
    "predecision_meta_roas_above_one",
    "nonvacuous_future_commerce",
    "same_purchases_when_meta_disabled",
    "more_meta_budget_does_not_increase_purchases",
    "meta_scale_loses_true_contribution",
    "meta_off_beats_scaling",
    "future_actions_do_not_change_decision_information",
  ];
  for (const record of ordered) {
    const predicateIds = record.predicates.map((predicate) => predicate.id);
    if (
      record.status !== "PASS" ||
      record.predicates.some((predicate) => !predicate.passed) ||
      JSON.stringify(predicateIds) !== JSON.stringify(expectedPredicateIds) ||
      record.result.oracle.evaluatedActions !== 5 ||
      record.result.oracle.searchDomain !== "supplied_finite_feasible_set" ||
      record.result.oracle.actionSetVersion !==
        "registered-retargeting-budget-subspace/1.0.0" ||
      record.result.observationBySeed.length !== 1 ||
      record.result.observationBySeed.some(({ payload }) =>
        [
          "purchaseSignature",
          "oracle",
          "latentTruth",
          "godMode",
          "simulationSeed",
          "measurementDiagnostics",
        ].some((term) => payload.includes(term)),
      )
    ) {
      throw new RangeError(
        "retargeting candidate lacks complete non-leaking executed evidence",
      );
    }
  }
  const validation = ordered.filter((record) =>
    (RETARGETING_SEEDS.validation as readonly number[]).includes(record.seed),
  );
  const candidateSetHashes = new Set(
    validation.map((record) => record.result.oracle.candidateSetHash),
  );
  const scopes = new Set(
    validation.map((record) => record.result.oracle.scope),
  );
  const horizons = new Set(
    validation.map((record) => JSON.stringify(record.result.oracle.horizon)),
  );
  if (
    validation.length !== RETARGETING_SEEDS.validation.length ||
    candidateSetHashes.size !== 1 ||
    scopes.size !== 1 ||
    horizons.size !== 1
  ) {
    throw new RangeError(
      "validation seeds must share one action universe, scope and horizon",
    );
  }
  const scenario = buildRetargetingDecisionScenario();
  return {
    access: "evaluator_only" as const,
    version: RETARGETING_DECISION_VERSION,
    scenarioFamily: "retargeting_selection_trap" as const,
    status: "CANDIDATE_QUALIFIED" as const,
    publicDevelopmentSeeds: [...RETARGETING_SEEDS.development],
    publicValidationSeeds: [...RETARGETING_SEEDS.validation],
    worldHash: sha256({
      initial: scenario.initial,
      spendPlan: scenario.spendPlan,
      decisionAt: scenario.decisionAt,
      measurement: scenario.measurement,
    }),
    candidateSetHash: validation[0]!.result.oracle.candidateSetHash,
    actionSetVersion: validation[0]!.result.oracle.actionSetVersion,
    scope: validation[0]!.result.oracle.scope,
    horizon: validation[0]!.result.oracle.horizon,
    evidenceHash: sha256(
      ordered.map((record) => ({
        seed: record.seed,
        predicates: record.predicates,
        oracle: record.result.oracle,
        observationHash: record.result.branches[0]!.observationHash,
      })),
    ),
    phase1AdversarialCoverageCounted: false as const,
    blockingReason:
      "bounded_budget_subspace_not_complete_canonical_business_action_universe" as const,
  };
}
