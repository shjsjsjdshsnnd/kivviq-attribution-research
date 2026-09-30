import { z } from "zod";
import { sha256 } from "./replay-manifest.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";

export const FINITE_ORACLE_VERSION = "finite-decision-oracle/1.2.0" as const;
const cost = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Costs are required, including zero. Platform revenue is not a valid outcome field. */
const economicsSchema = z.object({
  /** Net merchandise revenue AFTER discounts and refunds. */
  netSalesMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  cogsMinor: cost,
  paymentFeesMinor: cost,
  fulfillmentMinor: cost,
  shippingCostMinor: cost,
  variableOperatingCostMinor: cost,
  /** Total period paid spend, including spend on customers who did not convert. */
  paidSpendMinor: cost,
  /** All action-specific implementation costs, charged exactly once by the adapter. */
  actionCostMinor: cost,
}).strict();
export type OracleEconomics = z.infer<typeof economicsSchema>;
export interface OracleCandidate<Action> {
  readonly actionId: string;
  readonly action: Action;
}
export interface OracleEvaluationContext<Action> {
  readonly candidate: OracleCandidate<Action>;
  readonly seed: number;
  readonly horizon: { readonly start: string; readonly end: string };
}
export interface OracleRow {
  readonly actionId: string;
  readonly samples: number;
  readonly meanContributionMinor: number;
  readonly standardErrorMinor: number | null;
  readonly meanDeltaVersusBaselineMinor: number;
  readonly pairedDeltaStandardErrorMinor: number | null;
  readonly contributionBySeed: readonly { readonly seed: number; readonly contributionMinor: number }[];
}
export interface FiniteOracleResult {
  readonly version: typeof FINITE_ORACLE_VERSION;
  readonly access: "evaluator_only";
  readonly searchDomain: "supplied_finite_feasible_set";
  readonly actionSetVersion: string;
  readonly candidateSetHash: string;
  readonly scope: string;
  readonly currency: string;
  readonly horizon: { readonly start: string; readonly end: string };
  readonly method: "single_seed_realized" | "shared_seed_monte_carlo";
  readonly baselineActionId: string;
  readonly evaluatedActions: number;
  readonly evaluations: number;
  readonly seeds: readonly number[];
  readonly ranking: readonly OracleRow[];
  readonly bestActionId: string;
  readonly worstActionId: string;
}

export function oracleContribution(value: unknown): number {
  const e = economicsSchema.parse(value);
  const exact = BigInt(e.netSalesMinor) - BigInt(e.cogsMinor) - BigInt(e.paymentFeesMinor) - BigInt(e.fulfillmentMinor) -
    BigInt(e.shippingCostMinor) - BigInt(e.variableOperatingCostMinor) - BigInt(e.paidSpendMinor) - BigInt(e.actionCostMinor);
  if (exact < BigInt(-Number.MAX_SAFE_INTEGER) || exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("oracle economics exceed integer range");
  return Number(exact);
}
const integerSum = (values: readonly number[]): bigint => values.reduce((a, b) => a + BigInt(b), 0n);
const mean = (values: readonly number[]): number => Number(integerSum(values)) / values.length;
function standardError(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = values.reduce((a, b) => a + b / values.length, 0);
  return Math.sqrt(values.reduce((n, x) => n + (x - average) ** 2, 0) / (values.length - 1) / values.length);
}

/**
 * Finite-search harness, not a claim that the production simulator has a complete action oracle.
 * The caller MUST reset an identical latent world for each (action,seed), supply a complete
 * feasible action universe and return reconciled true economics. This module has no LLM input
 * path and is prohibited from Operator-facing imports. Single-seed values are realized,
 * not expectations. Multiple-seed values are estimates over this declared seed set.
 */
export async function evaluateFiniteActionSet<Action>(input: {
  readonly actionSetVersion: string;
  readonly universeComplete: boolean;
  readonly baselineActionId: string;
  readonly candidates: readonly OracleCandidate<Action>[];
  readonly seeds: readonly number[];
  readonly scope: string;
  readonly currency: string;
  readonly horizon: { readonly start: string; readonly end: string };
  readonly maximumEvaluations: number;
  readonly evaluate: (context: OracleEvaluationContext<Action>) => OracleEconomics | Promise<OracleEconomics>;
}): Promise<FiniteOracleResult> {
  const { evaluate, ...configuration } = input;
  input = { ...structuredClone(configuration), evaluate };
  if (!input.universeComplete || !input.actionSetVersion.trim() || !input.scope.trim()) throw new RangeError("complete versioned feasible universe and metric scope required");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new RangeError("explicit currency required");
  observationTimeSchema.parse(input.horizon.start);
  observationTimeSchema.parse(input.horizon.end);
  if (Date.parse(input.horizon.end) <= Date.parse(input.horizon.start)) throw new RangeError("oracle horizon must increase");
  if (input.candidates.length === 0 || input.candidates.some(c => !c.actionId.trim()) ||
      new Set(input.candidates.map(c => c.actionId)).size !== input.candidates.length ||
      !input.candidates.some(c => c.actionId === input.baselineActionId)) {
    throw new RangeError("unique candidate IDs and an explicit no-op/baseline candidate are required");
  }
  if (input.seeds.length === 0 || new Set(input.seeds).size !== input.seeds.length ||
      input.seeds.some(s => !Number.isSafeInteger(s) || s < 0)) throw new RangeError("unique non-negative seeds required");
  const evaluations = input.candidates.length * input.seeds.length;
  if (!Number.isSafeInteger(input.maximumEvaluations) || input.maximumEvaluations < 1 || evaluations > input.maximumEvaluations) {
    throw new RangeError("oracle evaluation budget cannot cover the complete action set");
  }
  const candidates = structuredClone(input.candidates);
  const seeds = [...input.seeds];
  const horizon = { start: input.horizon.start, end: input.horizon.end };
  const outcomes = new Map<string, number[]>();
  for (const candidate of candidates) {
    const values: number[] = [];
    for (const seed of seeds) {
      // A failed replay aborts the whole oracle; never quietly rank a smaller universe.
      values.push(oracleContribution(await input.evaluate({ candidate: structuredClone(candidate), seed, horizon: { ...horizon } })));
    }
    outcomes.set(candidate.actionId, values);
  }
  const baseline = outcomes.get(input.baselineActionId)!;
  const ranking = candidates.map((candidate): OracleRow => {
    const values = outcomes.get(candidate.actionId)!;
    const deltas = values.map((value, index) => Number(BigInt(value) - BigInt(baseline[index]!)));
    return { actionId: candidate.actionId, samples: seeds.length,
      meanContributionMinor: mean(values), standardErrorMinor: standardError(values),
      meanDeltaVersusBaselineMinor: Number(integerSum(values) - integerSum(baseline)) / seeds.length, pairedDeltaStandardErrorMinor: standardError(deltas),
      contributionBySeed: seeds.map((seed, index) => ({ seed, contributionMinor: values[index]! })) };
  }).sort((a, b) => {
    const gap = integerSum(outcomes.get(b.actionId)!) - integerSum(outcomes.get(a.actionId)!);
    return gap > 0n ? 1 : gap < 0n ? -1 : a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0;
  });
  return { version: FINITE_ORACLE_VERSION, access: "evaluator_only", searchDomain: "supplied_finite_feasible_set",
    actionSetVersion: input.actionSetVersion, candidateSetHash: finiteCandidateSetHash(candidates), scope: input.scope, currency: input.currency,
    horizon, method: seeds.length === 1 ? "single_seed_realized" : "shared_seed_monte_carlo",
    baselineActionId: input.baselineActionId, evaluatedActions: candidates.length, evaluations,
    seeds, ranking, bestActionId: ranking[0]!.actionId, worstActionId: ranking[ranking.length - 1]!.actionId };
}

export function decisionRegret(result: FiniteOracleResult, selectedActionId: string) {
  verifyFiniteOracleEvidence(result);
  const best = result.ranking[0];
  const selected = result.ranking.find(r => r.actionId === selectedActionId);
  if (!best || !selected) throw new RangeError("selected action is outside the evaluated feasible universe");
  return { selectedActionId, bestActionId: best.actionId,
    regretMinor: Number(integerSum(best.contributionBySeed.map(s => s.contributionMinor)) - integerSum(selected.contributionBySeed.map(s => s.contributionMinor))) / result.seeds.length,
    reference: result.method === "single_seed_realized" ? "realized_seed_optimum" as const : "in_sample_finite_set_estimate" as const,
    /** Independent held-out seeds are still required before calling this expected regret. */
    expectedRegretVerified: false as const };
}

/** Binds action payloads as well as IDs; input order does not affect the signature. */
export function finiteCandidateSetHash<Action>(candidates: readonly OracleCandidate<Action>[]): string {
  return sha256([...candidates].sort((a, b) => a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0));
}

/** Reconcile a stored result from its paired integer outcomes before scoring it. */
export function verifyFiniteOracleEvidence(result: FiniteOracleResult): void {
  if (result.version !== FINITE_ORACLE_VERSION || result.access !== "evaluator_only" ||
      result.seeds.length === 0 || new Set(result.seeds).size !== result.seeds.length ||
      result.seeds.some(s => !Number.isSafeInteger(s) || s < 0) || result.ranking.length !== result.evaluatedActions ||
      result.evaluations !== result.seeds.length * result.evaluatedActions ||
      new Set(result.ranking.map(r => r.actionId)).size !== result.ranking.length ||
      result.method !== (result.seeds.length === 1 ? "single_seed_realized" : "shared_seed_monte_carlo")) throw new RangeError("invalid paired oracle evidence");
  const baseline = result.ranking.find(r => r.actionId === result.baselineActionId);
  if (!baseline) throw new RangeError("missing baseline evidence");
  for (const row of result.ranking) {
    if (row.samples !== result.seeds.length || row.contributionBySeed.length !== result.seeds.length ||
        row.contributionBySeed.some((s, i) => s.seed !== result.seeds[i] || !Number.isSafeInteger(s.contributionMinor))) throw new RangeError("invalid per-seed oracle evidence");
    const values = row.contributionBySeed.map(s => s.contributionMinor), base = baseline.contributionBySeed.map(s => s.contributionMinor);
    const deltas = values.map((v, i) => Number(BigInt(v) - BigInt(base[i]!)));
    if (row.meanContributionMinor !== mean(values) || row.meanDeltaVersusBaselineMinor !== Number(integerSum(values) - integerSum(base)) / values.length ||
        row.standardErrorMinor !== standardError(values) || row.pairedDeltaStandardErrorMinor !== standardError(deltas)) throw new RangeError("oracle summary does not reconcile with paired outcomes");
  }
  const order = [...result.ranking].sort((a, b) => {
    const gap = integerSum(b.contributionBySeed.map(s => s.contributionMinor)) - integerSum(a.contributionBySeed.map(s => s.contributionMinor));
    return gap > 0n ? 1 : gap < 0n ? -1 : a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0;
  });
  if (order.some((r, i) => r.actionId !== result.ranking[i]?.actionId) || result.bestActionId !== order[0]?.actionId || result.worstActionId !== order.at(-1)?.actionId) {
    throw new RangeError("oracle ranking does not match paired outcomes");
  }
}
