import type { SimulateWorldRequest } from "../simulation/types.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { InteractiveReplayWorld } from "./interactive-world.js";
import type { MeasurementRunOptions } from "./measured-world.js";
import { oracleContribution, type OracleEconomics } from "./finite-decision-oracle.js";
import type { ScheduledDecisionAction } from "./scheduled-decision-oracle.js";
import { scheduledBookedEconomics } from "./scheduled-economics.js";
import { validateScheduledSpend, type ScheduledSpendPlan } from "./scheduled-spend.js";
import { sha256 } from "./replay-manifest.js";

export const TRAJECTORY_COMPARISON_VERSION = "paired-intervention-trajectories/0.1.0" as const;
export interface InterventionTrajectory {
  readonly trajectoryId: string;
  readonly actionIds: readonly string[];
}
export interface TrajectoryComparisonInput {
  readonly initial: SimulateWorldRequest;
  readonly measurement: Omit<MeasurementRunOptions, "asOf" | "platformSpend">;
  readonly spendPlan: ScheduledSpendPlan;
  readonly actions: readonly ScheduledDecisionAction[];
  readonly actionSetVersion: string;
  readonly noOpActionId: string;
  readonly stepMs: number;
  readonly warmupSteps: number;
  readonly trajectories: readonly InterventionTrajectory[];
  readonly baselineTrajectoryId: string;
  readonly seeds: readonly number[];
  /** Includes construction, every reset, every warmup and every actual step. */
  readonly maximumSimulations: number;
}
export interface TrajectoryConsequence {
  readonly seed: number;
  readonly trajectoryId: string;
  readonly initialTruthHash: string;
  readonly warmupObservationHashes: readonly string[];
  readonly decisionObservationHash: string;
  readonly decisionEconomicsHash: string;
  readonly finalObservationHash: string;
  readonly finalRequestHash: string;
  readonly futurePurchaseHash: string;
  readonly futureOrders: number;
  readonly economics: OracleEconomics;
  readonly contributionMinor: number;
  readonly deltaVersusBaselineMinor: number;
}
const DAY = 86400000;
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function checkedSum(values: readonly number[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum)) throw new RangeError("trajectory money exceeds safe integer range");
  return sum;
}

/**
 * Evaluator-only paired consequences of registered action SEQUENCES.
 * Explicit reset(seed), identical warmup, fixed latent inputs and measurement.
 * Each next action is applied through the existing world.step clock, not by
 * editing final KPIs or replaying a predecision action as though it were new.
 * Results compare this finite set, not a global optimum or a learned policy.
 */
export function compareInterventionTrajectories(raw: TrajectoryComparisonInput) {
  const input = structuredClone(raw);
  const plan = validateScheduledSpend(input.spendPlan);
  const actions = [...input.actions].sort((a, b) => textOrder(a.actionId, b.actionId));
  const trajectories = [...input.trajectories].sort((a, b) => textOrder(a.trajectoryId, b.trajectoryId));
  const seeds = [...input.seeds].sort((a, b) => a - b);
  const actionMap = new Map(actions.map(a => [a.actionId, a]));
  const noOp = actionMap.get(input.noOpActionId);
  const length = trajectories[0]?.actionIds.length ?? 0;
  const baseline = trajectories.find(t => t.trajectoryId === input.baselineTrajectoryId);
  if (!input.actionSetVersion.trim() || actions.length !== actionMap.size ||
      actions.some(a => !a.actionId.trim() || !Number.isSafeInteger(a.actionCostMinor) || a.actionCostMinor < 0) ||
      !noOp || noOp.interventions.length !== 0 || (noOp.budgetAdjustments?.length ?? 0) !== 0 || noOp.actionCostMinor !== 0 ||
      !baseline || length === 0 || new Set(trajectories.map(t => t.trajectoryId)).size !== trajectories.length ||
      trajectories.some(t => !t.trajectoryId.trim() || t.actionIds.length !== length || t.actionIds.some(id => !actionMap.has(id))) ||
      baseline.actionIds.some(id => id !== input.noOpActionId)) {
    throw new RangeError("registered equal-length trajectories and a true no-op baseline are required");
  }
  if (seeds.length === 0 || new Set(seeds).size !== seeds.length || seeds.some(s => !Number.isSafeInteger(s) || s < 0)) {
    throw new RangeError("distinct nonnegative integer paired seeds are required");
  }
  observationTimeSchema.parse(input.initial.startTime);
  observationTimeSchema.parse(input.initial.endTime);
  const start = Date.parse(input.initial.startTime), end = Date.parse(input.initial.endTime);
  if (!Number.isSafeInteger(input.stepMs) || input.stepMs <= 0 || input.stepMs % DAY !== 0 ||
      !Number.isSafeInteger(input.warmupSteps) || input.warmupSteps < 1 || plan.changes.length !== 0 ||
      end <= start || (end - start) % DAY !== 0) {
    throw new RangeError("closed-day steps, positive warmup and an unchanged initial schedule are required");
  }
  const decisionMs = start + input.warmupSteps * input.stepMs;
  const finishMs = decisionMs + length * input.stepMs;
  if (!Number.isSafeInteger(finishMs) || finishMs > end || decisionMs >= end) {
    throw new RangeError("trajectory exceeds the fixed world horizon");
  }
  const requiredSimulations = 1 + seeds.length * trajectories.length * (1 + input.warmupSteps + length);
  if (!Number.isSafeInteger(requiredSimulations) || !Number.isSafeInteger(input.maximumSimulations) ||
      input.maximumSimulations < requiredSimulations) {
    throw new RangeError("simulation budget must cover every construction, reset, warmup and step");
  }
  const decisionAt = new Date(decisionMs).toISOString(), evaluationEnd = new Date(finishMs).toISOString();
  const world = new InteractiveReplayWorld({ initial: input.initial, spendPlan: plan, actions,
    stepMs: input.stepMs, measurement: { ...input.measurement, platformSpend: [] } });
  let simulations = 1;
  const rows: Omit<TrajectoryConsequence, "deltaVersusBaselineMinor">[] = [];
  for (const seed of seeds) {
    let commonInitial: string | undefined;
    let commonWarmup: string | undefined;
    let commonEconomics: string | undefined;
    for (const trajectory of trajectories) {
      const resetObservation = world.reset(seed); simulations += 1;
      const initialTruthHash = sha256(world.evaluatorSnapshot().latentTruth);
      const warmupObservationHashes = [sha256(resetObservation)];
      for (let i = 0; i < input.warmupSteps; i += 1) {
        warmupObservationHashes.push(sha256(world.step(input.noOpActionId))); simulations += 1;
      }
      const beforeBundle = world.evaluatorSnapshot(), beforePlan = world.evaluatorSpendSnapshot()!.plan;
      if (world.observe().asOf !== decisionAt) throw new RangeError("warmup clock mismatch");
      const before = scheduledBookedEconomics(beforeBundle.latentTruth.request, beforeBundle.latentTruth.simulation, beforePlan, decisionAt);
      const decisionEconomicsHash = sha256(before.economics), warmupHash = sha256(warmupObservationHashes);
      if (commonInitial !== undefined && (initialTruthHash !== commonInitial || warmupHash !== commonWarmup || decisionEconomicsHash !== commonEconomics)) {
        throw new RangeError("reset did not reproduce identical latent inputs and predecision evidence");
      }
      commonInitial = initialTruthHash; commonWarmup = warmupHash; commonEconomics = decisionEconomicsHash;
      for (const actionId of trajectory.actionIds) { world.step(actionId); simulations += 1; }
      const bundle = world.evaluatorSnapshot(), finalPlan = world.evaluatorSpendSnapshot()!.plan;
      if (world.observe().asOf !== evaluationEnd) throw new RangeError("trajectory clock mismatch");
      const unchangedPast = scheduledBookedEconomics(bundle.latentTruth.request, bundle.latentTruth.simulation, finalPlan, decisionAt);
      if (sha256(unchangedPast.economics) !== decisionEconomicsHash) throw new RangeError("trajectory rewrote predecision economics");
      const actionCost = checkedSum(trajectory.actionIds.map(id => actionMap.get(id)!.actionCostMinor));
      const after = scheduledBookedEconomics(bundle.latentTruth.request, bundle.latentTruth.simulation, finalPlan, evaluationEnd, actionCost);
      const economics = Object.fromEntries(Object.entries(after.economics).map(([key, value]) => {
        const difference = value - before.economics[key as keyof OracleEconomics];
        if (!Number.isSafeInteger(difference) || difference < 0) throw new RangeError("invalid future booked economic component");
        return [key, difference];
      })) as unknown as OracleEconomics;
      const purchases = bundle.latentTruth.simulation.purchases.filter(p => {
        const t = Date.parse(p.occurredAt); return t > decisionMs && t <= finishMs && t < end;
      });
      rows.push({ seed, trajectoryId: trajectory.trajectoryId, initialTruthHash, warmupObservationHashes,
        decisionObservationHash: warmupObservationHashes.at(-1)!, decisionEconomicsHash,
        finalObservationHash: sha256(world.observe()), finalRequestHash: sha256(bundle.latentTruth.request),
        futurePurchaseHash: sha256(purchases.map(p => ({ customerId: p.customerId, occurredAt: p.occurredAt, lines: p.lines, netRevenueMinor: p.netRevenueMinor }))),
        futureOrders: purchases.length, economics, contributionMinor: oracleContribution(economics) });
    }
  }
  if (simulations !== requiredSimulations) throw new RangeError("trajectory execution count mismatch");
  const consequences: TrajectoryConsequence[] = rows.map(row => ({ ...row,
    deltaVersusBaselineMinor: checkedSum([row.contributionMinor,
      -rows.find(b => b.seed === row.seed && b.trajectoryId === input.baselineTrajectoryId)!.contributionMinor]),
  }));
  return { access: "evaluator_only" as const, version: TRAJECTORY_COMPARISON_VERSION,
    interpretation: seeds.length === 1 ? "single_seed_realized_counterfactuals" as const : "paired_seed_sample_estimates" as const,
    scope: "explicit_agents_future_booked_contribution_no_returns_no_clv_no_overhead" as const,
    currency: input.initial.merchantWorld.manifest.merchant.currency,
    actionSetVersion: input.actionSetVersion, baselineTrajectoryId: input.baselineTrajectoryId,
    decisionAt, evaluationEnd, simulations, consequences,
    summary: trajectories.map(t => ({ trajectoryId: t.trajectoryId, samples: seeds.length,
      meanDeltaVersusBaselineMinor: checkedSum(consequences.filter(r => r.trajectoryId === t.trajectoryId).map(r => r.deltaVersusBaselineMinor)) / seeds.length })),
    inputHash: sha256({ ...input, actions, trajectories, seeds }),
  };
}
