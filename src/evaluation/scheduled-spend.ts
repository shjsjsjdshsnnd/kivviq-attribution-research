import { z } from "zod";
import { utcTimestamp } from "../core/units.js";
import type { Intervention } from "../ground_truth/interventions.js";
import { validateIntervention } from "../ground_truth/interventions.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import type { PerfectObservableWorld } from "../measurement_corruption/index.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { SCENARIO_PAID_CHANNELS, type ScenarioAllocation, type ScenarioPaidChannel } from "./scenario-spend.js";

/** Evaluator-only time-based spend authority; not an auction-fill model. */
export const SCHEDULED_SPEND_VERSION = "scheduled-spend/1.0.0" as const;
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const allocation = z.object({ meta: money, google_search: money, google_shopping: money, pinterest: money, affiliate: money }).strict();
export const budgetAdjustmentSchema = z.object({
  channel: z.enum(SCENARIO_PAID_CHANNELS),
  operation: z.enum(["set", "delta"]),
  /** Minor units per the plan's fixed referencePeriodMs, NOT a one-off debit. */
  amountMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
}).strict();
export type BudgetAdjustment = z.infer<typeof budgetAdjustmentSchema>;
const changeSchema = z.object({
  decisionId: z.string().min(1), effectiveAt: observationTimeSchema, allocation,
}).strict();
export type ScheduledBudgetChange = z.infer<typeof changeSchema>;
const planSchema = z.object({
  version: z.literal(SCHEDULED_SPEND_VERSION),
  periodStart: observationTimeSchema, periodEnd: observationTimeSchema,
  referencePeriodMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  execution: z.literal("fully_spent_time_prorated_allocation"),
  scope: z.literal("explicit_simulated_agents"),
  initialAllocation: allocation,
  changes: z.array(changeSchema).max(10000),
}).strict();
export type ScheduledSpendPlan = z.infer<typeof planSchema>;
export interface ScheduledSpendDebit {
  readonly id: string; readonly channel: ScenarioPaidChannel;
  readonly occurredAt: string; readonly amountMinor: number;
}

export function validateScheduledSpend(value: unknown): ScheduledSpendPlan {
  const plan = planSchema.parse(value);
  const start = Date.parse(plan.periodStart), end = Date.parse(plan.periodEnd);
  if (end <= start || end - start > 3660 * 86400000) throw new RangeError("scheduled spend horizon must be positive and at most ten years");
  let previous = start;
  const ids = new Set<string>();
  for (const change of plan.changes) {
    const time = Date.parse(change.effectiveAt);
    if (time <= previous || time >= end || ids.has(change.decisionId)) throw new RangeError("budget changes require unique decisions and strictly increasing in-window times");
    ids.add(change.decisionId); previous = time;
  }
  return plan;
}

export function applyBudgetAdjustments(current: ScenarioAllocation, adjustments: readonly BudgetAdjustment[]): ScenarioAllocation {
  const next = allocation.parse(current);
  const channels = new Set<ScenarioPaidChannel>();
  for (const raw of adjustments) {
    const change = budgetAdjustmentSchema.parse(raw);
    if (channels.has(change.channel)) throw new RangeError("one adjustment per channel per decision required");
    channels.add(change.channel);
    const value = change.operation === "set" ? change.amountMinor : next[change.channel] + change.amountMinor;
    next[change.channel] = money.parse(value);
  }
  return next;
}

/**
 * Spend accrues independently of conversion and is reported in closed daily buckets.
 * Integer-ms rate integration and cumulative BigInt division conserve every cent.
 * A bucket becomes available at its final integer millisecond: future budget changes
 * cannot alter an already delivered debit, even when changes occur inside a day.
 * No fractional open-bucket spend is represented as already measured expenditure.
 */
export function scheduledSpendLedger(input: unknown): readonly ScheduledSpendDebit[] {
  const plan = validateScheduledSpend(input);
  const start = Date.parse(plan.periodStart), end = Date.parse(plan.periodEnd);
  const changes = plan.changes.map(c => ({ time: Date.parse(c.effectiveAt), allocation: c.allocation }));
  const reference = BigInt(plan.referencePeriodMs);
  const entries: ScheduledSpendDebit[] = [];
  let total = 0n;
  for (const channel of SCENARIO_PAID_CHANNELS) {
    let pointer = 0, rate = plan.initialAllocation[channel], integral = 0n, charged = 0n;
    for (let open = start, bucket = 0; open < end; open += 86400000, bucket += 1) {
      const close = Math.min(end, open + 86400000);
      let cursor = open;
      while (pointer < changes.length && changes[pointer]!.time < close) {
        const change = changes[pointer]!;
        integral += BigInt(rate) * BigInt(change.time - cursor);
        cursor = change.time; rate = change.allocation[channel]; pointer += 1;
      }
      integral += BigInt(rate) * BigInt(close - cursor);
      const cumulative = integral / reference;
      const debit = cumulative - charged;
      if (cumulative > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("scheduled spend exceeds safe integer range");
      if (debit > 0n) entries.push({ id: `scheduled:${channel}:${start}:${bucket}`, channel,
        occurredAt: new Date(close - 1).toISOString(), amountMinor: Number(debit) });
      charged = cumulative;
    }
    total += charged;
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("total scheduled spend exceeds safe integer range");
  return entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

export function scheduledMeasurementSpend(input: unknown): PerfectObservableWorld["spend"] {
  return scheduledSpendLedger(input).flatMap(debit => {
    const platform = debit.channel === "meta" ? "meta" as const
      : debit.channel === "google_search" || debit.channel === "google_shopping" ? "google" as const : undefined;
    return platform === undefined ? [] : [{ id: debit.id, platform, occurredAt: debit.occurredAt, amountMinor: debit.amountMinor }];
  });
}

/**
 * The simulator's spend coefficient is a whole-episode allocation. Rates are normalized
 * against that fixed episode once; the reference interval stays fixed through replay.
 * Only the currently active coefficient changes;
 * neither shortening the as-of window nor choosing an action rescales earlier spend.
 */
export function requestWithScheduledSpend(input: SimulateWorldRequest, rawPlan: unknown): SimulateWorldRequest {
  const plan = validateScheduledSpend(rawPlan), request = structuredClone(input);
  if (request.startTime !== plan.periodStart || request.endTime !== plan.periodEnd) throw new RangeError("scheduled spend/request windows differ");
  if ((request.interventions ?? []).some(i => /^marketing\..*\.spend$/.test(i.variable))) throw new RangeError("scheduled spend has two competing authorities");
  const active = new Set(request.merchantWorld.summary.activeChannels);
  const horizonMs = BigInt(Date.parse(plan.periodEnd) - Date.parse(plan.periodStart));
  const referenceMs = BigInt(plan.referencePeriodMs);
  const responseCoefficient = (amountMinor: number): number => {
    const scaled = BigInt(amountMinor) * horizonMs;
    // The legacy response curve is calibrated in whole-episode minor units.
    // Normalize the rate once against the fixed episode, never against asOf.
    if (scaled % referenceMs !== 0n || scaled / referenceMs > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("budget rate is not representable as an integer episode allocation");
    }
    return Number(scaled / referenceMs);
  };
  const interventions: Intervention[] = [];
  for (const state of [{ effectiveAt: plan.periodStart, allocation: plan.initialAllocation }, ...plan.changes]) {
    for (const channel of SCENARIO_PAID_CHANNELS) {
      if (!active.has(channel)) {
        if (state.allocation[channel] !== 0) throw new RangeError("scheduled budget assigned to an inactive channel");
        continue;
      }
      const intervention: Intervention = { variable: `marketing.${channel}.spend`, operation: "set",
        effectiveAt: utcTimestamp(state.effectiveAt), value: { kind: "number", value: responseCoefficient(state.allocation[channel]), unit: "money_minor" } };
      validateIntervention(request.merchantWorld.manifest.causalGraph, intervention);
      interventions.push(intervention);
    }
  }
  // Force overflow validation even when the caller does not request observed reporting.
  scheduledSpendLedger(plan);
  return { ...request, interventions: [...(request.interventions ?? []), ...interventions] };
}
