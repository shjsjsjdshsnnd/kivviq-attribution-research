import { z } from "zod";
import {
  constraintReferenceSchema,
  constraintTargetSchema,
  constraintThresholdSchema,
  constraintValueReferenceSchema,
  hardConstraintsSchema,
  moneyThresholdSchema,
  percentageThresholdSchema,
  scalarThresholdSchema,
  versionedRuleIdentitySchema,
  type ConstraintTarget,
  type ConstraintThreshold,
  type HardConstraint,
} from "./schema.js";

const identitySchema = z.string().min(1);
const evaluationBoundarySchema = z.enum([
  "DECISION_TIME",
  "TRANSLATION_TIME",
  "EFFECTIVE_TIME",
]);
const valueBasisSchema = z.enum(["CURRENT_STATE", "PROJECTED_AFTER_ACTION"]);
const statusValueSchema = z
  .object({ valueType: z.literal("STATUS"), status: z.enum(["AVAILABLE", "UNAVAILABLE"]) })
  .strict();
const observedValueSchema = z.union([constraintThresholdSchema, statusValueSchema]);
const horizonSchema = z
  .object({ amount: z.number().int().positive().safe(), unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH"]) })
  .strict();

const evidenceCommon = {
  evidenceRef: constraintReferenceSchema,
  actionId: identitySchema,
  actionFingerprint: identitySchema,
  constraintId: constraintReferenceSchema,
  target: constraintTargetSchema,
  evaluationBoundary: evaluationBoundarySchema,
  observedAt: z.string().datetime(),
  sourceRef: constraintReferenceSchema,
  provenance: z.array(identitySchema).min(1).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: `Duplicate provenance entry: ${value}` });
      seen.add(value);
    });
  }),
  maximumAgeSeconds: z.number().int().nonnegative().safe().optional(),
};

export const constraintEvidenceReceiptSchema = z.union([
  z.object({ ...evidenceCommon, fact: z.object({ kind: z.literal("VALUE"), valueRef: constraintValueReferenceSchema, valueBasis: valueBasisSchema.optional(), value: observedValueSchema }).strict() }).strict(),
  z.object({ ...evidenceCommon, fact: z.object({ kind: z.literal("RULE_DECISION"), rule: versionedRuleIdentitySchema, decision: z.enum(["ALLOW", "DENY"]) }).strict() }).strict(),
  z.object({ ...evidenceCommon, fact: z.object({ kind: z.literal("RISK"), metricRef: constraintReferenceSchema, valueBasis: valueBasisSchema, horizon: horizonSchema, value: z.union([scalarThresholdSchema, percentageThresholdSchema, moneyThresholdSchema]) }).strict() }).strict(),
  z.object({ ...evidenceCommon, fact: z.object({ kind: z.literal("CUSTOM"), registryRef: constraintReferenceSchema, code: constraintReferenceSchema, decision: z.enum(["SATISFIED", "VIOLATED", "UNKNOWN"]) }).strict() }).strict(),
]);

export const constraintAssessmentContextSchema = z.object({
  evaluatedAt: z.string().datetime(),
  maximumAgeSeconds: z.number().int().nonnegative().safe().optional(),
  receipts: z.array(constraintEvidenceReceiptSchema).superRefine((receipts, context) => {
    const seen = new Set<string>();
    receipts.forEach((receipt, index) => {
      if (seen.has(receipt.evidenceRef)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "evidenceRef"], message: `Duplicate evidenceRef: ${receipt.evidenceRef}` });
      seen.add(receipt.evidenceRef);
    });
  }),
}).strict();

const resourceRequirementSchema = z.object({
  resourceRequirementId: constraintReferenceSchema,
  value: constraintThresholdSchema,
}).strict();

export const hardConstraintAssessmentInputSchema = z.object({
  actionId: identitySchema,
  actionFingerprint: identitySchema,
  constraints: hardConstraintsSchema,
  resourceRequirements: z.array(resourceRequirementSchema).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value.resourceRequirementId)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "resourceRequirementId"], message: "Duplicate resourceRequirementId" });
      seen.add(value.resourceRequirementId);
    });
  }),
}).strict();

export const constraintAssessmentSchema = z.object({
  constraintId: constraintReferenceSchema,
  actionId: identitySchema,
  actionFingerprint: identitySchema,
  status: z.enum(["SATISFIED", "VIOLATED", "UNKNOWN"]),
  reasonCode: constraintReferenceSchema,
  observedValue: observedValueSchema.optional(),
  targetRef: identitySchema,
  evaluationBoundary: evaluationBoundarySchema,
  observedAt: z.string().datetime(),
  evidenceRefs: z.array(constraintReferenceSchema),
  provenance: z.array(identitySchema),
}).strict();

export const constraintAssessmentReportSchema = z.object({
  actionId: identitySchema,
  actionFingerprint: identitySchema,
  evaluatedAt: z.string(),
  valid: z.boolean(),
  errors: z.array(z.string()),
  assessments: z.array(constraintAssessmentSchema),
}).strict();

export type ConstraintEvidenceReceipt = z.infer<typeof constraintEvidenceReceiptSchema>;
export type ConstraintAssessmentContext = z.infer<typeof constraintAssessmentContextSchema>;
export type HardConstraintAssessmentInput = z.infer<typeof hardConstraintAssessmentInputSchema>;
export type ConstraintAssessment = z.infer<typeof constraintAssessmentSchema>;
export type ConstraintAssessmentReport = z.infer<typeof constraintAssessmentReportSchema>;

function targetRef(target: ConstraintTarget): string {
  if (target.kind === "GLOBAL") return "GLOBAL";
  if (target.kind === "FAMILY") return `FAMILY:${target.family}`;
  return `${target.kind}:${target.ref}`;
}

function sameTarget(left: ConstraintTarget, right: ConstraintTarget): boolean {
  return targetRef(left) === targetRef(right);
}

function sameRef(left: { kind: string; ref: string }, right: { kind: string; ref: string }): boolean {
  return left.kind === right.kind && left.ref === right.ref;
}

function sameRule(left: z.infer<typeof versionedRuleIdentitySchema>, right: z.infer<typeof versionedRuleIdentitySchema>): boolean {
  return left.registryRef === right.registryRef && left.ruleId === right.ruleId && left.version === right.version && left.effectiveFrom === right.effectiveFrom && left.effectiveUntil === right.effectiveUntil;
}

function compareValues(observed: ConstraintThreshold, threshold: ConstraintThreshold, comparator: "LTE" | "GTE" | "EQ"): boolean | undefined {
  if (observed.valueType !== threshold.valueType) return undefined;
  let left: number;
  let right: number;
  if (observed.valueType === "MONEY" && threshold.valueType === "MONEY") {
    if (observed.currency !== threshold.currency) return undefined;
    left = observed.amountMinor; right = threshold.amountMinor;
  } else if (observed.valueType === "PERCENTAGE" && threshold.valueType === "PERCENTAGE") {
    left = observed.basisPoints; right = threshold.basisPoints;
  } else if (observed.valueType === "QUANTITY" && threshold.valueType === "QUANTITY") {
    if (observed.unit !== threshold.unit) return undefined;
    left = observed.value; right = threshold.value;
  } else if (observed.valueType === "SCALAR" && threshold.valueType === "SCALAR") {
    if (observed.unit !== threshold.unit) return undefined;
    left = observed.value; right = threshold.value;
  } else return undefined;
  return comparator === "LTE" ? left <= right : comparator === "GTE" ? left >= right : left === right;
}

function baseAssessment(input: HardConstraintAssessmentInput, constraint: HardConstraint, evaluatedAt: string): ConstraintAssessment {
  return {
    constraintId: constraint.constraintId,
    actionId: input.actionId,
    actionFingerprint: input.actionFingerprint,
    status: "UNKNOWN",
    reasonCode: "MISSING_BOUND_EVIDENCE",
    targetRef: targetRef(constraint.target),
    evaluationBoundary: constraint.evaluationBoundary,
    observedAt: evaluatedAt,
    evidenceRefs: [],
    provenance: [],
  };
}

function withReceipt(base: ConstraintAssessment, receipt: ConstraintEvidenceReceipt): ConstraintAssessment {
  return { ...base, observedAt: receipt.observedAt, evidenceRefs: [receipt.evidenceRef], provenance: receipt.provenance };
}

function receiptFreshness(receipt: ConstraintEvidenceReceipt, context: ConstraintAssessmentContext): "FUTURE_EVIDENCE" | "STALE_EVIDENCE" | undefined {
  const evaluated = Date.parse(context.evaluatedAt);
  const observed = Date.parse(receipt.observedAt);
  if (observed > evaluated) return "FUTURE_EVIDENCE";
  const freshnessLimits = [receipt.maximumAgeSeconds, context.maximumAgeSeconds].filter(
    (value): value is number => value !== undefined,
  );
  const maximum = freshnessLimits.length > 0 ? Math.min(...freshnessLimits) : undefined;
  if (maximum !== undefined && evaluated - observed > maximum * 1000) return "STALE_EVIDENCE";
  return undefined;
}

function selectReceipts(input: HardConstraintAssessmentInput, constraint: HardConstraint, context: ConstraintAssessmentContext): ConstraintEvidenceReceipt[] {
  return context.receipts.filter((receipt) => receipt.actionId === input.actionId && receipt.actionFingerprint === input.actionFingerprint && receipt.constraintId === constraint.constraintId && receipt.evaluationBoundary === constraint.evaluationBoundary && sameTarget(receipt.target, constraint.target));
}

function assessOne(input: HardConstraintAssessmentInput, constraint: HardConstraint, context: ConstraintAssessmentContext): ConstraintAssessment {
  const base = baseAssessment(input, constraint, context.evaluatedAt);
  const receipts = selectReceipts(input, constraint, context);
  if (receipts.length === 0) return base;
  if (receipts.length > 1) {
    return {
      ...base,
      reasonCode: "AMBIGUOUS_BOUND_EVIDENCE",
      evidenceRefs: receipts.map(({ evidenceRef }) => evidenceRef).sort(),
      provenance: [...new Set(receipts.flatMap(({ provenance }) => provenance))].sort(),
    };
  }
  const receipt = receipts[0]!;
  const assessment = withReceipt(base, receipt);
  const freshness = receiptFreshness(receipt, context);
  if (freshness) return { ...assessment, reasonCode: freshness };

  const derived = (satisfied: boolean, observedValue?: ConstraintThreshold): ConstraintAssessment => ({
    ...assessment,
    status: satisfied ? "SATISFIED" : "VIOLATED",
    reasonCode: satisfied ? "CONSTRAINT_SATISFIED" : "CONSTRAINT_VIOLATED",
    ...(observedValue ? { observedValue } : {}),
  });
  const incompatible = (observedValue?: ConstraintThreshold): ConstraintAssessment => ({ ...assessment, status: "VIOLATED", reasonCode: "INCOMPATIBLE_VALUE", ...(observedValue ? { observedValue } : {}) });
  const missingComparable = (): ConstraintAssessment => ({ ...assessment, reasonCode: "MISSING_COMPARABLE_FACT" });

  if (constraint.kind === "CUSTOM") {
    if (receipt.fact.kind !== "CUSTOM" || receipt.fact.registryRef !== constraint.registryRef || receipt.fact.code !== constraint.code) return missingComparable();
    return { ...assessment, status: receipt.fact.decision, reasonCode: receipt.fact.decision === "UNKNOWN" ? "CUSTOM_ASSESSMENT_UNKNOWN" : `CUSTOM_${receipt.fact.decision}` };
  }
  if (constraint.kind === "MERCHANT_POLICY" || constraint.kind === "CONTRACTUAL_RESTRICTION") {
    if (receipt.fact.kind !== "RULE_DECISION" || !sameRule(receipt.fact.rule, constraint.rule)) return missingComparable();
    const startsAt = Date.parse(constraint.rule.effectiveFrom);
    const endsAt = constraint.rule.effectiveUntil === undefined ? undefined : Date.parse(constraint.rule.effectiveUntil);
    const evaluationTime = Date.parse(context.evaluatedAt);
    if (evaluationTime < startsAt || (endsAt !== undefined && evaluationTime >= endsAt)) return { ...assessment, reasonCode: "RULE_NOT_EFFECTIVE" };
    const observationTime = Date.parse(receipt.observedAt);
    if (observationTime < startsAt || (endsAt !== undefined && observationTime >= endsAt)) return { ...assessment, reasonCode: "EVIDENCE_OUTSIDE_RULE_INTERVAL" };
    return derived(receipt.fact.decision === constraint.expectedDecision);
  }
  if (constraint.kind === "RISK_LIMIT") {
    if (receipt.fact.kind !== "RISK" || receipt.fact.metricRef !== constraint.metricRef || receipt.fact.valueBasis !== constraint.valueBasis || receipt.fact.horizon.amount !== constraint.horizon.amount || receipt.fact.horizon.unit !== constraint.horizon.unit) return missingComparable();
    const compared = compareValues(receipt.fact.value, constraint.threshold, constraint.comparator);
    return compared === undefined ? incompatible(receipt.fact.value) : derived(compared, receipt.fact.value);
  }
  if (receipt.fact.kind !== "VALUE") return missingComparable();

  if (constraint.kind === "CHANNEL_AVAILABILITY") {
    if (!sameRef(receipt.fact.valueRef, constraint.availabilityFact)) return missingComparable();
    if (receipt.fact.value.valueType !== "STATUS") return incompatible();
    return { ...assessment, status: receipt.fact.value.status === constraint.expectedStatus ? "SATISFIED" : "VIOLATED", reasonCode: receipt.fact.value.status === constraint.expectedStatus ? "CONSTRAINT_SATISFIED" : "CONSTRAINT_VIOLATED", observedValue: receipt.fact.value };
  }
  if (constraint.kind === "AVAILABLE_BUDGET" || constraint.kind === "INVENTORY_AVAILABILITY" || constraint.kind === "OPERATIONAL_CAPACITY") {
    if (!sameRef(receipt.fact.valueRef, constraint.availableValue)) return missingComparable();
    const requirement = input.resourceRequirements.find((value) => value.resourceRequirementId === constraint.resourceRequirementId);
    if (!requirement) return { ...assessment, reasonCode: "MISSING_RESOURCE_REQUIREMENT" };
    if (receipt.fact.value.valueType === "STATUS") return incompatible();
    const compared = compareValues(receipt.fact.value, requirement.value, "GTE");
    return compared === undefined ? incompatible(receipt.fact.value) : derived(compared, receipt.fact.value);
  }
  if (!sameRef(receipt.fact.valueRef, constraint.observedValue) || receipt.fact.valueBasis !== constraint.valueBasis) return missingComparable();
  if (receipt.fact.value.valueType === "STATUS") return incompatible();
  const compared = compareValues(receipt.fact.value, constraint.threshold, constraint.comparator);
  return compared === undefined ? incompatible(receipt.fact.value) : derived(compared, receipt.fact.value);
}

export function assessHardConstraints(inputValue: unknown, contextValue: unknown): ConstraintAssessmentReport {
  const input = hardConstraintAssessmentInputSchema.safeParse(inputValue);
  const context = constraintAssessmentContextSchema.safeParse(contextValue);
  const fallback = inputValue as Partial<HardConstraintAssessmentInput>;
  const actionId = typeof fallback?.actionId === "string" ? fallback.actionId : "invalid-action";
  const actionFingerprint = typeof fallback?.actionFingerprint === "string" ? fallback.actionFingerprint : "invalid-fingerprint";
  const evaluatedAt = typeof (contextValue as { evaluatedAt?: unknown })?.evaluatedAt === "string" ? (contextValue as { evaluatedAt: string }).evaluatedAt : "invalid-time";
  if (!input.success || !context.success) {
    const constraints = input.success ? input.data.constraints : Array.isArray(fallback?.constraints) ? fallback.constraints.filter((value): value is HardConstraint => hardConstraintsSchema.safeParse([value]).success) : [];
    const errors = [...(input.success ? [] : input.error.issues.map((issue) => issue.message)), ...(context.success ? [] : context.error.issues.map((issue) => issue.message))];
    return {
      actionId,
      actionFingerprint,
      evaluatedAt,
      valid: false,
      errors,
      assessments: constraints.map((constraint) => ({ ...baseAssessment({ actionId, actionFingerprint, constraints, resourceRequirements: [] }, constraint, Number.isFinite(Date.parse(evaluatedAt)) ? evaluatedAt : new Date(0).toISOString()), observedAt: Number.isFinite(Date.parse(evaluatedAt)) ? evaluatedAt : new Date(0).toISOString(), reasonCode: "INVALID_EVIDENCE_CONTEXT" })),
    };
  }
  return { actionId: input.data.actionId, actionFingerprint: input.data.actionFingerprint, evaluatedAt: context.data.evaluatedAt, valid: true, errors: [], assessments: input.data.constraints.map((constraint) => assessOne(input.data, constraint, context.data)) };
}
