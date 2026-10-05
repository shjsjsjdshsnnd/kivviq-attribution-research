/**
 * Operator-only experiment selector. No provider, database, LLM or oracle imports.
 * Trusted adapters supply evidence snapshots; an HTTP client must never be allowed
 * to assert causal permission, capabilities, economic bounds or readiness.
 * Selection is a recommendation, not execution authorization.
 */
export const SELECTOR_VERSION = 'experiment-selector/0.1.0' as const
export type SelectionStatus = 'ACT_NOW' | 'MONITOR' | 'INVESTIGATE_MORE' | 'RUN_EXPERIMENT' | 'EXPERIMENT_NOT_FEASIBLE'
export type CheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN'
export type Domain = 'paid_media' | 'checkout' | 'pricing' | 'promotion' | 'shipping' | 'email' | 'merchandising' | 'remediation'
export type Unit = 'CUSTOMER' | 'SESSION' | 'GEO' | 'TIME_BLOCK'
export type DesignId = 'customer_ab' | 'audience_holdout' | 'platform_lift' | 'geo_randomized' | 'switchback' | 'randomized_rollout'
export type MetricKind = 'binary' | 'continuous'
export type ReasonCode =
  | 'INVALID_INPUT' | 'EVIDENCE_RETRIEVAL_FAILED' | 'MEASUREMENT_INVALID' | 'MEASUREMENT_UNKNOWN'
  | 'VERIFIED_REMEDIATION' | 'DOMINATED_OPTION' | 'CAUSAL_EVIDENCE_SUFFICIENT'
  | 'CAUSAL_EVIDENCE_MISMATCH' | 'CAUSAL_EVIDENCE_UNQUALIFIED' | 'ATTRIBUTION_NOT_INCREMENTAL'
  | 'CONFOUNDING_UNRESOLVED' | 'DECISION_CONTEXT_REQUIRED' | 'LOW_MATERIALITY'
  | 'ECONOMIC_INPUTS_REQUIRED' | 'UNACCEPTABLE_ACTION_DOWNSIDE' | 'EFFECT_NOT_WORTH_IMPLEMENTING'
  | 'DESIGN_NOT_APPLICABLE' | 'METHOD_NOT_IMPLEMENTED' | 'CAPABILITY_UNKNOWN' | 'CAPABILITY_UNAVAILABLE'
  | 'STALE_CAPABILITY' | 'POPULATION_MISMATCH' | 'ASSIGNMENT_INVALID' | 'ASSIGNMENT_UNKNOWN'
  | 'CONTAMINATION_UNCONTROLLED' | 'CONTAMINATION_UNKNOWN' | 'INSTRUMENTATION_REQUIRED'
  | 'POWER_INPUTS_REQUIRED' | 'POWER_APPROXIMATION_UNSAFE' | 'INSUFFICIENT_SAMPLE' | 'WINDOW_TOO_SHORT'
  | 'FINANCIAL_RISK_EXCEEDED' | 'COSTS_REQUIRED' | 'CANONICAL_READINESS_UNKNOWN'
  | 'CANONICAL_READINESS_PASSED' | 'CANONICAL_READINESS_BLOCKED' | 'INFORMATION_VALUE_UNKNOWN' | 'NONPOSITIVE_INFORMATION_VALUE'
  | 'POSITIVE_NET_INFORMATION_VALUE' | 'GATHER_EVIDENCE_FIRST' | 'NO_ADMISSIBLE_DESIGN'
  | 'VALIDITY_CHECK_FAILED' | 'SAMPLE_RATIO_MISMATCH' | 'RESULT_SCOPE_MISMATCH'
  | 'OUTCOMES_NOT_MATURE' | 'ECONOMIC_GUARDRAIL_FAILED' | 'RESULT_INCONCLUSIVE'
export interface Check { code: ReasonCode; status: CheckStatus; detail: string; evidenceRefs: readonly string[] }
export interface Context {
  workspaceId: string; snapshotId: string; asOf: string; timeZone: string;
  currency: string; horizonDays: number; evidenceRefs: readonly string[]
}
export interface Action {
  id: string; fingerprint: string; domain: Domain; targetRef: string; populationRef: string;
  controlActionRef: string; controlFingerprint: string;
  reversibility: 'FULL' | 'PARTIAL' | 'NONE' | 'UNKNOWN'; constraints: CheckStatus
}
export interface Guardrail { ref: string; operator: 'AT_LEAST' | 'AT_MOST'; threshold: number; unit: string; definitionRef: string }
export interface Metric {
  ref: string; kind: MetricKind; direction: 'MAXIMIZE' | 'MINIMIZE';
  unit: string; minimumWorthwhileEffect: number; definitionRef: string; outcomeHorizonDays: number;
  /** Prefer contribution per eligible randomized unit, including non-buyers. */
  isContribution: boolean; contributionGuardrailRef: string | null; secondaryRefs: readonly string[]; guardrails: readonly Guardrail[]
}
export interface CausalRecord {
  workspaceId: string; actionFingerprint: string; populationRef: string; metricRef: string;
  horizonDays: number; currency: string; completedAt: string; validUntil: string; evidenceRef: string; metricDefinitionRef: string;
  methodology: 'randomized' | 'qualified_quasi' | 'observational';
  validity: CheckStatus; economicGuardrails: CheckStatus; causalClaimPermitted: boolean;
  /** Raw treatment minus control, in primary metric units. */
  low: number; high: number; level: number
}
export interface Economics {
  /** All amounts use context.currency MAJOR units over context.horizonDays. */
  plausibleUpside: number; worstCaseActionLoss: number; maxActionLoss: number;
  maxTestLoss: number; implementationCost: number; materialityThreshold: number;
  fullyCosted: boolean; evidenceRefs: readonly string[]
}
export interface Sample {
  populationRef: string; unit: Unit; eligibleUnits: number; unitsPerDay: number | null;
  enrollment: 'FIXED_POOL' | 'ARRIVING'; outcomeLagDays: number; minimumExposureDays: number;
  baseline: number; variance: number | null; expectedEffect: number | null; independentUnits: boolean;
  /** Required for continuous normal approximation; not asserted by an LLM. */
  distributionValidated: boolean; observedAt: string; validUntil: string; evidenceRefs: readonly string[]
}
export interface InformationModel {
  context: Pick<Context, 'workspaceId' | 'snapshotId' | 'currency' | 'horizonDays'>;
  actionFingerprint: string; evidenceRefs: readonly string[];
  /** Future horizon net contribution, including full action implementation cost. */
  scenarios: readonly { id: string; probability: number; actionNetValue: number; signals: Readonly<Record<string, number>> }[]
}
export interface DesignOption {
  id: string; design: DesignId; unit: Unit; populationRef: string;
  capability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'; capabilityExpiresAt: string;
  assignment: CheckStatus; contamination: CheckStatus; instrumentation: CheckStatus;
  controlFraction: number; maxEnrollmentDays: number; washoutDays: number;
  setupCost: number | null; exposureCost: number | null; delayCost: number | null;
  worstCaseLoss: number | null; operationalCheck: CheckStatus; evidenceRefs: readonly string[];
  /** Bound below to the exact power plan; no generic perfect-information bonus. */
  information: (InformationModel & { planFingerprint: string }) | null
}
export interface InvestigationOption {
  id: string; question: string; evidenceRequest: string; cost: number; delayCost: number;
  durationDays: number; information: InformationModel
}
export interface SelectionInput {
  question: string; context: Context; action: Action; objective: Metric;
  evidence: { retrieval: 'OK' | 'UNAVAILABLE'; measurement: CheckStatus; refs: readonly string[];
    causal: readonly CausalRecord[]; confounders: readonly string[] };
  economics: Economics | null; sample: Sample | null; designs: readonly DesignOption[];
  investigation: InvestigationOption | null;
  /** Only upstream-verified mechanical remedies, never behavioral lift claims. */
  exemption: { kind: 'REMEDIATION' | 'DOMINATED'; verified: boolean; proofRef: string; replacementActionRef: string } | null
}
export interface PowerPlan {
  method: 'normal-two-proportions/1' | 'normal-independent-means/1'; alpha: 0.05; power: 0.8;
  control: number; treatment: number; total: number; mdeAbsolute: number;
  enrollmentDays: number; durationDays: number; fingerprint: string;
  limitations: readonly string[]
}
export interface ValueOfInformation {
  method: 'finite-signal-evsi/1'; currentBestValue: number; expectedActValue: number;
  evpi: number; evsi: number; cost: number; netLearningValue: number; candidateValue: number;
  evidenceRefs: readonly string[]
}
export interface ExperimentSpec {
  version: typeof SELECTOR_VERSION; context: Context; id: string; hypothesis: string; causalQuestion: string;
  design: DesignId; control: { actionRef: string; fingerprint: string; allocation: number };
  treatment: { actionRef: string; fingerprint: string; allocation: number };
  populationRef: string; randomizationUnit: Unit; primaryKpi: Metric;
  secondaryKpis: readonly string[]; guardrails: readonly Guardrail[]; power: PowerPlan;
  stopping: { kind: 'FIXED'; sampleTarget: number; minimumDurationDays: number; allowEfficacyPeeking: false };
  successCriteria: string; failureCriteria: string; rollbackCondition: string;
  contaminationRisks: readonly string[]; expectedEconomicImpact: ValueOfInformation;
  requiredInstrumentation: readonly string[]; inputFingerprint: string;
  executionAuthorization: 'NOT_AUTHORIZED'
}
export interface Alternative {
  id: string; kind: 'ACT' | 'BASELINE' | 'INVESTIGATE' | 'EXPERIMENT'; admissible: boolean;
  checks: readonly Check[]; value: number | null; power: PowerPlan | null; information: ValueOfInformation | null
}
export interface Selection {
  version: typeof SELECTOR_VERSION; status: SelectionStatus; proposedActionDisposition: 'ALLOW' | 'DEFER' | 'REJECT';
  causalStatus: 'IDENTIFIED' | 'NOT_IDENTIFIED' | 'UNAVAILABLE'; reasonCodes: readonly ReasonCode[];
  selectedActionRef: string | null; alternatives: readonly Alternative[]; experiment: ExperimentSpec | null;
  nextEvidenceStrategy: string; reviewTrigger: string; inputFingerprint: string;
  executionAuthorization: 'NOT_AUTHORIZED'
}
export interface ReadinessGateway {
  /** Must call canonical action/population/portfolio readiness. No execution. */
  assess(input: Readonly<SelectionInput>, design: Readonly<DesignOption>, power: Readonly<PowerPlan>):
    { status: 'READY' | 'BLOCKED' | 'UNKNOWN'; reasons: readonly string[]; evidenceRefs: readonly string[] }
}
