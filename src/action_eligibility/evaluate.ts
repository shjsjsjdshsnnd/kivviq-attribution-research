import { z } from "zod";
import { assessHardConstraints, constraintEvidenceReceiptSchema } from "../action_constraints/index.js";
import { constraintThresholdSchema, hardConstraintsSchema, type ConstraintThreshold, type HardConstraint } from "../action_constraints/schema.js";
import { ACTION_CATEGORIES, type ActionTarget, type ConstraintExpression, type ScalarValue } from "../action_ontology/types.js";
import { canonicalActionSchema, type CanonicalAction } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import { decisionWhatSchema } from "../decision_forms/index.js";
import { experimentWhatSchema } from "../experiment/index.js";
import { lifecycleWhatSchema } from "../lifecycle/canonical.js";
import { actionEligibilitySchema, type ActionEligibility, type EligibilityCheck, type EligibilityFailure } from "./schema.js";

const utcZSchema = z.string().datetime().regex(/Z$/);
const scalarValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amountMinor: z.number().finite(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  z.object({ kind: z.literal("money_rate"), amountMinor: z.number().finite(), currency: z.string().regex(/^[A-Z]{3}$/), per: z.enum(["day", "week", "month"]) }).strict(),
  z.object({ kind: z.literal("percentage"), basisPoints: z.number().finite() }).strict(),
  z.object({ kind: z.literal("quantity"), value: z.number().finite(), unit: z.enum(["units", "hours", "messages", "sessions", "customers", "orders", "days", "seconds"]) }).strict(),
  z.object({ kind: z.literal("frequency"), count: z.number().finite(), per: z.enum(["day", "week", "month"]) }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("string"), value: z.string() }).strict(),
]);

const targetRefSchema = z.string().regex(/^eligibility-target:fnv1a64:[0-9a-f]{16}$/);
const entityRefSchema = z.string().regex(/^eligibility-entity:fnv1a64:[0-9a-f]{16}$/);
const commonEvidence = {
  evidenceRef: z.string().min(1),
  actionId: z.string().min(1),
  actionFingerprint: z.string().min(1),
  targetRef: targetRefSchema,
  evaluationBoundary: z.literal("DECISION_TIME"),
  observedAt: utcZSchema,
  sourceRef: z.string().min(1),
  provenance: z.array(z.string().min(1)).min(1),
};
export const eligibilityEvidenceObservationSchema = z.discriminatedUnion("kind", [
  z.object({ ...commonEvidence, kind: z.literal("PROPERTY"), propertyId: z.string().min(1), value: scalarValueSchema }).strict(),
  z.object({ ...commonEvidence, kind: z.literal("ENTITY"), entityRef: entityRefSchema, exists: z.boolean() }).strict(),
  z.object({ ...commonEvidence, kind: z.literal("CAPABILITY"), capabilityId: z.string().min(1), available: z.boolean() }).strict(),
  z.object({ ...commonEvidence, kind: z.literal("EVIDENCE"), reference: z.string().min(1), available: z.boolean() }).strict(),
]);

const resourceRequirementSchema = z.object({ resourceRequirementId: z.string().min(1), value: constraintThresholdSchema }).strict();
const inputSchema = z.object({
  action: z.unknown(),
  nativeConstraints: z.unknown().optional(),
}).strict();
const nativeConstraintsSchema = z.object({
  constraints: hardConstraintsSchema,
  resourceRequirements: z.array(resourceRequirementSchema),
}).strict();
const contextSchema = z.object({
  evaluatedAt: utcZSchema,
  maximumAgeSeconds: z.number().int().nonnegative().safe().optional(),
  observations: z.array(eligibilityEvidenceObservationSchema).superRefine((observations, context) => {
    const seen = new Set<string>();
    observations.forEach((observation, index) => {
      if (seen.has(observation.evidenceRef))
        context.addIssue({ code: "custom", path: [index, "evidenceRef"], message: `Duplicate evidenceRef: ${observation.evidenceRef}` });
      seen.add(observation.evidenceRef);
    });
  }),
  constraintReceipts: z.array(constraintEvidenceReceiptSchema).optional(),
}).strict();

export type EligibilityEvidenceObservation = z.infer<typeof eligibilityEvidenceObservationSchema>;
export type ActionEligibilityResult =
  | { readonly ok: true; readonly result: ActionEligibility }
  | { readonly ok: false; readonly failure: EligibilityFailure };

function failure(code: EligibilityFailure["code"], messages: string[]): ActionEligibilityResult {
  return { ok: false, failure: { code, messages } };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1)
    hash = ((hash ^ BigInt(value.charCodeAt(index))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, "0");
}

export function legacyEntityTargetRef(target: ActionTarget): string {
  return `eligibility-entity:fnv1a64:${fnv1a64(stable(target))}`;
}

function canonicalTargetProjection(action: CanonicalAction): unknown {
  const what = action.what;
  if ("kind" in what && what.kind === "legacy_business")
    return { kind: "LEGACY_BUSINESS_TARGET", target: what.target };
  const experiment = experimentWhatSchema.safeParse(what);
  if (experiment.success)
    return { kind: "EXPERIMENT_POPULATION", population: action.population };
  const decision = decisionWhatSchema.safeParse(what);
  if (decision.success) {
    if (decision.data.actionType === "investigation.inspect")
      return { kind: "INVESTIGATION_TARGETS", targets: decision.data.targets, population: action.population };
    return { kind: "DECISION_SCOPE", actionType: decision.data.actionType, scope: decision.data.scope, population: action.population };
  }
  const lifecycle = lifecycleWhatSchema.parse(what);
  if (lifecycle.actionType === "lifecycle.send")
    return { kind: "LIFECYCLE_SEND", channel: lifecycle.channel, purpose: lifecycle.purpose, population: action.population };
  if (lifecycle.actionType === "lifecycle.start_flow")
    return { kind: "LIFECYCLE_FLOW", flowId: lifecycle.flow.flowId, population: action.population };
  if (lifecycle.actionType === "lifecycle.stop_flow" || lifecycle.actionType === "lifecycle.modify_flow")
    return { kind: "LIFECYCLE_FLOW", flowId: lifecycle.flowId };
  if (lifecycle.actionType === "lifecycle.adjust_frequency")
    return { kind: "LIFECYCLE_FREQUENCY", channel: lifecycle.channel, population: action.population };
  if (lifecycle.actionType === "lifecycle.adjust_contact_policy")
    return { kind: "LIFECYCLE_CONTACT_POLICY", policyId: lifecycle.policyId };
  return { kind: "LIFECYCLE_ROLLBACK", targetId: lifecycle.targetId };
}

export function canonicalEligibilityTargetRef(input: CanonicalAction): string {
  const action = canonicalActionSchema.parse(input);
  return `eligibility-target:fnv1a64:${fnv1a64(stable(canonicalTargetProjection(action)))}`;
}

function sameScalarKind(left: ScalarValue, right: ScalarValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "money" && right.kind === "money") return left.currency === right.currency;
  if (left.kind === "money_rate" && right.kind === "money_rate") return left.currency === right.currency && left.per === right.per;
  if (left.kind === "quantity" && right.kind === "quantity") return left.unit === right.unit;
  if (left.kind === "frequency" && right.kind === "frequency") return left.per === right.per;
  return true;
}

function scalarPrimitive(value: ScalarValue): number | boolean | string {
  switch (value.kind) {
    case "money": case "money_rate": return value.amountMinor;
    case "percentage": return value.basisPoints;
    case "quantity": return value.value;
    case "frequency": return value.count;
    case "boolean": case "string": return value.value;
  }
}

function compare(left: ScalarValue, right: ScalarValue, operator: "LT" | "LTE" | "EQ" | "NEQ" | "GTE" | "GT"): boolean | undefined {
  if (!sameScalarKind(left, right)) return undefined;
  const l = scalarPrimitive(left), r = scalarPrimitive(right);
  if (operator === "EQ") return l === r;
  if (operator === "NEQ") return l !== r;
  if (typeof l !== "number" || typeof r !== "number") return undefined;
  if (operator === "LT") return l < r;
  if (operator === "LTE") return l <= r;
  if (operator === "GTE") return l >= r;
  return l > r;
}

function observationKey(expression: ConstraintExpression): string {
  switch (expression.kind) {
    case "property_comparison": return `property:${expression.propertyId}`;
    case "entity_exists": return `entity:${stable(expression.target)}`;
    case "capability_available": return `capability:${expression.capabilityId}`;
    case "evidence_available": return `evidence:${expression.evidenceRef}`;
  }
}

function matches(expression: ConstraintExpression, observation: EligibilityEvidenceObservation): boolean {
  if (expression.kind === "property_comparison") return observation.kind === "PROPERTY" && observation.propertyId === expression.propertyId;
  if (expression.kind === "entity_exists") return observation.kind === "ENTITY" && observation.entityRef === legacyEntityTargetRef(expression.target);
  if (expression.kind === "capability_available") return observation.kind === "CAPABILITY" && observation.capabilityId === expression.capabilityId;
  return observation.kind === "EVIDENCE" && observation.reference === expression.evidenceRef;
}

function checkExpression(
  expression: ConstraintExpression,
  observations: readonly EligibilityEvidenceObservation[],
  evaluatedAt: string,
  maximumAgeSeconds: number | undefined,
): Omit<EligibilityCheck, "kind" | "checkId"> {
  if (observations.length === 0) return { status: "UNKNOWN", reasonCodes: ["MISSING_BOUND_EVIDENCE"], evidenceRefs: [], missingInformation: [observationKey(expression)] };
  if (observations.length > 1) return { status: "UNKNOWN", reasonCodes: ["AMBIGUOUS_BOUND_EVIDENCE"], evidenceRefs: uniqueSorted(observations.map((value) => value.evidenceRef)), missingInformation: [observationKey(expression)] };
  const observation = observations[0]!;
  const evidenceRefs = [observation.evidenceRef];
  const observed = Date.parse(observation.observedAt), evaluated = Date.parse(evaluatedAt);
  if (observed > evaluated) return { status: "UNKNOWN", reasonCodes: ["FUTURE_EVIDENCE"], evidenceRefs, missingInformation: [observationKey(expression)] };
  const expressionMaximumAge = expression.kind === "evidence_available" ? expression.maximumAgeSeconds : undefined;
  const freshnessLimits = [maximumAgeSeconds, expressionMaximumAge].filter((value): value is number => value !== undefined);
  const effectiveMaximumAge = freshnessLimits.length ? Math.min(...freshnessLimits) : undefined;
  if (effectiveMaximumAge !== undefined && evaluated - observed > effectiveMaximumAge * 1000)
    return { status: "UNKNOWN", reasonCodes: ["STALE_EVIDENCE"], evidenceRefs, missingInformation: [observationKey(expression)] };
  let satisfied: boolean | undefined;
  if (expression.kind === "property_comparison" && observation.kind === "PROPERTY") satisfied = compare(observation.value as ScalarValue, expression.value, expression.operator);
  else if (expression.kind === "entity_exists" && observation.kind === "ENTITY") satisfied = observation.exists;
  else if (expression.kind === "capability_available" && observation.kind === "CAPABILITY") satisfied = observation.available;
  else if (expression.kind === "evidence_available" && observation.kind === "EVIDENCE") satisfied = observation.available;
  if (satisfied === undefined) return { status: "VIOLATED", reasonCodes: ["INCOMPATIBLE_VALUE"], evidenceRefs, missingInformation: [] };
  const reason = expression.kind === "property_comparison"
    ? satisfied ? "COMPARISON_TRUE" : "COMPARISON_FALSE"
    : expression.kind === "entity_exists"
      ? satisfied ? "ENTITY_EXISTS" : "ENTITY_DOES_NOT_EXIST"
      : expression.kind === "capability_available"
        ? satisfied ? "CAPABILITY_AVAILABLE" : "CAPABILITY_UNAVAILABLE"
        : satisfied ? "EVIDENCE_AVAILABLE" : "EVIDENCE_UNAVAILABLE";
  return { status: satisfied ? "SATISFIED" : "VIOLATED", reasonCodes: [reason], evidenceRefs, missingInformation: [] };
}

function legacyChecks(action: CanonicalAction, observations: readonly EligibilityEvidenceObservation[], evaluatedAt: string, maximumAgeSeconds?: number): EligibilityCheck[] {
  if (!("kind" in action.what) || action.what.kind !== "legacy_business") return [];
  const fingerprint = fingerprintCanonicalAction(action);
  const targetRef = canonicalEligibilityTargetRef(action);
  const bound = observations.filter((entry) => entry.actionId === action.actionId && entry.actionFingerprint === fingerprint && entry.targetRef === targetRef && entry.evaluationBoundary === "DECISION_TIME");
  const checks: EligibilityCheck[] = [];
  for (const precondition of action.what.preconditions) {
    let outcome = checkExpression(precondition.expression, bound.filter((entry) => matches(precondition.expression, entry)), evaluatedAt, maximumAgeSeconds);
    if (outcome.status === "UNKNOWN" && precondition.whenUnknown === "ineligible") outcome = { ...outcome, status: "VIOLATED", reasonCodes: ["MISSING_INFORMATION_FAIL_CLOSED"] };
    checks.push({ kind: "PRECONDITION", checkId: precondition.preconditionId, ...outcome });
  }
  for (const constraint of action.what.constraints) {
    if (constraint.constraintClass !== "hard") continue;
    checks.push({ kind: "HARD_CONSTRAINT", checkId: constraint.constraintId, ...checkExpression(constraint.expression, bound.filter((entry) => matches(constraint.expression, entry)), evaluatedAt, maximumAgeSeconds) });
  }
  return checks;
}

function nativeChecks(action: CanonicalAction, native: { constraints: HardConstraint[]; resourceRequirements: { resourceRequirementId: string; value: ConstraintThreshold }[] } | undefined, context: z.infer<typeof contextSchema>): EligibilityCheck[] | undefined {
  if (!native) return [];
  const report = assessHardConstraints(
    { actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action), constraints: native.constraints, resourceRequirements: native.resourceRequirements },
    { evaluatedAt: context.evaluatedAt, ...(context.maximumAgeSeconds === undefined ? {} : { maximumAgeSeconds: context.maximumAgeSeconds }), receipts: context.constraintReceipts ?? [] },
  );
  if (!report.valid) return undefined;
  return report.assessments.map((assessment) => {
    const constraint = native.constraints.find((entry) => entry.constraintId === assessment.constraintId)!;
    const failClosed = assessment.status === "UNKNOWN" && constraint.whenUnknown === "INELIGIBLE";
    return {
      kind: "HARD_CONSTRAINT",
      checkId: assessment.constraintId,
      status: failClosed ? "VIOLATED" : assessment.status,
      reasonCodes: [failClosed ? "MISSING_INFORMATION_FAIL_CLOSED" : assessment.reasonCode],
      evidenceRefs: uniqueSorted(assessment.evidenceRefs),
      missingInformation: assessment.status === "UNKNOWN" ? [`constraint:${assessment.constraintId}`] : [],
    };
  });
}

export function evaluateActionEligibility(inputValue: unknown, contextValue: unknown): ActionEligibilityResult {
  const input = inputSchema.safeParse(inputValue);
  if (!input.success) return failure("INVALID_ACTION", input.error.issues.map((issue) => issue.message));
  const rawAction = input.data.action;
  if (
    rawAction !== null &&
    typeof rawAction === "object" &&
    "what" in rawAction &&
    rawAction.what !== null &&
    typeof rawAction.what === "object" &&
    "kind" in rawAction.what &&
    rawAction.what.kind === "legacy_business" &&
    "actionCategory" in rawAction.what &&
    typeof rawAction.what.actionCategory === "string" &&
    !ACTION_CATEGORIES.includes(rawAction.what.actionCategory as never)
  )
    return failure("UNSUPPORTED_ACTION_FAMILY", [
      `Unsupported action category: ${rawAction.what.actionCategory}`,
    ]);
  const action = canonicalActionSchema.safeParse(input.data.action);
  if (!action.success) return failure("INVALID_ACTION", action.error.issues.map((issue) => issue.message));
  const context = contextSchema.safeParse(contextValue);
  if (!context.success) return failure("INVALID_CONTEXT", context.error.issues.map((issue) => issue.message));
  const nativeConstraints = input.data.nativeConstraints === undefined
    ? undefined
    : nativeConstraintsSchema.safeParse(input.data.nativeConstraints);
  if (nativeConstraints !== undefined && !nativeConstraints.success)
    return failure("INVALID_NATIVE_CONSTRAINTS", nativeConstraints.error.issues.map((issue) => issue.message));
  const checks = legacyChecks(action.data, context.data.observations, context.data.evaluatedAt, context.data.maximumAgeSeconds);
  const native = nativeChecks(action.data, nativeConstraints?.data, context.data);
  if (native === undefined) return failure("INVALID_NATIVE_CONSTRAINTS", ["Native constraint assessment input or evidence is invalid"]);
  checks.push(...native);
  const status = checks.some((check) => check.status === "VIOLATED") ? "INELIGIBLE" : checks.some((check) => check.status === "UNKNOWN") ? "UNKNOWN" : "ELIGIBLE";
  return { ok: true, result: actionEligibilitySchema.parse({ actionId: action.data.actionId, actionFingerprint: fingerprintCanonicalAction(action.data), evaluatedAt: context.data.evaluatedAt, status, checks }) };
}
