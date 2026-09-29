import { z } from "zod";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { oracleContribution, finiteCandidateSetHash, type OracleCandidate, type OracleEconomics } from "./finite-decision-oracle.js";
import { canonicalJson, sha256 } from "./replay-manifest.js";

export const EXACT_ORACLE_VERSION = "finite-support-decision-oracle/1.0.0" as const;
export interface WeightedWorld<World> {
  readonly outcomeId: string;
  /** Positive integer probability mass; probability = weight / sum(weights). */
  readonly weight: number;
  readonly world: World;
}
export interface ExactOracleInput<Action, World, Parameters> {
  readonly modelVersion: string;
  readonly modelParameters: Parameters;
  readonly actionSetVersion: string;
  readonly completeActionSet: boolean;
  readonly completeOutcomeSupport: boolean;
  readonly baselineActionId: string;
  readonly candidates: readonly OracleCandidate<Action>[];
  readonly outcomes: readonly WeightedWorld<World>[];
  readonly currency: string;
  readonly scope: string;
  readonly horizon: { readonly start: string; readonly end: string };
  readonly maximumEvaluations: number;
  readonly evaluate: (input: { action: Action; world: World; parameters: Parameters }) => OracleEconomics | Promise<OracleEconomics>;
}
export interface ExactOracleRow {
  readonly actionId: string;
  /** Exact numerator in minor-unit probability mass. All rows share denominator. */
  readonly weightedContribution: string;
  readonly weightedDeltaVersusBaseline: string;
  readonly expectedContributionMinor: number;
  readonly expectedDeltaVersusBaselineMinor: number;
}
export interface ExactOracleResult {
  readonly access: "evaluator_only";
  readonly version: typeof EXACT_ORACLE_VERSION;
  readonly reference: "exact_expectation_over_declared_complete_finite_model";
  readonly modelVersion: string;
  readonly actionSetVersion: string;
  readonly inputHash: string;
  readonly candidateSetHash: string;
  readonly currency: string;
  readonly scope: string;
  readonly horizon: { readonly start: string; readonly end: string };
  readonly baselineActionId: string;
  readonly probabilityDenominator: string;
  readonly evaluations: number;
  readonly bestActionId: string;
  readonly worstActionId: string;
  readonly tiedBestActionIds: readonly string[];
  readonly ranking: readonly ExactOracleRow[];
  readonly ledger: readonly { readonly actionId: string; readonly outcomeId: string; readonly weight: number;
    readonly economics: OracleEconomics; readonly contributionMinor: number }[];
  /** Integrity, not authenticity. Keep the full artifact on the evaluator side. */
  readonly resultHash: string;
}
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const safePositive = (n: number) => Number.isSafeInteger(n) && n > 0;

/**
 * Exhaust all actions AND all exogenous states. Unlike a Monte Carlo maximum,
 * this gives an exact expectation conditional on the supplied finite model.
 * Completeness of that model's support must be established by its registered
 * builder; enumerating a convenient sample does not make it a population.
 * No scores are supplied: each branch returns independently reconciled economics.
 */
export async function evaluateExactActionSet<Action, World, Parameters>(
  raw: ExactOracleInput<Action, World, Parameters>,
): Promise<ExactOracleResult> {
  const { evaluate, ...data } = raw;
  canonicalJson(data);
  const input = structuredClone(data);
  const candidates = [...input.candidates].sort((a, b) => textOrder(a.actionId, b.actionId));
  const outcomes = [...input.outcomes].sort((a, b) => textOrder(a.outcomeId, b.outcomeId));
  if (!input.completeActionSet || !input.completeOutcomeSupport || !input.modelVersion.trim() ||
      !input.actionSetVersion.trim() || !input.scope.trim() || !/^[A-Z]{3}$/.test(input.currency)) {
    throw new RangeError("complete finite model, action universe, scope and currency required");
  }
  observationTimeSchema.parse(input.horizon.start); observationTimeSchema.parse(input.horizon.end);
  if (Date.parse(input.horizon.start) >= Date.parse(input.horizon.end) || candidates.length === 0 || outcomes.length === 0 ||
      new Set(candidates.map(c => c.actionId)).size !== candidates.length || candidates.some(c => !c.actionId.trim()) ||
      !candidates.some(c => c.actionId === input.baselineActionId) ||
      new Set(outcomes.map(o => o.outcomeId)).size !== outcomes.length || outcomes.some(o => !o.outcomeId.trim() || !safePositive(o.weight))) {
    throw new RangeError("unique complete actions/outcomes, positive integer masses and an increasing horizon required");
  }
  const evaluations = candidates.length * outcomes.length;
  if (!safePositive(evaluations) || !safePositive(input.maximumEvaluations) || input.maximumEvaluations < evaluations) {
    throw new RangeError("budget does not cover complete enumeration");
  }
  const denominator = outcomes.reduce((n, o) => n + BigInt(o.weight), 0n);
  const ledger: ExactOracleResult["ledger"][number][] = [];
  const totals = new Map<string, bigint>();
  for (const candidate of candidates) {
    let weighted = 0n;
    for (const outcome of outcomes) {
      // Copies prevent callback mutation from contaminating another branch.
      const economics = structuredClone(await evaluate({ action: structuredClone(candidate.action),
        world: structuredClone(outcome.world), parameters: structuredClone(input.modelParameters) }));
      const contributionMinor = oracleContribution(economics);
      weighted += BigInt(outcome.weight) * BigInt(contributionMinor);
      ledger.push({ actionId: candidate.actionId, outcomeId: outcome.outcomeId, weight: outcome.weight, economics, contributionMinor });
    }
    totals.set(candidate.actionId, weighted);
  }
  const baseline = totals.get(input.baselineActionId)!;
  const ranking = candidates.map(({ actionId }): ExactOracleRow => ({ actionId,
    weightedContribution: totals.get(actionId)!.toString(),
    weightedDeltaVersusBaseline: (totals.get(actionId)! - baseline).toString(),
    // Display approximations only. Ranking and regret below use integer arithmetic.
    expectedContributionMinor: Number(totals.get(actionId)!) / Number(denominator),
    expectedDeltaVersusBaselineMinor: Number(totals.get(actionId)! - baseline) / Number(denominator),
  })).sort((a, b) => {
    const difference = BigInt(b.weightedContribution) - BigInt(a.weightedContribution);
    return difference > 0n ? 1 : difference < 0n ? -1 : textOrder(a.actionId, b.actionId);
  });
  const payload = { access: "evaluator_only" as const, version: EXACT_ORACLE_VERSION,
    reference: "exact_expectation_over_declared_complete_finite_model" as const,
    modelVersion: input.modelVersion, actionSetVersion: input.actionSetVersion,
    inputHash: sha256({ ...input, candidates, outcomes }), candidateSetHash: finiteCandidateSetHash(candidates),
    currency: input.currency, scope: input.scope, horizon: input.horizon, baselineActionId: input.baselineActionId,
    probabilityDenominator: denominator.toString(), evaluations, bestActionId: ranking[0]!.actionId,
    worstActionId: ranking.at(-1)!.actionId,
    tiedBestActionIds: ranking.filter(r => r.weightedContribution === ranking[0]!.weightedContribution).map(r => r.actionId),
    ranking, ledger };
  return { ...payload, resultHash: sha256(payload) };
}

/** Exact expected regret; not mean(per-state best) minus the selected action. */
export function exactDecisionRegret(result: ExactOracleResult, selectedActionId: string) {
  verifyExactOracleEvidence(result);
  const selected = result.ranking.find(r => r.actionId === selectedActionId);
  if (!selected) throw new RangeError("selected action is outside the enumerated action set");
  const numerator = BigInt(result.ranking[0]!.weightedContribution) - BigInt(selected.weightedContribution);
  const denominator = BigInt(result.probabilityDenominator);
  if (numerator < 0n || denominator <= 0n) throw new RangeError("invalid exact oracle ranking");
  return { access: "evaluator_only" as const, selectedActionId, bestActionId: result.bestActionId,
    currency: result.currency, scope: result.scope, horizon: result.horizon,
    exactRegretMinor: { numerator: numerator.toString(), denominator: denominator.toString() },
    regretMinor: Number(numerator) / Number(denominator),
    reference: result.reference, expectedRegretVerifiedWithinDeclaredModel: true as const };
}

/** Runtime validator for reusable integer-grid searches; no continuous-optimum claim. */
export function finiteIntegerGrid(minimum: number, maximum: number, increment: number, limit = 10000): readonly number[] {
  z.number().int().safe().parse(minimum); z.number().int().safe().parse(maximum);
  if (!safePositive(increment) || !safePositive(limit) || maximum < minimum) throw new RangeError("invalid finite grid");
  const distance = BigInt(maximum) - BigInt(minimum), step = BigInt(increment);
  if (distance % step !== 0n) throw new RangeError("grid endpoint is not reachable; refuse silent truncation");
  const count = distance / step + 1n;
  if (count > BigInt(limit)) throw new RangeError("finite grid exceeds registered search budget");
  return Array.from({ length: Number(count) }, (_, i) => Number(BigInt(minimum) + BigInt(i) * step));
}

/** Recompute a stored exact ranking from every outcome's independently reconciled economics. */
export function verifyExactOracleEvidence(result: ExactOracleResult): void {
  const { resultHash, ...payload } = result;
  if (resultHash !== sha256(payload)) throw new RangeError("oracle artifact integrity mismatch");
  if (result.version !== EXACT_ORACLE_VERSION || result.access !== "evaluator_only" ||
      result.reference !== "exact_expectation_over_declared_complete_finite_model" ||
      result.ranking.length === 0 || new Set(result.ranking.map(r => r.actionId)).size !== result.ranking.length ||
      result.ranking.some(r => !r.actionId.trim()) || result.ledger.length !== result.evaluations) throw new RangeError("invalid exact oracle evidence");
  const weights = new Map<string, number>();
  const totals = new Map<string, bigint>(result.ranking.map(r => [r.actionId, 0n]));
  const pairs = new Set<string>();
  for (const row of result.ledger) {
    const pair = JSON.stringify([row.actionId, row.outcomeId]);
    if (!totals.has(row.actionId) || !row.outcomeId.trim() || !safePositive(row.weight) || pairs.has(pair) ||
        (weights.has(row.outcomeId) && weights.get(row.outcomeId) !== row.weight) || oracleContribution(row.economics) !== row.contributionMinor) {
      throw new RangeError("invalid exact outcome ledger");
    }
    pairs.add(pair); weights.set(row.outcomeId, row.weight);
    totals.set(row.actionId, totals.get(row.actionId)! + BigInt(row.weight) * BigInt(row.contributionMinor));
  }
  const denominator = [...weights.values()].reduce((a, b) => a + BigInt(b), 0n), baseline = totals.get(result.baselineActionId);
  if (denominator <= 0n || denominator.toString() !== result.probabilityDenominator || baseline === undefined ||
      result.evaluations !== totals.size * weights.size) throw new RangeError("incomplete exact action/outcome evidence");
  const expected = [...totals].sort(([a, av], [b, bv]) => av > bv ? -1 : av < bv ? 1 : textOrder(a, b));
  for (const [i, [actionId, total]] of expected.entries()) {
    const row = result.ranking[i]!;
    if (row.actionId !== actionId || row.weightedContribution !== total.toString() ||
        row.weightedDeltaVersusBaseline !== (total - baseline).toString() ||
        row.expectedContributionMinor !== Number(total) / Number(denominator) ||
        row.expectedDeltaVersusBaselineMinor !== Number(total - baseline) / Number(denominator)) throw new RangeError("exact ranking does not reconcile with outcome ledger");
  }
  if (result.bestActionId !== expected[0]![0] || result.worstActionId !== expected.at(-1)![0] ||
      canonicalJson(result.tiedBestActionIds) !== canonicalJson(expected.filter(([, total]) => total === expected[0]![1]).map(([id]) => id))) {
    throw new RangeError("invalid exact best/worst/tie evidence");
  }
}
