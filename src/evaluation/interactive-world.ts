import { validateIntervention, type Intervention } from "../ground_truth/interventions.js";
import { utcTimestamp } from "../core/units.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { measurePerfectWorld } from "../measurement_corruption/index.js";
import { parseOperatorObservation, type CorruptedObservation } from "../observation/corrupted-world.js";
import { runMeasuredWorld, type MeasurementRunOptions, type EvaluatorWorldBundle } from "./measured-world.js";
import { sha256 } from "./replay-manifest.js";

export const INTERACTIVE_WORLD_VERSION = "interactive-replay-world/0.1.0" as const;
export interface RegisteredSimulatorAction {
  readonly actionId: string;
  /** Existing simulator interventions, not a replacement BusinessAction ontology. */
  readonly interventions: readonly Intervention[];
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
  #bundle: EvaluatorWorldBundle;

  constructor(input: {
    readonly initial: SimulateWorldRequest;
    readonly measurement: Omit<MeasurementRunOptions, "asOf">;
    readonly actions: readonly RegisteredSimulatorAction[];
    readonly stepMs: number;
  }) {
    if (!Number.isSafeInteger(input.stepMs) || input.stepMs <= 0) throw new RangeError("positive integer step size required");
    const actions = structuredClone(input.actions);
    if (actions.length === 0 || new Set(actions.map(a => a.actionId)).size !== actions.length ||
        actions.some(a => !a.actionId.trim()) || !actions.some(a => a.interventions.length === 0)) {
      throw new RangeError("unique registered actions and a no-op are required");
    }
    for (const action of actions) for (const intervention of action.interventions) {
      validateIntervention(input.initial.merchantWorld.manifest.causalGraph, intervention);
      if (intervention.effectiveAt !== undefined || intervention.population !== undefined) {
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
    this.#initial = structuredClone(input.initial);
    this.#measurement = structuredClone(input.measurement);
    this.#actions = new Map(actions.map(a => [a.actionId, a]));
    this.#stepMs = input.stepMs;
    this.#seed = input.initial.simulationSeed;
    this.#nowMs = Date.parse(input.initial.startTime);
    this.#bundle = this.#run(this.#history, this.#nowMs, this.#seed);
  }

  #run(history: readonly Intervention[], nowMs: number, seed: number): EvaluatorWorldBundle {
    return runMeasuredWorld({
      ...this.#initial, simulationSeed: seed,
      interventions: [...(this.#initial.interventions ?? []), ...history],
    }, { ...this.#measurement, asOf: new Date(nowMs).toISOString() });
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
    const candidate = this.#run(history, nextMs, this.#seed);
    const previousView = measurePerfectWorld(candidate.perfectObservableTruth, this.#measurement.corruption,
      new Date(this.#nowMs).toISOString()).observation;
    if (sha256(previousView) !== sha256(this.#bundle.corruptedObservation)) {
      throw new RangeError("action replay changed an already observed past; world not advanced");
    }
    // Commit only after a successful replay and invariance check.
    this.#history = history;
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
    this.#bundle = candidate;
    return this.observe();
  }

  /** Evaluator-only diagnostics. Returned copies cannot mutate the live world. */
  evaluatorSnapshot(): EvaluatorWorldBundle { return structuredClone(this.#bundle); }

  observedHandle(): ObservedWorldHandle {
    return Object.freeze({ observe: () => this.observe(), step: (actionId: string) => this.step(actionId) });
  }
}
