import type { SimulateWorldRequest } from "../simulation/types.js";
import type { RegisteredSimulatorAction } from "./interactive-world.js";
import { utcTimestamp } from "../core/units.js";
import { validateIntervention } from "../ground_truth/interventions.js";
import { parseOperatorObservation, observationTimeSchema } from "../observation/corrupted-world.js";
import { measurePerfectWorld } from "../measurement_corruption/index.js";
import { runMeasuredWorld, operatorPayload, type MeasurementRunOptions } from "./measured-world.js";
import { applyBudgetAdjustments, requestWithScheduledSpend, scheduledMeasurementSpend,
  validateScheduledSpend, type ScheduledSpendPlan } from "./scheduled-spend.js";
import { scheduledBookedEconomics } from "./scheduled-economics.js";
import { evaluateFiniteActionSet, type OracleEconomics, type OracleCandidate } from "./finite-decision-oracle.js";
import { sha256 } from "./replay-manifest.js";

export const SCHEDULED_DECISION_VERSION = "scheduled-decision-oracle/0.2.0" as const;
export interface ScheduledDecisionAction extends RegisteredSimulatorAction { readonly actionCostMinor: number }
export interface ScheduledDecisionInput {
  readonly initial: SimulateWorldRequest;
  readonly spendPlan: ScheduledSpendPlan;
  readonly measurement: Omit<MeasurementRunOptions, "asOf" | "platformSpend">;
  readonly decisionAt: string;
  /** Evaluate shorter horizons from the SAME full episode, never by truncating the world. */
  readonly evaluationCutoffs?: readonly string[];
  readonly candidates: readonly OracleCandidate<ScheduledDecisionAction>[];
  readonly baselineActionId: string;
  readonly actionSetVersion: string;
  readonly universeComplete: boolean;
  readonly seeds: readonly number[];
  readonly maximumEvaluations: number;
}

/** Actual simulator branches, not a lookup table of desired action scores. Evaluator only. */
export async function evaluateScheduledDecisionSet(input: ScheduledDecisionInput) {
  const initial = structuredClone(input.initial), plan = validateScheduledSpend(input.spendPlan);
  const candidates = structuredClone(input.candidates), measurement = structuredClone(input.measurement);
  const seeds = [...input.seeds];
  if (!input.universeComplete || !input.actionSetVersion.trim() || candidates.length === 0 ||
      new Set(candidates.map(c => c.actionId)).size !== candidates.length || candidates.some(c => !c.actionId.trim()) ||
      seeds.length === 0 || seeds.some(s => !Number.isSafeInteger(s) || s < 0) || new Set(seeds).size !== seeds.length ||
      !Number.isSafeInteger(input.maximumEvaluations) || input.maximumEvaluations < (candidates.length + 1) * seeds.length) {
    throw new RangeError("complete candidates, distinct seeds and a budget covering warmup replays are required");
  }
  const decisionAt = observationTimeSchema.parse(input.decisionAt);
  const cutoff = Date.parse(decisionAt), start = Date.parse(initial.startTime), end = Date.parse(initial.endTime);
  if (cutoff <= start || cutoff + 1 >= end || (cutoff - start) % 86400000 !== 0 || plan.changes.length !== 0) {
    throw new RangeError("oracle requires a closed-day warmup and an empty future decision schedule");
  }
  const evaluationCutoffs = [...(input.evaluationCutoffs ?? [])];
  let previousCutoff = cutoff;
  for (const time of evaluationCutoffs) {
    observationTimeSchema.parse(time);
    const t = Date.parse(time);
    if (t <= previousCutoff || t > end || (t - start) % 86400000 !== 0) {
      throw new RangeError("evaluation cutoffs require strictly increasing closed days after the decision and within the fixed episode");
    }
    previousCutoff = t;
  }
  requestWithScheduledSpend(initial, plan);
  const baselineAction = candidates.find(c => c.actionId === input.baselineActionId)?.action;
  if (!baselineAction || baselineAction.actionCostMinor !== 0 || baselineAction.interventions.length !== 0 ||
      (baselineAction.budgetAdjustments?.length ?? 0) !== 0) throw new RangeError("baseline must be a true no-op with zero implementation cost");
  for (const { actionId, action } of candidates) {
    if (action.actionId !== actionId || !Number.isSafeInteger(action.actionCostMinor) || action.actionCostMinor < 0) throw new RangeError("invalid registered decision action");
    applyBudgetAdjustments(plan.initialAllocation, action.budgetAdjustments ?? []);
    for (const i of action.interventions) {
      validateIntervention(initial.merchantWorld.manifest.causalGraph, i);
      if (i.effectiveAt !== undefined || i.durationSeconds !== undefined || i.population !== undefined ||
          !["pricing.product_price", "promotion.discount_active", "inventory.available"].includes(i.variable)) throw new RangeError("unsupported scheduled decision intervention");
    }
  }
  const observedBySeed = new Map<number, string>();
  const beforeBySeed = new Map<number, OracleEconomics>();
  const branches: Array<{ seed: number; actionId: string; requestHash: string; observationHash: string;
    economics: OracleEconomics; purchaseSignature: string;
    checkpoints: Array<{ asOf: string; economics: OracleEconomics; futureOrders: number;
      firstPurchaseOrders: number; brandedSearchEvents: number }> }> = [];
  // Establish and commit the warmup observation before evaluating any future action.
  for (const seed of seeds) {
    const request = requestWithScheduledSpend({ ...initial, simulationSeed: seed }, plan);
    const bundle = runMeasuredWorld(request, { ...measurement, platformSpend: scheduledMeasurementSpend(plan), asOf: decisionAt });
    observedBySeed.set(seed, operatorPayload(bundle));
    beforeBySeed.set(seed, scheduledBookedEconomics(request, bundle.latentTruth.simulation, plan, decisionAt).economics);
  }
  const oracle = await evaluateFiniteActionSet({ actionSetVersion: input.actionSetVersion,
    universeComplete: input.universeComplete, baselineActionId: input.baselineActionId, candidates, seeds,
    maximumEvaluations: input.maximumEvaluations,
    currency: initial.merchantWorld.manifest.merchant.currency,
    scope: "explicit_agents_future_booked_contribution_no_returns_no_clv_no_overhead",
    horizon: { start: decisionAt, end: initial.endTime },
    evaluate: ({ candidate, seed }) => {
      const action = candidate.action;
      const effectiveAt = new Date(cutoff + 1).toISOString();
      const schedule: ScheduledSpendPlan = { ...plan, changes: (action.budgetAdjustments?.length ?? 0) === 0 ? [] : [{
        decisionId: "decision:1", effectiveAt,
        allocation: applyBudgetAdjustments(plan.initialAllocation, action.budgetAdjustments!),
      }] };
      const request = requestWithScheduledSpend({ ...initial, simulationSeed: seed,
        interventions: [...(initial.interventions ?? []), ...action.interventions.map(i => ({ ...i, effectiveAt: utcTimestamp(effectiveAt) }))] }, schedule);
      const bundle = runMeasuredWorld(request, { ...measurement, platformSpend: scheduledMeasurementSpend(schedule), asOf: decisionAt });
      const observed = parseOperatorObservation(measurePerfectWorld(bundle.perfectObservableTruth, measurement.corruption, decisionAt).observation);
      if (sha256(observed) !== sha256(JSON.parse(observedBySeed.get(seed)!))) throw new RangeError("candidate changed predecision observed data");
      const before = scheduledBookedEconomics(request, bundle.latentTruth.simulation, schedule, decisionAt).economics;
      if (sha256(before) !== sha256(beforeBySeed.get(seed))) throw new RangeError("candidate changed predecision economic state");
      const after = scheduledBookedEconomics(request, bundle.latentTruth.simulation, schedule, request.endTime, action.actionCostMinor).economics;
      const economics = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - before[k as keyof OracleEconomics]])) as unknown as OracleEconomics;
      const checkpoints = evaluationCutoffs.map(asOf => {
        const horizonEnd = Date.parse(asOf);
        const totals = scheduledBookedEconomics(request, bundle.latentTruth.simulation, schedule, asOf, action.actionCostMinor).economics;
        const future = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value - before[key as keyof OracleEconomics]])) as unknown as OracleEconomics;
        const purchases = bundle.latentTruth.simulation.purchases.filter(p => Date.parse(p.occurredAt) > cutoff && Date.parse(p.occurredAt) <= horizonEnd && Date.parse(p.occurredAt) < end);
        const branded = bundle.latentTruth.simulation.observableEvents.filter(e => e.eventType === "search" && e.searchIntent === "branded" &&
          (e.source === "google_search" || e.source === "google_shopping") && Date.parse(e.occurredAt) > cutoff && Date.parse(e.occurredAt) <= horizonEnd && Date.parse(e.occurredAt) < end);
        return { asOf, economics: future, futureOrders: purchases.length,
          firstPurchaseOrders: purchases.filter(p => !p.repeatPurchase).length, brandedSearchEvents: branded.length };
      });
      branches.push({ seed, actionId: candidate.actionId, requestHash: sha256(request), observationHash: sha256(observed), economics, checkpoints,
        purchaseSignature: sha256(bundle.latentTruth.simulation.purchases.filter(p => Date.parse(p.occurredAt) > cutoff && Date.parse(p.occurredAt) < end)
          .map(p => ({ customerId: p.customerId, occurredAt: p.occurredAt, lines: p.lines, netRevenueMinor: p.netRevenueMinor }))) });
      return economics;
    } });
  return { access: "evaluator_only" as const, version: SCHEDULED_DECISION_VERSION, oracle, branches, simulatorExecutions: oracle.evaluations + seeds.length,
    inputHash: sha256({ initial, plan, measurement, decisionAt, candidates, evaluationCutoffs }),
    /** Never serialize these seed labels or the surrounding object to an Operator. */
    observationBySeed: [...observedBySeed].map(([seed, payload]) => ({ seed, payload })) };
}
