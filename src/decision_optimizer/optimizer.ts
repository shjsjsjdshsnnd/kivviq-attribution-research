import {
  DECISION_OPTIMIZER_VERSION, INPUT_METRICS,
  type ActionOption, type Candidate, type CandidateEvaluation, type CandidateGate, type Decision,
  type DigitalTwinGateway, type ExecutionStep, type Metric, type OptimizationInput, type PredictionBatch,
} from "./types.js";
import { distribution, finite, incrementalUtility, metricValue, validateMetrics, weightedMean } from "./math.js";
import { copyData, deepFreeze, exactKeys, id, strings, validateInput } from "./validation.js";

const NO_ACTION = "candidate:none";
const metricNames = [...INPUT_METRICS, "contributionProfit", "grossMarginRate", "retentionRate", "conversionRate", "cac"] as Metric[];
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function canonicalContext(context: OptimizationInput["context"]): unknown[] {
  return [context.merchantId, context.snapshotId, context.currency, context.moneyUnit, context.asOf, context.timeZone, context.dayBoundaries];
}
function candidate(options: readonly ActionOption[]): Candidate {
  return { candidateId: options.length ? "candidate:" + options.map(option => option.optionId).join("+") : NO_ACTION,
    optionIds: options.map(option => option.optionId) };
}
function chosen(candidate: Candidate, options: readonly ActionOption[]): ActionOption[] {
  const ids = new Set(candidate.optionIds); return options.filter(option => ids.has(option.optionId));
}
function staticIssues(options: readonly ActionOption[], input: OptimizationInput): string[] {
  const issues: string[] = [];
  for (let i = 0; i < options.length; i++) {
    const a = options[i]!;
    for (const b of options.slice(i + 1)) {
      if (a.opportunityId === b.opportunityId || a.exclusiveGroups.some(group => b.exclusiveGroups.includes(group)))
        issues.push(`MUTUALLY_EXCLUSIVE:${a.optionId}:${b.optionId}`);
      if (a.startDay < b.endDay && b.startDay < a.endDay && a.conflictKeys.some(key => b.conflictKeys.includes(key)))
        issues.push(`OVERLAPPING_CONTROL:${a.optionId}:${b.optionId}`);
    }
    for (const dependency of a.dependencies) {
      const required = options.filter(option => option.opportunityId === dependency.opportunityId);
      if (required.length !== 1) issues.push(`MISSING_OR_AMBIGUOUS_DEPENDENCY:${a.optionId}:${dependency.opportunityId}`);
      else if (required[0]!.endDay + dependency.minimumLagDays > a.startDay)
        issues.push(`DEPENDENCY_NOT_READY:${a.optionId}:${dependency.opportunityId}`);
    }
  }
  for (const resource of input.resources) {
    for (let day = 0; day < resource.capacityByDay.length; day++) {
      const used = options.reduce((sum, option) => sum + (day >= option.startDay && (resource.kind === "CONSUMABLE" || day < option.endDay)
        ? option.resources.find(use => use.resourceId === resource.resourceId)?.quantity ?? 0 : 0), 0);
      if (used > resource.capacityByDay[day]!) issues.push(`RESOURCE_LIMIT:${resource.resourceId}:day${day}:${used}>${resource.capacityByDay[day]}`);
    }
  }
  return issues;
}
function enumerate(input: OptimizationInput): { candidates: Candidate[]; truncated: boolean } {
  const options = [...input.options].sort((a, b) => a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0);
  const results = [candidate([])]; let truncated = false;
  const visit = (start: number, remaining: number, selection: ActionOption[]): boolean => {
    if (remaining === 0) {
      if (results.length === input.policy.maxCandidates) { truncated = true; return false; }
      results.push(candidate(selection)); return true;
    }
    for (let index = start; index <= options.length - remaining; index++) {
      selection.push(options[index]!);
      const keepGoing = visit(index + 1, remaining - 1, selection);
      selection.pop(); if (!keepGoing) return false;
    }
    return true;
  };
  for (let size = 1; size <= Math.min(input.policy.maxPortfolioSize, options.length); size++) if (!visit(0, size, [])) break;
  return { candidates: results, truncated };
}
function validatePredictions(batch: PredictionBatch, input: OptimizationInput, candidates: readonly Candidate[]): void {
  exactKeys(batch, ["modelVersion", "context", "calibrationEvidenceRefs", "evidenceRefs", "assumptions", "baseline", "forecasts"]);
  strings([batch.modelVersion], 1);
  exactKeys(batch.context, ["merchantId", "snapshotId", "currency", "moneyUnit", "asOf", "timeZone", "dayBoundaries"]);
  if (!same(canonicalContext(batch.context), canonicalContext(input.context))) throw new Error("PREDICTION_CONTEXT_MISMATCH");
  strings(batch.evidenceRefs, 1); strings(batch.assumptions); strings(batch.calibrationEvidenceRefs);
  batch.evidenceRefs.forEach(id); batch.calibrationEvidenceRefs.forEach(id);
  if (input.policy.requireCalibration && !batch.calibrationEvidenceRefs.length) throw new Error("UNCALIBRATED_PREDICTIONS");
  if (!Array.isArray(batch.baseline) || batch.baseline.length < 2 || batch.baseline.length > 2048) throw new Error("JOINT_PREDICTIVE_SCENARIOS_REQUIRED");
  let probability = 0; const scenarioIds = new Set<string>();
  for (const scenario of batch.baseline) {
    exactKeys(scenario, ["scenarioId", "probability", "metrics"]); id(scenario.scenarioId);
    if (scenarioIds.has(scenario.scenarioId)) throw new Error("DUPLICATE_SCENARIO"); scenarioIds.add(scenario.scenarioId);
    finite(scenario.probability, "probability"); if (!(scenario.probability > 0 && scenario.probability <= 1)) throw new Error("INVALID_PROBABILITY");
    probability += scenario.probability; validateMetrics(scenario.metrics);
  }
  if (Math.abs(probability - 1) > 1e-10) throw new Error("SCENARIO_PROBABILITIES_MUST_SUM_TO_ONE");
  const expected = new Set(candidates.filter(item => item.optionIds.length).map(item => item.candidateId));
  const seen = new Set<string>();
  if (!Array.isArray(batch.forecasts)) throw new Error("FORECASTS_REQUIRED");
  for (const forecast of batch.forecasts) {
    exactKeys(forecast, ["candidateId", "outcomes"]);
    if (!expected.has(forecast.candidateId) || seen.has(forecast.candidateId)) throw new Error("UNREQUESTED_OR_DUPLICATE_FORECAST");
    seen.add(forecast.candidateId);
    if (!Array.isArray(forecast.outcomes) || forecast.outcomes.length !== scenarioIds.size) throw new Error("SCENARIO_COVERAGE_MISMATCH");
    const outcomeIds = new Set<string>();
    for (const outcome of forecast.outcomes) {
      exactKeys(outcome, ["scenarioId", "metrics"]);
      if (!scenarioIds.has(outcome.scenarioId) || outcomeIds.has(outcome.scenarioId)) throw new Error("UNPAIRED_SCENARIO");
      outcomeIds.add(outcome.scenarioId); validateMetrics(outcome.metrics);
    }
  }
  // Missing candidates are recorded individually below and make the whole decision incomplete.
}
function evaluate(candidate: Candidate, batch: PredictionBatch, input: OptimizationInput): CandidateEvaluation {
  const forecast = batch.forecasts.find(value => value.candidateId === candidate.candidateId);
  if (candidate.optionIds.length && !forecast) return { candidate, status: "UNRESOLVED", reasons: ["MISSING_PREDICTION"] };
  const outcomes = batch.baseline.map(scenario => candidate.optionIds.length
    ? forecast!.outcomes.find(outcome => outcome.scenarioId === scenario.scenarioId)!.metrics : scenario.metrics);
  const weights = batch.baseline.map(scenario => scenario.probability);
  const result: CandidateEvaluation = { candidate, status: "FEASIBLE", reasons: [], metrics: {} };
  const required = new Set<Metric>([...input.objective.terms.map(term => term.metric), ...input.metricConstraints.map(rule => rule.metric)]);
  try {
    // Preserve all available business metrics independently of their utility weights.
    for (const metric of metricNames) {
      try {
        const totals = outcomes.map(metrics => metricValue(metrics, metric));
        const increments = totals.map((total, index) => total - metricValue(batch.baseline[index]!.metrics, metric));
        result.metrics![metric] = { total: distribution(totals, weights, input.policy.tailProbability), incremental: distribution(increments, weights, input.policy.tailProbability) };
      } catch (error) { if (required.has(metric)) throw error; }
    }
    for (const rule of input.metricConstraints) {
      const values = outcomes.map((metrics, index) => metricValue(metrics, rule.metric)
        - (rule.basis === "INCREMENTAL" ? metricValue(batch.baseline[index]!.metrics, rule.metric) : 0));
      const assessed = rule.enforcement === "EXPECTED" ? [weightedMean(values, weights)] : values;
      const passes = assessed.every(value => rule.operator === "AT_LEAST" ? value >= rule.threshold : value <= rule.threshold);
      if (!passes) result.reasons.push(`METRIC_CONSTRAINT:${rule.constraintId}`);
    }
    const utilities = outcomes.map((metrics, index) => incrementalUtility(metrics, batch.baseline[index]!.metrics, input.objective));
    result.utility = distribution(utilities, weights, input.policy.tailProbability);
    const reversibility = chosen(candidate, input.options).reduce((sum, option) => sum
      + ({ FULL: 0, PARTIAL: 1, NONE: 2, UNKNOWN: 3 }[option.reversibility]) * input.policy.irreversiblePenalty, 0);
    result.penalties = { uncertainty: input.policy.uncertaintyPenalty * result.utility.standardDeviation,
      downside: input.policy.downsidePenalty * Math.max(0, -result.utility.lowerTailMean), reversibility };
    const penalty = result.penalties.uncertainty + result.penalties.downside + reversibility;
    result.score = result.utility.mean - penalty; finite(result.score, "risk-adjusted score");
    result.scenarioUtilities = utilities.map(value => value - penalty);
    if (result.reasons.length) result.status = "REJECTED";
  } catch (error) { result.status = "UNRESOLVED"; result.reasons.push(`MISSING_OR_INVALID_ECONOMICS:${error instanceof Error ? error.message : "unknown"}`); }
  return result;
}
function stablePreference(a: CandidateEvaluation, b: CandidateEvaluation, input: OptimizationInput): number {
  const burden = (item: CandidateEvaluation): [number, number, number, number, number, string] => {
    const options = chosen(item.candidate, input.options);
    const moneyIds = new Set(input.resources.filter(resource => resource.unit === "MONEY").map(resource => resource.resourceId));
    return [options.reduce((sum, option) => sum + ({ FULL: 0, PARTIAL: 1, NONE: 2, UNKNOWN: 3 }[option.reversibility]), 0),
      Math.max(0, -(item.utility?.lowerTailMean ?? 0)), item.utility?.standardDeviation ?? 0,
      options.reduce((sum, option) => sum + option.resources.filter(use => moneyIds.has(use.resourceId)).reduce((subtotal, use) => subtotal + use.quantity, 0), 0),
      options.length, item.candidate.candidateId];
  };
  const x = burden(a); const y = burden(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || x[4] - y[4] || (x[5] < y[5] ? -1 : x[5] > y[5] ? 1 : 0);
}
function plan(selected: Candidate, input: OptimizationInput): ExecutionStep[] {
  const options = chosen(selected, input.options);
  return [...options].sort((a, b) => a.startDay - b.startDay || (a.optionId < b.optionId ? -1 : 1)).map(option => ({
    optionId: option.optionId, actionId: option.actionId, actionFingerprint: option.actionFingerprint, owner: option.owner,
    startsAt: input.context.dayBoundaries[option.startDay]!, endsAt: input.context.dayBoundaries[option.endDay]!,
    parameters: option.parameters, resources: option.resources,
    dependsOnOptionIds: option.dependencies.map(dependency => options.find(item => item.opportunityId === dependency.opportunityId)!.optionId),
    outcomeGates: option.dependencies.filter(dependency => dependency.outcomeGate).map(dependency => dependency.opportunityId),
    requiresApproval: true, revalidateBeforeExecution: true, stopRules: option.stopRules, reversibility: option.reversibility,
  }));
}
/** Bounded deterministic search over already-bound, evidence-eligible options. Never executes actions. */
export async function optimizeDecision(raw: OptimizationInput, twin: DigitalTwinGateway, gate: CandidateGate): Promise<Decision> {
  const input = copyData(raw); validateInput(input); deepFreeze(input);
  if (!gate || typeof gate.assess !== "function" || !twin || typeof twin.predict !== "function") throw new Error("Explicit Action Space gate and Digital Twin gateway required");
  const space = enumerate(input); const evaluations: CandidateEvaluation[] = [];
  const valid: Candidate[] = [];
  for (const candidate of space.candidates) {
    const options = chosen(candidate, input.options);
    const reasons = staticIssues(options, input);
    if (reasons.length) { evaluations.push({ candidate, status: "REJECTED", reasons }); continue; }
    if (candidate.optionIds.length) {
      try {
        const assessment = copyData(gate.assess(deepFreeze(candidate), options));
        if (!["VALID", "INVALID", "UNKNOWN"].includes(assessment.status)) throw new Error("Invalid gate result");
        strings(assessment.reasons);
        if (assessment.status !== "VALID") {
          evaluations.push({ candidate, status: assessment.status === "UNKNOWN" ? "UNRESOLVED" : "REJECTED", reasons: assessment.reasons.length ? assessment.reasons : ["ACTION_SPACE_GATE_FAILED"] }); continue;
        }
      } catch (error) { evaluations.push({ candidate, status: "UNRESOLVED", reasons: [`ACTION_SPACE_GATE_ERROR:${error instanceof Error ? error.message : "unknown"}`] }); continue; }
    }
    valid.push(candidate);
  }
  let predictions: PredictionBatch | null = null;
  try {
    const request = deepFreeze(copyData({ context: input.context, candidates: valid, options: input.options }));
    predictions = copyData(await twin.predict(request)); validatePredictions(predictions, input, valid);
    for (const candidate of valid) evaluations.push(evaluate(candidate, predictions, input));
  } catch (error) {
    predictions = null;
    for (const candidate of valid) evaluations.push({ candidate, status: "UNRESOLVED", reasons: [`PREDICTION_FAILED:${error instanceof Error ? error.message : "unknown"}`] });
  }
  const ordered = space.candidates.map(candidate => evaluations.find(item => item.candidate.candidateId === candidate.candidateId)!);
  const feasible = ordered.filter(item => item.status === "FEASIBLE").sort((a, b) => b.score! - a.score! || stablePreference(a, b, input));
  const incomplete = ordered.some(item => item.status === "UNRESOLVED");
  const best = feasible[0]; const ties: CandidateEvaluation[] = [];
  if (best && predictions) {
    const weights = predictions.baseline.map(scenario => scenario.probability);
    for (const item of feasible) {
      item.foregoneUtilityVersusBestEvaluated = Math.max(0, best.score! - item.score!);
      const paired = distribution(best.scenarioUtilities!.map((value, index) => value - item.scenarioUtilities![index]!), weights, input.policy.tailProbability);
      if (best.score! - item.score! <= input.policy.practicalTieUtility || (paired.low <= 0 && paired.high >= 0)) ties.push(item);
    }
  }
  ties.sort((a, b) => stablePreference(a, b, input));
  const selected = incomplete ? undefined : ties[0];
  const reasons = ["Utilities compare modeled incremental outcomes against the same natural-evolution baseline; attributed revenue and ROAS are diagnostic only.",
    "Opportunity cost is represented by mutually competing portfolios under shared resources, not charged twice as an extra expense."];
  if (space.truncated) reasons.push("The candidate limit was reached. This is the best evaluated bounded choice, not a globally optimal decision.");
  if (input.policy.maxPortfolioSize < input.options.length) reasons.push("Portfolios larger than the configured size were not searched.");
  if (incomplete) reasons.push("Selection withheld: at least one potentially feasible candidate lacks a valid gate assessment or comparable prediction.");
  else if (!selected) reasons.push("No candidate, including the status quo, satisfies the configured hard constraints.");
  else {
    const economics = selected.metrics?.contributionProfit?.incremental;
    if (economics) reasons.push(`Modeled incremental contribution: mean ${economics.mean} ${input.context.currency}; predictive range ${economics.low} to ${economics.high}. These are estimates, not observed causal results.`);
    reasons.push(`Risk-adjusted utility ${selected.score}; uncertainty/downside/reversibility penalties ${JSON.stringify(selected.penalties)}.`);
    if (ties.length > 1) reasons.push("Alternatives are practically or predictively indistinguishable. Prefer reversibility, lower downside/spread, lower money commitments, fewer actions, then stable identity. This is not a statistical-significance claim.");
    if (!selected.candidate.optionIds.length) reasons.push("Hold the status quo rather than force an unsupported intervention.");
  }
  const decision: Decision = {
    version: DECISION_OPTIMIZER_VERSION, decisionId: input.decisionId,
    status: incomplete ? "INCOMPLETE" : !selected ? "NO_FEASIBLE_CANDIDATE" : selected.candidate.optionIds.length ? "SELECTED" : "HOLD",
    input, predictions, candidates: ordered, selectedCandidateId: selected?.candidate.candidateId ?? null,
    tiedCandidateIds: ties.map(item => item.candidate.candidateId),
    strongestAlternatives: feasible.filter(item => item !== selected).slice(0, 5).map(item => item.candidate.candidateId),
    search: { examined: ordered.length, simulated: valid.length, truncated: space.truncated, scope: "BEST_EVALUATED_ONLY" },
    rationale: reasons, executionPlan: selected ? plan(selected.candidate, input) : [],
    successCriteria: input.objective.terms.map(term => ({ metric: term.metric, direction: term.direction, comparison: "CAUSALLY_ESTIMATED_INCREMENTAL", measureAfter: input.context.dayBoundaries.at(-1)! })),
    executionState: "NOT_AUTHORIZED",
  };
  return deepFreeze(copyData(decision)) as Decision;
}

/** Parameter/timing grids are finite; factories must subsequently bind canonical Actions. */
export function boundedParameterGrid(axes: Record<string, (string | number | boolean)[]>, limit: number): { points: Record<string, string | number | boolean>[]; truncated: boolean } {
  const safe = copyData(axes);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error("Invalid grid limit");
  const keys = Object.keys(safe).sort(); if (!keys.length || keys.length > 16) throw new Error("Between one and sixteen grid axes required");
  for (const key of keys) { id(key); const values = safe[key]!; if (!Array.isArray(values) || !values.length || values.some(value => !["string", "number", "boolean"].includes(typeof value)) || new Set(values).size !== values.length) throw new Error("Nonempty unique primitive axes required"); }
  const points: Record<string, string | number | boolean>[] = []; let truncated = false;
  const visit = (depth: number, point: Record<string, string | number | boolean>): boolean => {
    if (depth === keys.length) { if (points.length === limit) { truncated = true; return false; } points.push({ ...point }); return true; }
    const key = keys[depth]!;
    for (const value of safe[key]!) { point[key] = value; if (!visit(depth + 1, point)) return false; }
    return true;
  };
  visit(0, {}); return { points, truncated };
}
