/** Step 8 v0.1: operator-side contracts. No simulator/oracle objects cross this boundary. */
export const DECISION_OPTIMIZER_VERSION = "decision-optimizer/0.1.0" as const;
export const INPUT_METRICS = [
  "netRevenue", "costOfGoods", "fulfillmentCost", "paidMediaCost",
  "otherVariableCost", "interventionCost", "newCustomers", "orders", "sessions",
  "inventoryUnits", "retainedCustomers", "eligibleCustomers", "netCash",
  "attributedRevenue", "reportedRoas",
] as const;
export type InputMetric = typeof INPUT_METRICS[number];
export type Metrics = Partial<Record<InputMetric, number>>;
export const OBJECTIVE_METRICS = [
  "contributionProfit", "netRevenue", "newCustomers", "inventoryUnits", "retentionRate", "netCash",
] as const;
export type ObjectiveMetric = typeof OBJECTIVE_METRICS[number];
export type Metric = InputMetric | "contributionProfit" | "grossMarginRate" | "retentionRate" | "conversionRate" | "cac";
export interface ObjectiveTerm {
  metric: ObjectiveMetric;
  direction: "MAXIMIZE" | "MINIMIZE";
  /** Positive, merchant-specified weights/scales; no implicit dollars-to-customers exchange rate. */
  weight: number;
  scale: number;
}
export interface Objective { intent: string; terms: ObjectiveTerm[] }
export interface DecisionContext {
  merchantId: string;
  snapshotId: string;
  currency: string;
  moneyUnit: "MAJOR";
  asOf: string;
  timeZone: string;
  /** Exact UTC boundaries of merchant-local days, supplied by the calendar layer. End exclusive. */
  dayBoundaries: string[];
}
export interface ResourceLimit {
  resourceId: string;
  unit: "MONEY" | "UNITS" | "HOURS" | "COUNT";
  /** Consumable debits persist; renewable reservations expire at the action end. */
  kind: "CONSUMABLE" | "RENEWABLE";
  capacityByDay: number[];
  evidenceRefs: string[];
}
export interface ResourceUse { resourceId: string; quantity: number }
export interface MetricConstraint {
  constraintId: string;
  metric: Metric;
  basis: "TOTAL" | "INCREMENTAL";
  operator: "AT_LEAST" | "AT_MOST";
  threshold: number;
  enforcement: "EXPECTED" | "EVERY_SCENARIO";
}
export interface StopRule {
  ruleId: string;
  metric: Metric | "marginalCac";
  operator: "ABOVE" | "BELOW";
  threshold: number;
  consecutiveCompleteDays: number;
  response: "STOP" | "ROLLBACK" | "REASSESS";
}
export interface ActionOption {
  optionId: string;
  opportunityId: string;
  merchantId: string;
  snapshotId: string;
  actionId: string;
  actionFingerprint: string;
  label: string;
  actionType: string;
  targetRef: string;
  /** Already-bound parameters/timing. The optimizer never silently edits the canonical Action. */
  parameters: Record<string, string | number | boolean | null>;
  startDay: number;
  endDay: number;
  resources: ResourceUse[];
  exclusiveGroups: string[];
  conflictKeys: string[];
  dependencies: { opportunityId: string; minimumLagDays: number; outcomeGate: boolean }[];
  reversibility: "FULL" | "PARTIAL" | "NONE" | "UNKNOWN";
  owner: string;
  evidenceRefs: string[];
  assumptions: string[];
  stopRules: StopRule[];
}
export interface SearchPolicy {
  maxCandidates: number;
  maxPortfolioSize: number;
  uncertaintyPenalty: number;
  downsidePenalty: number;
  irreversiblePenalty: number;
  tailProbability: number;
  practicalTieUtility: number;
  requireCalibration: boolean;
}
export const DEFAULT_SEARCH_POLICY: SearchPolicy = {
  maxCandidates: 512, maxPortfolioSize: 3,
  uncertaintyPenalty: 0.25, downsidePenalty: 1, irreversiblePenalty: 0,
  tailProbability: 0.1, practicalTieUtility: 1, requireCalibration: true,
};
export interface OptimizationInput {
  decisionId: string;
  context: DecisionContext;
  objective: Objective;
  options: ActionOption[];
  resources: ResourceLimit[];
  metricConstraints: MetricConstraint[];
  policy: SearchPolicy;
}
export interface Candidate { candidateId: string; optionIds: string[] }
export interface PredictionRequest { context: DecisionContext; candidates: Candidate[]; options: ActionOption[] }
export interface PredictionBatch {
  modelVersion: string;
  /** Must exactly equal the request context: one snapshot, currency, calendar and horizon. */
  context: DecisionContext;
  calibrationEvidenceRefs: string[];
  evidenceRefs: string[];
  assumptions: string[];
  /** A joint predictive distribution. IDs and probabilities are shared across all candidates. */
  baseline: { scenarioId: string; probability: number; metrics: Metrics }[];
  /** The empty portfolio is evaluated against baseline; do not send a separate no-op forecast. */
  forecasts: { candidateId: string; outcomes: { scenarioId: string; metrics: Metrics }[] }[];
}
export interface DigitalTwinGateway {
  /** Forecasts are estimates from observable evidence, NOT evaluator ground truth. */
  predict(request: Readonly<PredictionRequest>): Promise<PredictionBatch> | PredictionBatch;
}
export interface CandidateGate {
  /** Required in the Opportunity adapter: calls existing canonical portfolio/eligibility checks. */
  assess(candidate: Readonly<Candidate>, options: readonly ActionOption[]): { status: "VALID" | "INVALID" | "UNKNOWN"; reasons: string[] };
}
export interface DistributionSummary { mean: number; standardDeviation: number; low: number; high: number; lowerTailMean: number }
export interface MetricSummary { total: DistributionSummary; incremental: DistributionSummary }
export interface CandidateEvaluation {
  candidate: Candidate;
  status: "FEASIBLE" | "REJECTED" | "UNRESOLVED";
  reasons: string[];
  metrics?: Partial<Record<Metric, MetricSummary>>;
  utility?: DistributionSummary;
  penalties?: { uncertainty: number; downside: number; reversibility: number };
  score?: number;
  scenarioUtilities?: number[];
  /** Diagnostic gap only; NEVER subtracted again from utility. Not ground-truth regret. */
  foregoneUtilityVersusBestEvaluated?: number;
}
export interface ExecutionStep {
  optionId: string;
  actionId: string;
  actionFingerprint: string;
  owner: string;
  startsAt: string;
  endsAt: string;
  parameters: ActionOption["parameters"];
  resources: ResourceUse[];
  dependsOnOptionIds: string[];
  outcomeGates: string[];
  requiresApproval: true;
  revalidateBeforeExecution: true;
  stopRules: StopRule[];
  reversibility: ActionOption["reversibility"];
}
export interface Decision {
  version: typeof DECISION_OPTIMIZER_VERSION;
  decisionId: string;
  status: "SELECTED" | "HOLD" | "INCOMPLETE" | "NO_FEASIBLE_CANDIDATE";
  input: OptimizationInput;
  predictions: PredictionBatch | null;
  candidates: CandidateEvaluation[];
  selectedCandidateId: string | null;
  tiedCandidateIds: string[];
  strongestAlternatives: string[];
  search: { examined: number; simulated: number; truncated: boolean; scope: "BEST_EVALUATED_ONLY" };
  rationale: string[];
  executionPlan: ExecutionStep[];
  successCriteria: { metric: ObjectiveMetric; direction: ObjectiveTerm["direction"]; comparison: "CAUSALLY_ESTIMATED_INCREMENTAL"; measureAfter: string }[];
  executionState: "NOT_AUTHORIZED";
}
