import { validateIntervention, type Intervention } from "../ground_truth/interventions.js";
import { utcTimestamp } from "../core/units.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { measurePerfectWorld } from "../measurement_corruption/index.js";
import { parseOperatorObservation, type CorruptedObservation } from "../observation/corrupted-world.js";
import { runMeasuredWorld, type MeasurementRunOptions, type EvaluatorWorldBundle } from "./measured-world.js";
import { sha256 } from "./replay-manifest.js";
import { applyBudgetAdjustments, budgetAdjustmentSchema, requestWithScheduledSpend,
  scheduledMeasurementSpend, scheduledSpendLedger, validateScheduledSpend,
  type BudgetAdjustment, type ScheduledSpendPlan, type ScheduledBudgetChange } from "./scheduled-spend.js";

export const INTERACTIVE_WORLD_VERSION = "interactive-replay-world/0.2.0" as const;
export interface RegisteredSimulatorAction {
  readonly actionId: string;
  /** Existing simulator interventions, not a replacement BusinessAction ontology. */
  readonly interventions: readonly Intervention[];
  /** Separate budget authority; raw marketing interventions remain prohibited. */
  readonly budgetAdjustments?: readonly BudgetAdjustment[];
}
export interface ObservedWorldHandle {
  observe(): CorruptedObservation;
  step(actionId: string): CorruptedObservation;
}

/**
 * Evaluator-owned correctness-first replay implementation. It replays the frozen
 * initial population and complete action history; it is NOT a checkpoint engine.
 * Only observedHandle() may be bound to an isolated Operator JSON/RPC endpoint.
 * Never hand this evaluator class or its constructor inputs to the Operator.
 */
export class InteractiveReplayWorld {
  readonly #initial: SimulateWorldRequest;
  readonly #measurement: Omit<MeasurementRunOptions, "asOf">;
  readonly #actions: ReadonlyMap<string, RegisteredSimulatorAction>;
  readonly #stepMs: number;
  #seed: number;
  #nowMs: number;
  #history: Intervention[] = [];
  readonly #spendPlan: ScheduledSpendPlan | undefined;
  #budgetHistory: ScheduledBudgetChange[] = [];
  #bundle: EvaluatorWorldBundle;

  constructor(input: {
    readonly initial: SimulateWorldRequest;
    readonly measurement: Omit<MeasurementRunOptions, "asOf">;
    readonly actions: readonly RegisteredSimulatorAction[];
    readonly stepMs: number;
    /** Initial schedule must have no decisions; the evaluator owns all future changes. */
    readonly spendPlan?: ScheduledSpendPlan;
  }) {
    if (!Number.isSafeInteger(input.stepMs) || input.stepMs <= 0) throw new RangeError("positive integer step size required");
    const actions = structuredClone(input.actions);
    if (actions.length === 0 || new Set(actions.map(a => a.actionId)).size !== actions.length ||
        actions.some(a => !a.actionId.trim()) || !actions.some(a => a.interventions.length === 0 && (a.budgetAdjustments?.length ?? 0) === 0)) {
      throw new RangeError("unique registered actions and a no-op are required");
    }
    const plan = input.spendPlan === undefined ? undefined : validateScheduledSpend(input.spendPlan);
    if (plan !== undefined) {
      if (plan.changes.length !== 0 || input.measurement.platformSpend.length !== 0) throw new RangeError("initial schedule must be empty of changes and sole spend authority");
      requestWithScheduledSpend(input.initial, plan);
    }
    for (const action of actions) {
      const adjustments = action.budgetAdjustments ?? [];
      if (adjustments.length > 0 && plan === undefined) throw new RangeError("budget adjustments require a scheduled actual-spend adapter");
      const channels = new Set<string>();
      for (const adjustment of adjustments) {
        budgetAdjustmentSchema.parse(adjustment);
        if (channels.has(adjustment.channel) || !input.initial.merchantWorld.summary.activeChannels.includes(adjustment.channel)) throw new RangeError("budget adjustment requires a unique active channel");
        channels.add(adjustment.channel);
        if (adjustment.operation === "set" && adjustment.amountMinor < 0) throw new RangeError("budget set cannot be negative");
      }
    }
    for (const action of actions) for (const intervention of action.interventions) {
      validateIntervention(input.initial.merchantWorld.manifest.causalGraph, intervention);
      if (intervention.effectiveAt !== undefined || intervention.durationSeconds !== undefined || intervention.population !== undefined) {
        throw new RangeError("this replay adapter schedules unscoped actions at its own clock");
      }
      if (intervention.variable.startsWith("marketing.")) {
        // The inherited simulator allocates spend as a revenue-rate proxy. That
        // is insufficient to generate truthful budget-change accounting.
        throw new RangeError("budget actions require an actual-spend adapter; not yet supported here");
      }
      if (!["pricing.product_price", "promotion.discount_active", "inventory.available"].includes(intervention.variable)) {
        throw new RangeError("action target is not supported by this replay adapter");
      }
    }
    this.#spendPlan = plan;
    this.#initial = structuredClone(input.initial);
    this.#measurement = structuredClone(input.measurement);
    this.#actions = new Map(actions.map(a => [a.actionId, a]));
    this.#stepMs = input.stepMs;
    this.#seed = input.initial.simulationSeed;
    this.#nowMs = Date.parse(input.initial.startTime);
    this.#bundle = this.#run(this.#history, this.#nowMs, this.#seed);
  }

  #run(history: readonly Intervention[], nowMs: number, seed: number,
    budgetHistory: readonly ScheduledBudgetChange[] = []): EvaluatorWorldBundle {
    const initial = { ...this.#initial, simulationSeed: seed,
      interventions: [...(this.#initial.interventions ?? []), ...history] };
    const plan = this.#spendPlan === undefined ? undefined : { ...this.#spendPlan, changes: [...budgetHistory] };
    const request = plan === undefined ? initial : requestWithScheduledSpend(initial, plan);
    return runMeasuredWorld(request, { ...this.#measurement,
      platformSpend: plan === undefined ? this.#measurement.platformSpend : scheduledMeasurementSpend(plan),
      asOf: new Date(nowMs).toISOString() });
  }

  observe(): CorruptedObservation {
    return parseOperatorObservation(this.#bundle.corruptedObservation);
  }

  step(actionId: string): CorruptedObservation {
    const action = this.#actions.get(actionId);
    if (!action) throw new RangeError("unregistered action");
    const endMs = Date.parse(this.#initial.endTime);
    if (this.#nowMs >= endMs) throw new RangeError("world horizon exhausted");
    const nextMs = Math.min(endMs, this.#nowMs + this.#stepMs);
    // Observations are inclusive at asOf. New actions start one millisecond later,
    // never changing an event that has already been delivered at the old cutoff.
    const additions = action.interventions.map((intervention): Intervention => ({
      ...intervention, effectiveAt: utcTimestamp(new Date(this.#nowMs + 1).toISOString()),
    }));
    const history = [...this.#history, ...additions];
    let budgetHistory = [...this.#budgetHistory];
    const adjustments = action.budgetAdjustments ?? [];
    if (adjustments.length > 0) {
      const effectiveMs = this.#nowMs + 1;
      if (this.#spendPlan === undefined || effectiveMs >= endMs) throw new RangeError("budget decision has no executable interval");
      const current = budgetHistory.at(-1)?.allocation ?? this.#spendPlan.initialAllocation;
      const allocation = applyBudgetAdjustments(current, adjustments);
      budgetHistory.push({ decisionId: `decision:${effectiveMs}`, effectiveAt: new Date(effectiveMs).toISOString(), allocation });
    }
    const candidate = this.#run(history, nextMs, this.#seed, budgetHistory);
    const previousView = measurePerfectWorld(candidate.perfectObservableTruth, this.#measurement.corruption,
      new Date(this.#nowMs).toISOString()).observation;
    if (sha256(previousView) !== sha256(this.#bundle.corruptedObservation)) {
      throw new RangeError("action replay changed an already observed past; world not advanced");
    }
    // Commit only after a successful replay and invariance check.
    this.#history = history;
    this.#budgetHistory = budgetHistory;
    this.#nowMs = nextMs;
    this.#bundle = candidate;
    return this.observe();
  }

  /** Reset simulation randomness; merchant/customer/external/measurement inputs stay fixed. */
  reset(seed = this.#initial.simulationSeed): CorruptedObservation {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError("invalid reset seed");
    const nowMs = Date.parse(this.#initial.startTime);
    const candidate = this.#run([], nowMs, seed);
    this.#seed = seed;
    this.#nowMs = nowMs;
    this.#history = [];
    this.#budgetHistory = [];
    this.#bundle = candidate;
    return this.observe();
  }

  /** Evaluator-only diagnostics. Returned copies cannot mutate the live world. */
  evaluatorSnapshot(): EvaluatorWorldBundle { return structuredClone(this.#bundle); }

  /** Evaluator-only accrued and future schedule; never exposed through observedHandle(). */
  evaluatorSpendSnapshot(): { readonly plan: ScheduledSpendPlan; readonly debits: ReturnType<typeof scheduledSpendLedger> } | undefined {
    if (this.#spendPlan === undefined) return undefined;
    const plan = { ...this.#spendPlan, changes: structuredClone(this.#budgetHistory) };
    return structuredClone({ plan, debits: scheduledSpendLedger(plan) });
  }

  observedHandle(): ObservedWorldHandle {
    const guarded = (operation: () => unknown): CorruptedObservation => {
      try { return parseOperatorObservation(operation()); }
      catch (error) {
        if (error instanceof RangeError && ["unregistered action", "world horizon exhausted"].includes(error.message)) {
          throw new RangeError(error.message);
        }
        // Never attach a cause or serialize simulator exceptions: those may
        // contain latent identifiers, coefficients, seeds or hidden diagnostics.
        throw new Error("OBSERVED_WORLD_OPERATION_FAILED");
      }
    };
    return Object.freeze({
      observe: () => guarded(() => this.observe()),
      step: (actionId: string) => guarded(() => this.step(actionId)),
    });
  }
}
