import { type Decision, type Metric, type Metrics, type StopRule } from "./types.js";
import { finite, metricValue, nonnegative, validateMetrics } from "./math.js";
import { copyData, deepFreeze, id, strings } from "./validation.js";

export interface DailyMeasurement {
  day: number;
  complete: boolean;
  metrics: Metrics;
  /** Independently estimated no-intervention values, NOT yesterday's totals or ad attribution. */
  counterfactual?: Metrics;
  causalEvidenceRefs?: string[];
}
export interface StopAssessment { ruleId: string; status: "TRIGGERED" | "CLEAR" | "INSUFFICIENT_EVIDENCE"; response: StopRule["response"]; consecutiveBreaches: number }
export function assessStopRule(rule: StopRule, raw: readonly DailyMeasurement[], lastCompleteDay: number): StopAssessment {
  const measurements = copyData(raw); const seen = new Set<number>();
  if (!Number.isInteger(lastCompleteDay) || lastCompleteDay < 0 || !Number.isInteger(rule.consecutiveCompleteDays) || rule.consecutiveCompleteDays < 1) throw new Error("Explicit complete-day clock and positive streak required");
  finite(rule.threshold, "stop threshold");
  if (!["ABOVE", "BELOW"].includes(rule.operator)) throw new Error("Invalid stop comparison");
  for (const item of measurements) {
    if (!Number.isInteger(item.day) || item.day < 0 || seen.has(item.day) || typeof item.complete !== "boolean") throw new Error("Invalid/duplicate day");
    seen.add(item.day); validateMetrics(item.metrics); if (item.counterfactual) validateMetrics(item.counterfactual);
  }
  const result: StopAssessment = { ruleId: rule.ruleId, status: "CLEAR", response: rule.response, consecutiveBreaches: 0 };
  for (let offset = 0; offset < rule.consecutiveCompleteDays; offset++) {
    const measurement = measurements.find(item => item.day === lastCompleteDay - offset);
    if (!measurement?.complete) return { ...result, status: "INSUFFICIENT_EVIDENCE" };
    let value: number;
    try {
      if (rule.metric === "marginalCac") {
        if (!measurement.counterfactual || !measurement.causalEvidenceRefs?.length) throw new Error("Independent incremental acquisition evidence required");
        const spend = metricValue(measurement.metrics, "paidMediaCost") - metricValue(measurement.counterfactual, "paidMediaCost");
        const customers = metricValue(measurement.metrics, "newCustomers") - metricValue(measurement.counterfactual, "newCustomers");
        if (spend <= 0) return result;
        value = customers <= 0 ? Number.POSITIVE_INFINITY : spend / customers;
      } else value = metricValue(measurement.metrics, rule.metric);
    } catch { return { ...result, status: "INSUFFICIENT_EVIDENCE" }; }
    if (!(rule.operator === "ABOVE" ? value > rule.threshold : value < rule.threshold)) return result;
    result.consecutiveBreaches++;
  }
  return { ...result, status: "TRIGGERED" };
}
export interface OutcomeObservation {
  decisionId: string;
  merchantId: string;
  snapshotId: string;
  currency: string;
  dayBoundaries: string[];
  recordedAt: string;
  complete: boolean;
  method: "OBSERVATIONAL" | "RANDOMIZED_EXPERIMENT" | "CAUSAL_ESTIMATE";
  evidenceRefs: string[];
  metrics: Metrics;
  counterfactual?: Metrics;
}
export interface LearningFeedback {
  decisionId: string;
  merchantId: string;
  candidateId: string;
  modelVersion: string;
  evidenceRefs: string[];
  eligibleForCausalCalibration: boolean;
  errors: { metric: Metric; predictedTotal: number; observedTotal: number; totalError: number; incrementalError?: number }[];
  limitations: string[];
}
/** Produces feedback, never silently changes a model or treats observational growth as causal lift. */
export function buildLearningFeedback(decision: Decision, raw: OutcomeObservation): LearningFeedback {
  const observed = copyData(raw); const context = decision.input.context;
  if (!decision.selectedCandidateId || !decision.predictions) throw new Error("A completed decision and prediction record are required");
  if (observed.decisionId !== decision.decisionId || observed.merchantId !== context.merchantId || observed.snapshotId !== context.snapshotId
    || observed.currency !== context.currency || JSON.stringify(observed.dayBoundaries) !== JSON.stringify(context.dayBoundaries)) throw new Error("Observation identity/window mismatch");
  if (!observed.complete || !Number.isFinite(Date.parse(observed.recordedAt)) || Date.parse(observed.recordedAt) < Date.parse(context.dayBoundaries.at(-1)!)) throw new Error("Immature outcome");
  if (!["OBSERVATIONAL", "RANDOMIZED_EXPERIMENT", "CAUSAL_ESTIMATE"].includes(observed.method)) throw new Error("Unknown measurement method");
  strings(observed.evidenceRefs, 1); observed.evidenceRefs.forEach(id); validateMetrics(observed.metrics);
  const causal = observed.method !== "OBSERVATIONAL";
  if (causal && !observed.counterfactual) throw new Error("Causal learning requires an independently estimated counterfactual");
  if (observed.counterfactual) validateMetrics(observed.counterfactual);
  const selected = decision.candidates.find(item => item.candidate.candidateId === decision.selectedCandidateId)!;
  const errors: LearningFeedback["errors"] = [];
  for (const key of Object.keys(selected.metrics ?? {}) as Metric[]) {
    if (key === "attributedRevenue" || key === "reportedRoas") continue;
    try {
      const summary = selected.metrics![key]!; const actual = metricValue(observed.metrics, key);
      const error: LearningFeedback["errors"][number] = { metric: key, predictedTotal: summary.total.mean, observedTotal: actual, totalError: actual - summary.total.mean };
      if (causal) error.incrementalError = actual - metricValue(observed.counterfactual!, key) - summary.incremental.mean;
      errors.push(error);
    } catch { /* Missing metrics remain missing; never impute zeros for a feedback signal. */ }
  }
  if (!errors.length) throw new Error("No comparable observed metrics");
  return deepFreeze({ decisionId: decision.decisionId, merchantId: context.merchantId, candidateId: decision.selectedCandidateId,
    modelVersion: decision.predictions.modelVersion, evidenceRefs: observed.evidenceRefs, eligibleForCausalCalibration: causal, errors,
    limitations: causal ? ["Causal validity depends on the measurement adapter's evidence; this function does not validate experiment design."]
      : ["Observational totals can calibrate forecasts but cannot identify incremental treatment effects."] }) as LearningFeedback;
}
export interface LearningSink { record(feedback: Readonly<LearningFeedback>): Promise<string> | string }
export async function submitLearningFeedback(decision: Decision, observation: OutcomeObservation, sink: LearningSink): Promise<string> {
  const receipt = await sink.record(buildLearningFeedback(decision, observation)); strings([receipt], 1); return receipt;
}

export interface InformationStudy {
  evidenceRefs: string[];
  /** Beliefs available at decision time, not the simulator's realized hidden state. */
  stateProbabilities: number[];
  signalLikelihoodByState: number[][];
  downstreamUtilityByActionAndState: number[][];
  studyCostInUtilityUnits: number;
}
/** Exact finite-belief EVSI helper. Kept separate from immediate utility to avoid double counting. */
export function estimateInformationValue(raw: InformationStudy): { expectedSampleInformationValue: number; perfectInformationUpperBound: number; netInformationValue: number } {
  const study = copyData(raw); strings(study.evidenceRefs, 1); study.evidenceRefs.forEach(id);
  nonnegative(study.studyCostInUtilityUnits, "study cost");
  const probabilities = (values: number[]): void => {
    if (!Array.isArray(values) || !values.length) throw new Error("Probability distribution required");
    values.forEach(value => { nonnegative(value, "probability"); if (value > 1) throw new Error("Invalid probability"); });
    if (Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 1e-10) throw new Error("Probabilities must sum to one");
  };
  probabilities(study.stateProbabilities);
  if (study.signalLikelihoodByState.length !== study.stateProbabilities.length || !study.downstreamUtilityByActionAndState.length) throw new Error("Incomplete information model");
  study.signalLikelihoodByState.forEach(probabilities);
  const signals = study.signalLikelihoodByState[0]!.length;
  if (study.signalLikelihoodByState.some(row => row.length !== signals)) throw new Error("Signal support mismatch");
  for (const row of study.downstreamUtilityByActionAndState) { if (row.length !== study.stateProbabilities.length) throw new Error("Utility support mismatch"); row.forEach(value => finite(value, "downstream utility")); }
  const priorBest = Math.max(...study.downstreamUtilityByActionAndState.map(row => row.reduce((sum, utility, state) => sum + utility * study.stateProbabilities[state]!, 0)));
  let informed = 0;
  for (let signal = 0; signal < signals; signal++) informed += Math.max(...study.downstreamUtilityByActionAndState.map(row => row.reduce((sum, utility, state) => sum + utility * study.stateProbabilities[state]! * study.signalLikelihoodByState[state]![signal]!, 0)));
  const perfect = study.stateProbabilities.reduce((sum, probability, state) => sum + probability * Math.max(...study.downstreamUtilityByActionAndState.map(row => row[state]!)), 0);
  const evsi = Math.max(0, informed - priorBest); const evpi = Math.max(0, perfect - priorBest);
  if (!Number.isFinite(evsi) || !Number.isFinite(evpi) || evsi > evpi + 1e-8) throw new Error("Invalid information-value bounds");
  return { expectedSampleInformationValue: evsi, perfectInformationUpperBound: evpi, netInformationValue: evsi - study.studyCostInUtilityUnits };
}
