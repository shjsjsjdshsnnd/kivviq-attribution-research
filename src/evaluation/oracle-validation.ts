import { evaluateFiniteActionSet, finiteCandidateSetHash, type FiniteOracleResult, type OracleCandidate,
  type OracleEconomics, type OracleEvaluationContext } from "./finite-decision-oracle.js";

export interface PolicyValidationRow {
  readonly actionId: string;
  readonly pairedMeanGapMinor: number;
  readonly pairedStandardErrorMinor: number | null;
}
/**
 * A fresh seed set checks a PRESELECTED action. The training winner is not
 * reselected from validation outcomes. The validation maximum is explicitly
 * an in-sample reference, not a proof of the true expected optimum.
 */
export async function validateFiniteDecision<Action>(input: {
  readonly training: FiniteOracleResult;
  readonly selectedActionId: string;
  readonly candidates: readonly OracleCandidate<Action>[];
  readonly validationSeeds: readonly number[];
  readonly validationSetId: string;
  readonly maximumEvaluations: number;
  readonly evaluate: (context: OracleEvaluationContext<Action>) => OracleEconomics | Promise<OracleEconomics>;
}) {
  const training = input.training;
  if (!input.validationSetId.trim()) throw new RangeError("named validation seed set required");
  const expectedIds = training.ranking.map(r => r.actionId).sort();
  const actualIds = input.candidates.map(c => c.actionId).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds) || !expectedIds.includes(input.selectedActionId) ||
      training.candidateSetHash !== finiteCandidateSetHash(input.candidates)) {
    throw new RangeError("validation must use the identical complete action universe");
  }
  if (input.validationSeeds.some(s => training.seeds.includes(s))) throw new RangeError("training and validation seeds must be disjoint");
  // Snapshot before awaiting any user-supplied evaluator. Later mutation cannot
  // change which action was preselected or the experiment's scope and horizon.
  const selectedActionId = input.selectedActionId;
  const validationSetId = input.validationSetId;
  const trainingBestActionId = training.bestActionId;
  const validation = await evaluateFiniteActionSet({ actionSetVersion: training.actionSetVersion,
    universeComplete: true, baselineActionId: training.baselineActionId, candidates: structuredClone(input.candidates),
    seeds: [...input.validationSeeds], scope: training.scope, currency: training.currency,
    horizon: { ...training.horizon }, maximumEvaluations: input.maximumEvaluations, evaluate: input.evaluate });
  const selected = validation.ranking.find(r => r.actionId === selectedActionId)!;
  const selectedBySeed = new Map(selected.contributionBySeed.map(s => [s.seed, s.contributionMinor]));
  const comparisons: PolicyValidationRow[] = validation.ranking.map(row => {
    const gaps = row.contributionBySeed.map(s => s.contributionMinor - selectedBySeed.get(s.seed)!);
    const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.length < 2 ? null : gaps.reduce((sum, gap) => sum + (gap - average) ** 2, 0) / (gaps.length - 1);
    return { actionId: row.actionId, pairedMeanGapMinor: average,
      pairedStandardErrorMinor: variance === null ? null : Math.sqrt(variance / gaps.length) };
  });
  return { access: "evaluator_only" as const, version: "finite-decision-validation/1.0.0" as const,
    validationSetId, selectedActionId, trainingBestActionId,
    validation, comparisons,
    selectedDeltaVersusBaselineMinor: selected.meanDeltaVersusBaselineMinor,
    inSampleValidationRegretMinor: validation.ranking[0]!.meanContributionMinor - selected.meanContributionMinor,
    expectedOptimalityProven: false as const,
    selectionChangedUsingValidationData: false as const };
}
