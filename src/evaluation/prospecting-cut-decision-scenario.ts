import { createProspectingCutTrapFixture } from "../cross_channel/adversarial.js";
import { normalizedPortfolioSpend } from "../cross_channel/evaluator.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { MEASUREMENT_VERSION } from "../measurement_corruption/index.js";
import { oracleContribution } from "./finite-decision-oracle.js";
import { evaluateScheduledDecisionSet, type ScheduledDecisionInput } from "./scheduled-decision-oracle.js";
import { SCENARIO_PAID_CHANNELS, type ScenarioAllocation } from "./scenario-spend.js";
import { SCHEDULED_SPEND_VERSION } from "./scheduled-spend.js";

export const PROSPECTING_CUT_DECISION_VERSION = "prospecting-cut-decision/0.1.0" as const;
/** Fixed before the first evaluation. Public replication seeds, NOT sealed holdouts. */
export const PROSPECTING_CUT_SEEDS = Object.freeze({
  development: Object.freeze([93120, 93121]), validation: Object.freeze([193120, 193121]),
});

/** Reuses the Step 6 mediated/lagged awareness fixture; no frozen model is modified. */
export function buildProspectingCutDecisionScenario(): Omit<ScheduledDecisionInput, "seeds" | "maximumEvaluations"> {
  const fixture = createProspectingCutTrapFixture();
  const startTime = "2026-01-01T00:00:00.000Z", endTime = "2026-05-01T00:00:00.000Z";
  const initial: SimulateWorldRequest = { merchantWorld: fixture.merchantWorld,
    latentPopulation: fixture.latentPopulation, simulationSeed: fixture.simulationSeed, startTime, endTime,
    config: { maxEvents: 320000, maxSessionsPerCustomer: 22 },
    interventions: [{ variable: "promotion.discount_active", operation: "set", value: { kind: "boolean", value: false } }] };
  const reference = normalizedPortfolioSpend({ merchantWorld: fixture.merchantWorld, latentPopulation: fixture.latentPopulation,
    simulationSeed: fixture.simulationSeed, periodStart: startTime, periodEnd: endTime, spendMinorByChannel: {} });
  const initialAllocation = Object.fromEntries(SCENARIO_PAID_CHANNELS.map(channel => [channel, reference[channel] ?? 0])) as unknown as ScenarioAllocation;
  return { initial, decisionAt: "2026-01-31T00:00:00.000Z",
    // Seven and ninety FUTURE days from one 120-day world, not differently sized episodes.
    evaluationCutoffs: ["2026-02-07T00:00:00.000Z", endTime],
    spendPlan: { version: SCHEDULED_SPEND_VERSION, periodStart: startTime, periodEnd: endTime,
      referencePeriodMs: Date.parse(endTime) - Date.parse(startTime), initialAllocation, changes: [],
      scope: "explicit_simulated_agents", execution: "fully_spent_time_prorated_allocation" },
    measurement: { scope: "explicit_simulated_agents", corruption: { version: MEASUREMENT_VERSION,
      seed: 88217, identitySalt: "evaluator-private-prospecting-v1", missingUtmRate: 0.2, cookieLossRate: 0.1,
      metaOverAttributionRate: 0.3, googleOverAttributionRate: 1 } },
    candidates: [
      { actionId: "a0", action: { actionId: "a0", interventions: [], actionCostMinor: 0 } },
      { actionId: "a1", action: { actionId: "a1", interventions: [], actionCostMinor: 0,
        budgetAdjustments: [{ channel: "meta", operation: "set", amountMinor: Math.floor(initialAllocation.meta / 2) }] } },
    ], baselineActionId: "a0", actionSetVersion: "registered-prospecting-half-cut-subspace/1.0.0", universeComplete: true,
  };
}

/**
 * Fail-closed qualification: a historical fixture title is NOT evidence that its
 * prospective, corrupted-observation, actually-spent version exhibits the trap.
 * Even PASS qualifies only this two-action booked-contribution subspace.
 */
export function verifyProspectingCutMechanism(result: Pick<Awaited<ReturnType<typeof evaluateScheduledDecisionSet>>, "branches">) {
  if (result.branches.length !== 2 || new Set(result.branches.map(b => b.seed)).size !== 1 ||
      !["a0", "a1"].every(id => result.branches.filter(b => b.actionId === id).length === 1) ||
      result.branches.some(b => b.checkpoints.length !== 2 || b.checkpoints[0]!.asOf !== "2026-02-07T00:00:00.000Z" || b.checkpoints[1]!.asOf !== "2026-05-01T00:00:00.000Z")) {
    throw new RangeError("complete paired branches and registered seven/ninety-day checkpoints are required");
  }
  const control = result.branches.find(b => b.actionId === "a0")!;
  const cut = result.branches.find(b => b.actionId === "a1")!;
  const shortControl = control.checkpoints[0]!, shortCut = cut.checkpoints[0]!;
  const longControl = control.checkpoints[1]!, longCut = cut.checkpoints[1]!;
  const shortDelta = oracleContribution(shortCut.economics) - oracleContribution(shortControl.economics);
  const longDelta = oracleContribution(longCut.economics) - oracleContribution(longControl.economics);
  const predicates = [
    { id: "same_predecision_observation", passed: control.observationHash === cut.observationHash },
    { id: "nonvacuous_short_and_long_commerce", passed: shortControl.futureOrders > 0 && longControl.futureOrders > shortControl.futureOrders },
    { id: "short_term_booked_contribution_improves", passed: shortDelta > 0 },
    { id: "long_term_booked_contribution_declines", passed: longDelta < 0 },
    { id: "long_term_net_sales_decline", passed: longCut.economics.netSalesMinor < longControl.economics.netSalesMinor },
    { id: "long_term_branded_search_declines", passed: longCut.brandedSearchEvents < longControl.brandedSearchEvents },
    { id: "long_term_first_purchase_orders_decline", passed: longCut.firstPurchaseOrders < longControl.firstPurchaseOrders },
    { id: "less_actual_meta_spend_not_changed_accounting", passed: shortCut.economics.paidSpendMinor < shortControl.economics.paidSpendMinor && longCut.economics.paidSpendMinor < longControl.economics.paidSpendMinor },
  ];
  return { status: predicates.every(p => p.passed) ? "PASS" as const : "FAIL" as const,
    qualification: "finite_budget_subspace_not_full_phase1_acceptance" as const,
    predicates, metrics: { shortContributionDeltaMinor: shortDelta, longContributionDeltaMinor: longDelta,
      longNetSalesDeltaMinor: longCut.economics.netSalesMinor - longControl.economics.netSalesMinor,
      longBrandedSearchDelta: longCut.brandedSearchEvents - longControl.brandedSearchEvents,
      longFirstPurchaseOrderDelta: longCut.firstPurchaseOrders - longControl.firstPurchaseOrders } };
}

export async function runProspectingCutDecisionScenario(seed: number) {
  const result = await evaluateScheduledDecisionSet({ ...buildProspectingCutDecisionScenario(), seeds: [seed], maximumEvaluations: 3 });
  return { access: "evaluator_only" as const, version: PROSPECTING_CUT_DECISION_VERSION, seed,
    ...verifyProspectingCutMechanism(result), result };
}
