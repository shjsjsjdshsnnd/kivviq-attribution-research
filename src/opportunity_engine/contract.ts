import { z } from "zod";
import { actionSpaceCanonicalActionSchema } from "../canonical_action/schema.js";

export const OPPORTUNITY_SCHEMA_VERSION = "opportunity/1.0.0" as const;
export const OPPORTUNITY_ENGINE_VERSION = "opportunity-engine/1.0.0" as const;

export const opportunityDomainSchema = z.enum([
  "PAID_MEDIA",
  "PRICING",
  "PROMOTION",
  "CRO",
  "MERCHANDISING",
  "INVENTORY",
  "LIFECYCLE",
  "ACQUISITION",
  "RETENTION",
  "SHIPPING",
  "OPERATIONAL",
  "INVESTIGATION",
  "NO_ACTION",
]);
export type OpportunityDomain = z.infer<typeof opportunityDomainSchema>;

const stableId = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const finite = z.number().finite();
const nonNegative = z.number().finite().nonnegative();

export const opportunityTargetSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("RESOLVED"),
    kind: z.enum([
      "MERCHANT",
      "CHANNEL",
      "CAMPAIGN",
      "AD_SET",
      "PRODUCT",
      "SKU",
      "COLLECTION",
      "CUSTOMER_SEGMENT",
      "PAGE",
      "FUNNEL_STAGE",
      "LIFECYCLE_FLOW",
      "PROMOTION",
      "SHIPPING_POLICY",
      "INVENTORY_LOCATION",
      "RESOURCE",
    ]),
    ref: stableId,
  }).strict(),
  z.object({
    state: z.literal("UNRESOLVED"),
    requiredKind: z.enum([
      "CHANNEL",
      "CAMPAIGN",
      "AD_SET",
      "PRODUCT",
      "SKU",
      "COLLECTION",
      "CUSTOMER_SEGMENT",
      "PAGE",
      "FUNNEL_STAGE",
      "LIFECYCLE_FLOW",
      "PROMOTION",
      "SHIPPING_POLICY",
      "INVENTORY_LOCATION",
      "RESOURCE",
    ]),
    evidenceNeeded: z.array(z.string().min(1)).min(1),
  }).strict(),
]);
export type OpportunityTarget = z.infer<typeof opportunityTargetSchema>;

const primitiveParameterSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const interventionParametersSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("READY"),
    values: z.record(primitiveParameterSchema),
  }).strict(),
  z.object({
    state: z.literal("NEEDS_INPUT"),
    known: z.record(primitiveParameterSchema).default({}),
    required: z.array(stableId).min(1),
  }).strict(),
  z.object({ state: z.literal("NOT_APPLICABLE") }).strict(),
]);
export type InterventionParameters = z.infer<typeof interventionParametersSchema>;

export const estimateUnitSchema = z.enum([
  "MONEY",
  "COUNT",
  "RATIO",
  "PERCENTAGE",
  "DAYS",
  "HOURS",
  "UNITS",
]);
export type EstimateUnit = z.infer<typeof estimateUnitSchema>;

export const boundedEstimateSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ESTIMATED"),
    unit: estimateUnitSchema,
    low: finite,
    base: finite,
    high: finite,
    evidenceRefs: z.array(stableId).min(1),
    method: z.enum([
      "EXPERIMENT",
      "CAUSAL_MODEL",
      "OBSERVATIONAL_BOUND",
      "ACCOUNTING",
      "RESPONSE_CURVE",
    ]),
  }).strict().superRefine((value, ctx) => {
    if (value.low > value.base || value.base > value.high) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["base"], message: "Estimate must satisfy low <= base <= high" });
    }
  }),
  z.object({
    state: z.literal("UNKNOWN"),
    unit: estimateUnitSchema,
    reason: z.string().min(1),
    evidenceNeeded: z.array(z.string().min(1)).min(1),
  }).strict(),
]);
export type BoundedEstimate = z.infer<typeof boundedEstimateSchema>;

export const responseCurveSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ESTIMATED"),
    inputMetric: stableId,
    outputMetric: stableId,
    points: z.array(z.object({ input: finite, output: finite }).strict()).min(2),
    evidenceRefs: z.array(stableId).min(1),
    method: z.enum(["EXPERIMENT", "CAUSAL_MODEL", "OBSERVATIONAL_BOUND"]),
  }).strict().superRefine((curve, ctx) => {
    for (let index = 1; index < curve.points.length; index += 1) {
      if (curve.points[index]!.input <= curve.points[index - 1]!.input) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["points", index, "input"], message: "Response-curve inputs must strictly increase" });
      }
    }
  }),
  z.object({
    state: z.literal("UNKNOWN"),
    inputMetric: stableId,
    outputMetric: stableId,
    reason: z.string().min(1),
    evidenceNeeded: z.array(z.string().min(1)).min(1),
  }).strict(),
]);
export type ResponseCurve = z.infer<typeof responseCurveSchema>;

export const opportunityAreaSchema = z.object({
  areaId: z.string().regex(/^area_[A-Za-z0-9._:-]+$/),
  source: z.enum(["DIAGNOSIS", "BUSINESS_STATE", "PROACTIVE"]),
  code: stableId,
  domain: opportunityDomainSchema,
  summary: z.string().min(1),
  diagnosisRefs: z.array(stableId),
  evidenceRefs: z.array(stableId),
  unresolvedQuestions: z.array(z.string().min(1)),
}).strict();
export type OpportunityArea = z.infer<typeof opportunityAreaSchema>;

export const mechanismSchema = z.object({
  primaryLever: z.enum([
    "TRAFFIC",
    "CONVERSION",
    "AOV",
    "CAC",
    "MARGIN",
    "INVENTORY",
    "REPEAT_RATE",
    "RETENTION",
    "RETURN_RATE",
    "FULFILLMENT_COST",
    "MEASUREMENT_QUALITY",
  ]),
  steps: z.array(z.object({
    from: stableId,
    to: stableId,
    relation: z.enum(["INCREASES", "DECREASES", "PROTECTS", "ENABLES", "MEASURES"]),
  }).strict()).min(1),
  terminalOutcome: z.literal("contribution_profit"),
}).strict();

export const consequenceSchema = z.object({
  dimension: z.enum([
    "CANNIBALIZATION",
    "CROSS_CHANNEL",
    "INVENTORY",
    "CUSTOMER",
    "PROMOTION",
    "OPERATIONAL",
  ]),
  state: z.enum(["ESTIMATED", "UNKNOWN", "NOT_APPLICABLE"]),
  direction: z.enum(["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL", "UNKNOWN"]),
  impact: boundedEstimateSchema.optional(),
  evidenceRefs: z.array(stableId),
  notes: z.array(z.string().min(1)),
}).strict().superRefine((value, ctx) => {
  if (value.state === "ESTIMATED" && value.impact?.state !== "ESTIMATED") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["impact"], message: "Estimated consequence requires estimated impact" });
  }
});
export type OpportunityConsequence = z.infer<typeof consequenceSchema>;

export const constraintCheckSchema = z.object({
  constraintId: stableId,
  status: z.enum(["SATISFIED", "VIOLATED", "UNKNOWN"]),
  evidenceRefs: z.array(stableId),
  reasons: z.array(z.string().min(1)),
}).strict();

export const feasibilitySchema = z.object({
  status: z.enum(["FEASIBLE", "BLOCKED", "UNKNOWN"]),
  requiredCapabilities: z.array(stableId),
  missingCapabilities: z.array(stableId),
  reasons: z.array(z.string().min(1)),
}).strict();

export const impactSchema = z.object({
  addressableUpside: boundedEstimateSchema,
  responseCurve: responseCurveSchema,
  incrementalRevenue: boundedEstimateSchema,
  grossProfit: boundedEstimateSchema,
  contributionProfit: boundedEstimateSchema,
  incrementalCustomers: boundedEstimateSchema,
  conversionRateChange: boundedEstimateSchema,
  inventoryChange: boundedEstimateSchema,
  retentionChange: boundedEstimateSchema,
  cacChange: boundedEstimateSchema,
  cashRequirement: boundedEstimateSchema,
  confidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
  uncertaintyReasons: z.array(z.string().min(1)),
}).strict();
export type OpportunityImpact = z.infer<typeof impactSchema>;

export const measurementPlanSchema = z.object({
  primaryMetric: stableId,
  secondaryMetrics: z.array(stableId),
  guardrailMetrics: z.array(stableId),
  baseline: z.discriminatedUnion("state", [
    z.object({ state: z.literal("KNOWN"), value: finite, unit: estimateUnitSchema, evidenceRefs: z.array(stableId).min(1) }).strict(),
    z.object({ state: z.literal("UNKNOWN"), reason: z.string().min(1) }).strict(),
  ]),
  horizon: z.object({ amount: z.number().int().positive(), unit: z.enum(["DAY", "WEEK"]) }).strict(),
  successDirection: z.enum(["INCREASE", "DECREASE", "MAINTAIN", "OBSERVE"]),
  evidenceRequired: z.array(z.string().min(1)).min(1),
}).strict();

export const rollbackConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("HARD_CONSTRAINT_VIOLATION"),
    action: z.enum(["STOP", "ROLLBACK", "RECONSIDER"]),
  }).strict(),
  z.object({
    kind: z.literal("GUARDRAIL_BREACH"),
    metricRef: stableId,
    policyRef: stableId,
    action: z.enum(["STOP", "ROLLBACK", "RECONSIDER"]),
  }).strict(),
  z.object({
    kind: z.literal("EVIDENCE_INVALIDATED"),
    action: z.literal("RECONSIDER"),
  }).strict(),
  z.object({
    kind: z.literal("DEPENDENCY_FAILED"),
    dependencyRef: stableId,
    action: z.enum(["STOP", "RECONSIDER"]),
  }).strict(),
]);

export const evidenceTraceSchema = z.object({
  diagnosisRefs: z.array(stableId),
  businessStateEvidenceRefs: z.array(stableId),
  estimationEvidenceRefs: z.array(stableId),
  facts: z.array(z.object({ factId: stableId, statement: z.string().min(1), evidenceRefs: z.array(stableId).min(1) }).strict()),
  assumptions: z.array(z.object({ assumptionId: stableId, statement: z.string().min(1), validationNeeded: z.string().min(1) }).strict()),
}).strict();

export const prioritizationInputsSchema = z.object({
  expectedContributionImpact: boundedEstimateSchema,
  uncertainty: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  cost: boundedEstimateSchema,
  effort: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  reversibility: z.enum(["FULL", "PARTIAL", "NONE", "UNKNOWN"]),
  timeToImpact: boundedEstimateSchema,
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  dependencies: z.array(z.string().regex(/^opp_[A-Za-z0-9._:-]+$/)),
}).strict();

export const opportunitySchema = z.object({
  version: z.literal(OPPORTUNITY_SCHEMA_VERSION),
  opportunityId: z.string().regex(/^opp_[A-Za-z0-9._:-]+$/),
  areaId: z.string().regex(/^area_[A-Za-z0-9._:-]+$/),
  merchantId: stableId,
  createdAt: z.string().datetime(),
  domain: opportunityDomainSchema,
  title: z.string().min(1),
  status: z.enum(["ACTIONABLE", "POTENTIAL", "INSUFFICIENT_EVIDENCE", "NO_ACTION"]),
  intervention: z.object({
    templateId: stableId,
    actionType: stableId,
    target: opportunityTargetSchema,
    parameters: interventionParametersSchema,
    mechanism: mechanismSchema,
    requiredResources: z.array(stableId),
  }).strict(),
  impact: impactSchema,
  constraints: z.array(constraintCheckSchema),
  feasibility: feasibilitySchema,
  consequences: z.array(consequenceSchema).length(6).superRefine((values, ctx) => {
    if (new Set(values.map((value) => value.dimension)).size !== 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "All six consequence dimensions must be represented exactly once" });
    }
  }),
  conflicts: z.array(stableId),
  mutuallyExclusiveGroup: stableId.optional(),
  prioritization: prioritizationInputsSchema,
  measurement: measurementPlanSchema,
  rollbackConditions: z.array(rollbackConditionSchema).min(1),
  evidence: evidenceTraceSchema,
  canonicalAction: actionSpaceCanonicalActionSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "NO_ACTION") {
    if (value.domain !== "NO_ACTION" || !value.intervention.actionType.startsWith("no_op.")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "NO_ACTION opportunity must use the no-action domain and action type" });
    }
  }
  if (value.status === "ACTIONABLE") {
    if (value.intervention.target.state !== "RESOLVED") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["intervention", "target"], message: "Actionable opportunity requires resolved target" });
    }
    if (value.intervention.parameters.state === "NEEDS_INPUT") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["intervention", "parameters"], message: "Actionable opportunity requires executable parameters" });
    }
    if (value.feasibility.status !== "FEASIBLE") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["feasibility"], message: "Actionable opportunity must be feasible" });
    }
  }
  if (value.evidence.facts.some((fact) => value.evidence.assumptions.some((assumption) => assumption.assumptionId === fact.factId))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "Facts and assumptions must have distinct identities" });
  }
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const opportunitySetSchema = z.object({
  engineVersion: z.literal(OPPORTUNITY_ENGINE_VERSION),
  merchantId: stableId,
  asOf: z.string().datetime(),
  areas: z.array(opportunityAreaSchema),
  opportunities: z.array(opportunitySchema).min(1),
  evidenceComplete: z.boolean(),
}).strict();
export type OpportunitySet = z.infer<typeof opportunitySetSchema>;

export const opportunityPortfolioSchema = z.object({
  portfolioId: z.string().regex(/^portfolio_[A-Za-z0-9._:-]+$/),
  opportunityIds: z.array(z.string().regex(/^opp_[A-Za-z0-9._:-]+$/)).min(1),
  status: z.enum(["VALID", "BLOCKED", "UNKNOWN"]),
  dependencyIssues: z.array(z.string().min(1)),
  conflictIssues: z.array(z.string().min(1)),
  aggregateContributionImpact: boundedEstimateSchema,
  aggregateCost: boundedEstimateSchema,
  aggregateRisk: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
}).strict();
export type OpportunityPortfolio = z.infer<typeof opportunityPortfolioSchema>;

export function unknownEstimate(unit: EstimateUnit, reason: string, evidenceNeeded: readonly string[]): BoundedEstimate {
  return { state: "UNKNOWN", unit, reason, evidenceNeeded: [...evidenceNeeded] };
}

export function estimatedRange(
  unit: EstimateUnit,
  low: number,
  base: number,
  high: number,
  evidenceRefs: readonly string[],
  method: "EXPERIMENT" | "CAUSAL_MODEL" | "OBSERVATIONAL_BOUND" | "ACCOUNTING" | "RESPONSE_CURVE",
): BoundedEstimate {
  return boundedEstimateSchema.parse({ state: "ESTIMATED", unit, low, base, high, evidenceRefs: [...evidenceRefs], method });
}
