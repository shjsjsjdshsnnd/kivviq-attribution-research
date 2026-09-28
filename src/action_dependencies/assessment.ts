import type { CanonicalAction } from "../canonical_action/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { CompoundAction } from "../compound_action/schema.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../compound_action/schema.js";
import { assessHardConstraints } from "../action_constraints/assessment.js";
import { evaluateActionEligibility } from "../action_eligibility/evaluate.js";
import { assessExperimentReadiness } from "../experiment/readiness.js";
import { experimentWhatSchema } from "../experiment/schema.js";
import { validateInvestigationResult } from "../investigation/index.js";
import { dependencyEvidenceReceiptSchema, type ActionDependency, type ActionLifecycleEvent, type CanonicalEntityReference, type DependencyEvidenceReceipt } from "./schema.js";

type RegistryEntry = { entityKind: "ACTION"; action: CanonicalAction } | { entityKind: "COMPOUND"; action: CompoundAction };
export interface DependencyCheck { dependencyId: string; kind: ActionDependency["kind"]; status: "SATISFIED" | "VIOLATED" | "UNKNOWN"; whenUnknown: ActionDependency["whenUnknown"]; evaluationBoundary: ActionDependency["evaluationBoundary"]; reasonCodes: string[]; evidenceRefs: string[]; missingInformation: string[]; }
export interface DependencyAssessment { actionId: string; actionFingerprint: string; evaluatedAt: string; evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME"; status: "READY" | "BLOCKED" | "UNKNOWN"; checks: DependencyCheck[]; assessmentFingerprint: string; }
export interface CompoundComponentOutcome { outcomeId: string; compoundActionId: string; compoundFingerprint: string; componentId: string; actionId: string; actionFingerprint: string; status: "FAILED" | "SKIPPED"; occurredAt: string; sourceRef: string; provenance: readonly string[]; }
export interface DependencyAssessmentContext { evaluatedAt: string; evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME"; maximumAgeSeconds?: number; registry: readonly RegistryEntry[]; dependencyReceipts: readonly unknown[]; compoundComponentOutcomes?: readonly CompoundComponentOutcome[]; investigationResults: readonly unknown[]; constraintReceipts: readonly unknown[]; eligibilityContexts: Readonly<Record<string, unknown>>; eligibilityResourceRequirements: Readonly<Record<string, readonly unknown[]>>; experimentReadinessContexts: Readonly<Record<string, unknown>>; }

function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 0xcbf29ce484222325n; for (const character of value) result = ((result ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n) & 0xffffffffffffffffn; return `fnv1a64:${result.toString(16).padStart(16, "0")}`; }
export function fingerprintDependencyAssessment(value: unknown): string { if (value && typeof value === "object") { const { assessmentFingerprint: _ignored, ...projection } = value as Record<string, unknown>; return hash(stable(projection)); } return hash(stable(value)); }
function check(dependency: ActionDependency, status: DependencyCheck["status"], reason: string, evidenceRefs: string[] = [], missingInformation: string[] = []): DependencyCheck { return { dependencyId: dependency.dependencyId, kind: dependency.kind, status, whenUnknown: dependency.whenUnknown, evaluationBoundary: dependency.evaluationBoundary, reasonCodes: [reason], evidenceRefs: [...new Set(evidenceRefs)].sort(), missingInformation: [...new Set(missingInformation)].sort() }; }
const unknown = (d: ActionDependency, r: string, m: string[] = []) => check(d, "UNKNOWN", r, [], m);
const satisfied = (d: ActionDependency, r: string, e: string[]) => check(d, "SATISFIED", r, e);
const violated = (d: ActionDependency, r: string, e: string[] = []) => check(d, "VIOLATED", r, e);
function registryKey(reference: CanonicalEntityReference): string { return reference.entityKind === "ACTION" ? `ACTION:${reference.actionId}` : `COMPOUND:${reference.compoundActionId}`; }
function entryKey(entry: RegistryEntry): string { return entry.entityKind === "ACTION" ? `ACTION:${entry.action.actionId}` : `COMPOUND:${entry.action.compoundActionId}`; }
function entryFingerprint(entry: RegistryEntry): string { return entry.entityKind === "ACTION" ? fingerprintCanonicalAction(entry.action) : fingerprintCompoundAction(entry.action); }
function expectedFingerprint(reference: CanonicalEntityReference): string { return reference.entityKind === "ACTION" ? reference.actionFingerprint : reference.compoundFingerprint; }
function referenceId(reference: CanonicalEntityReference): string { return reference.entityKind === "ACTION" ? reference.actionId : reference.compoundActionId; }
const rank = { STARTED: 1, EFFECTIVE: 2, COMPLETED: 3 } as const;

function lifecycleCheck(dependency: Extract<ActionDependency, { kind: "ENTITY_LIFECYCLE" }>, context: DependencyAssessmentContext, registry: readonly RegistryEntry[], receipt: DependencyEvidenceReceipt): DependencyCheck {
  const matches = registry.filter((entry) => entryKey(entry) === registryKey(dependency.prerequisite));
  if (!matches.length) return unknown(dependency, "MISSING_PREREQUISITE_REGISTRY", [referenceId(dependency.prerequisite)]);
  if (matches.length > 1) return unknown(dependency, "AMBIGUOUS_PREREQUISITE_REGISTRY", [referenceId(dependency.prerequisite)]);
  const entry = matches[0]!;
  if (entryFingerprint(entry) !== expectedFingerprint(dependency.prerequisite)) return violated(dependency, "PREREQUISITE_FINGERPRINT_MISMATCH");
  if (receipt.fact.kind !== "ENTITY_LIFECYCLE" || registryKey(receipt.fact.prerequisite) !== registryKey(dependency.prerequisite) || expectedFingerprint(receipt.fact.prerequisite) !== expectedFingerprint(dependency.prerequisite))
    return unknown(dependency, "LIFECYCLE_RECEIPT_FACT_MISMATCH", [dependency.dependencyId]);
  if (dependency.requiredState === "RESOLVED") {
    if (entry.entityKind !== "ACTION" || entry.action.what.actionType !== "investigation.inspect") return violated(dependency, "RESOLVED_REQUIRES_INVESTIGATION");
    const results = context.investigationResults.filter((candidate) => { if (!candidate || typeof candidate !== "object") return false; const result = candidate as Record<string, unknown>; return result["actionId"] === entry.action.actionId && result["actionFingerprint"] === entryFingerprint(entry); });
    if (!results.length) return unknown(dependency, "MISSING_INVESTIGATION_RESULT", [entry.action.actionId]);
    if (results.length > 1) return unknown(dependency, "AMBIGUOUS_INVESTIGATION_RESULT", [entry.action.actionId]);
    const result = results[0] as { status?: string; completedAt: string; evidenceCollected?: Array<{ artifactRef: string }> };
    const validation = validateInvestigationResult({ actionId: entry.action.actionId, actionFingerprint: entryFingerprint(entry), what: entry.action.what }, result);
    if (!validation.ok) return violated(dependency, "INVALID_INVESTIGATION_RESULT");
    if (result.status !== "RESOLVED") return violated(dependency, "INVESTIGATION_NOT_RESOLVED");
    const completed = Date.parse(result.completedAt), evaluated = Date.parse(context.evaluatedAt);
    if (completed > evaluated) return unknown(dependency, "FUTURE_INVESTIGATION_RESULT", [entry.action.actionId]);
    if (context.maximumAgeSeconds !== undefined && evaluated - completed > context.maximumAgeSeconds * 1000) return unknown(dependency, "STALE_INVESTIGATION_RESULT", [entry.action.actionId]);
    return satisfied(dependency, "INVESTIGATION_RESOLVED", result.evidenceCollected?.map((item) => item.artifactRef) ?? []);
  }
  const events = receipt.fact.events;
  const required = rank[dependency.requiredState];
  const componentActions = entry.entityKind === "ACTION" ? [entry.action] : entry.action.components.map((component) => component.action);
  const evidence: ActionLifecycleEvent[] = [];
  for (const action of componentActions) {
    const exact = events.filter((event) => event.subject.actionId === action.actionId && event.subject.actionFingerprint === fingerprintCanonicalAction(action) && rank[event.eventKind] >= required);
    if (exact.length > 1) return unknown(dependency, "AMBIGUOUS_LIFECYCLE_EVIDENCE", [action.actionId]);
    if (!exact.length && entry.entityKind === "COMPOUND" && dependency.requiredState === "COMPLETED") {
      const component = entry.action.components.find((candidate) => candidate.action.actionId === action.actionId)!;
      const outcomes = (context.compoundComponentOutcomes ?? []).filter((outcome) => outcome.compoundActionId === entry.action.compoundActionId && outcome.compoundFingerprint === entryFingerprint(entry) && outcome.componentId === component.componentId && outcome.actionId === action.actionId && outcome.actionFingerprint === fingerprintCanonicalAction(action));
      if (outcomes.length > 1) return unknown(dependency, "AMBIGUOUS_COMPONENT_OUTCOME", [component.componentId]);
      if (outcomes.length === 1) {
        const outcome = outcomes[0]!, occurred = Date.parse(outcome.occurredAt), evaluated = Date.parse(context.evaluatedAt);
        if (!outcome.occurredAt.endsWith("Z") || occurred > evaluated) return unknown(dependency, "INVALID_COMPONENT_OUTCOME", [component.componentId]);
        if (context.maximumAgeSeconds !== undefined && evaluated - occurred > context.maximumAgeSeconds * 1000) return unknown(dependency, "STALE_COMPONENT_OUTCOME", [component.componentId]);
        if (entry.action.atomicity === "ALL_OR_NOTHING") return violated(dependency, "ATOMIC_COMPOUND_COMPONENT_NOT_COMPLETED", [outcome.outcomeId, outcome.sourceRef, ...outcome.provenance]);
        continue;
      }
    }
    if (!exact.length) return unknown(dependency, "MISSING_LIFECYCLE_EVIDENCE", [action.actionId]);
    const event = exact[0]!, occurred = Date.parse(event.occurredAt), evaluated = Date.parse(context.evaluatedAt);
    if (occurred > evaluated) return unknown(dependency, "FUTURE_LIFECYCLE_EVIDENCE", [action.actionId]);
    if (context.maximumAgeSeconds !== undefined && evaluated - occurred > context.maximumAgeSeconds * 1000) return unknown(dependency, "STALE_LIFECYCLE_EVIDENCE", [action.actionId]);
    evidence.push(event);
  }
  return satisfied(dependency, "REQUIRED_LIFECYCLE_STATE_OBSERVED", evidence.flatMap((event) => [event.eventId, event.sourceRef, ...event.provenance]));
}

function constraintCheck(action: CanonicalAction, dependency: Extract<ActionDependency, { kind: "HARD_CONSTRAINT_GATE" }>, context: DependencyAssessmentContext): DependencyCheck {
  const constraint = action.constraints.find((candidate) => candidate.constraintId === dependency.constraintId);
  if (!constraint) return violated(dependency, "CONSTRAINT_DEFINITION_MISSING");
  if (constraint.evaluationBoundary !== dependency.evaluationBoundary) return violated(dependency, "CONSTRAINT_BOUNDARY_MISMATCH");
  const report = assessHardConstraints({ actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action), constraints: [constraint], resourceRequirements: [] }, { evaluatedAt: context.evaluatedAt, maximumAgeSeconds: context.maximumAgeSeconds, receipts: context.constraintReceipts });
  const assessment = report.assessments[0];
  if (!report.valid || !assessment) return unknown(dependency, "INVALID_CONSTRAINT_EVIDENCE", [dependency.constraintId]);
  return assessment.status === "SATISFIED" ? satisfied(dependency, assessment.reasonCode, assessment.evidenceRefs) : assessment.status === "VIOLATED" ? violated(dependency, assessment.reasonCode, assessment.evidenceRefs) : { ...unknown(dependency, assessment.reasonCode, [dependency.constraintId]), evidenceRefs: assessment.evidenceRefs };
}
function eligibilityCheck(action: CanonicalAction, dependency: Extract<ActionDependency, { kind: "ELIGIBILITY_CHECK_GATE" }>, context: DependencyAssessmentContext): DependencyCheck {
  const raw = context.eligibilityContexts[dependency.dependencyId];
  const rawObject = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const evaluation = evaluateActionEligibility({ action, nativeConstraints: { constraints: action.constraints, resourceRequirements: context.eligibilityResourceRequirements[dependency.dependencyId] ?? [] } }, { ...rawObject, evaluatedAt: context.evaluatedAt, evaluationBoundary: dependency.evaluationBoundary, maximumAgeSeconds: context.maximumAgeSeconds });
  if (!evaluation.ok) return unknown(dependency, "INVALID_ELIGIBILITY_EVIDENCE", [dependency.checkId]);
  const matches = evaluation.result.checks.filter((item) => item.checkId === dependency.checkId);
  if (matches.length !== 1) return unknown(dependency, matches.length ? "AMBIGUOUS_ELIGIBILITY_CHECK" : "ELIGIBILITY_CHECK_MISSING", [dependency.checkId]);
  const item = matches[0]!;
  return item.status === "SATISFIED" ? satisfied(dependency, item.reasonCodes[0]!, item.evidenceRefs) : item.status === "VIOLATED" ? violated(dependency, item.reasonCodes[0]!, item.evidenceRefs) : { ...unknown(dependency, item.reasonCodes[0]!, item.missingInformation), evidenceRefs: item.evidenceRefs };
}
function experimentCheck(action: CanonicalAction, dependency: Extract<ActionDependency, { kind: "EXPERIMENT_READINESS_GATE" }>, context: DependencyAssessmentContext): DependencyCheck {
  if (!experimentWhatSchema.safeParse(action.what).success) return violated(dependency, "EXPERIMENT_ACTION_REQUIRED");
  const readiness = assessExperimentReadiness(action, context.experimentReadinessContexts[dependency.dependencyId]);
  const trafficProblem = readiness.reasonCodes.some((code) => code.includes("TRAFFIC"));
  if (dependency.requirement === "SUFFICIENT_ELIGIBLE_TRAFFIC" && !trafficProblem && readiness.status !== "UNKNOWN") return satisfied(dependency, "SUFFICIENT_ELIGIBLE_TRAFFIC", readiness.evidenceRefs);
  if (dependency.requirement === "READY" && readiness.status === "READY") return satisfied(dependency, "EXPERIMENT_READY", readiness.evidenceRefs);
  return readiness.status === "BLOCKED" ? violated(dependency, readiness.reasonCodes[0] ?? "EXPERIMENT_NOT_READY", readiness.evidenceRefs) : { ...unknown(dependency, readiness.reasonCodes[0] ?? "EXPERIMENT_READINESS_UNKNOWN", readiness.missingRefs), evidenceRefs: readiness.evidenceRefs };
}

function hasCycle(root: CanonicalAction, registry: readonly RegistryEntry[]): boolean {
  const byKey = new Map<string, RegistryEntry>(), duplicates = new Set<string>();
  for (const entry of registry) { const key = entryKey(entry); if (byKey.has(key)) duplicates.add(key); else byKey.set(key, entry); }
  const visitAction = (action: CanonicalAction, path: Set<string>): boolean => {
    const key = `ACTION:${action.actionId}`; if (path.has(key)) return true; const next = new Set(path).add(key);
    for (const dependency of action.dependencies) if (dependency.kind === "ENTITY_LIFECYCLE") { const childKey = registryKey(dependency.prerequisite); if (next.has(childKey)) return true; const child = duplicates.has(childKey) ? undefined : byKey.get(childKey); if (child && visitEntry(child, next)) return true; }
    const experiment = experimentWhatSchema.safeParse(action.what); if (experiment.success) for (const arm of experiment.data.arms) { const childKey = arm.entityKind === "COMPOUND" ? `COMPOUND:${arm.compoundActionId}` : `ACTION:${arm.actionId}`; if (next.has(childKey)) return true; const child = duplicates.has(childKey) ? undefined : byKey.get(childKey); if (child && visitEntry(child, next)) return true; }
    return false;
  };
  const visitEntry = (entry: RegistryEntry, path: Set<string>): boolean => { const key = entryKey(entry); if (path.has(key)) return true; if (entry.entityKind === "ACTION") return visitAction(entry.action, path); const next = new Set(path).add(key); return entry.action.components.some((component) => visitAction(component.action, next)); };
  return visitAction(root, new Set());
}

export function assessActionDependencies(input: unknown, context: DependencyAssessmentContext): DependencyAssessment {
  const action = canonicalActionSchema.parse(input), fingerprint = fingerprintCanonicalAction(action);
  const validClock = typeof context?.evaluatedAt === "string" && context.evaluatedAt.endsWith("Z") && Number.isFinite(Date.parse(context.evaluatedAt));
  const validBoundary = ["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"].includes(context?.evaluationBoundary);
  const registry = (context?.registry ?? []).flatMap((entry) => { const parsed = entry.entityKind === "ACTION" ? canonicalActionSchema.safeParse(entry.action) : compoundActionSchema.safeParse(entry.action); return parsed.success ? [{ entityKind: entry.entityKind, action: parsed.data } as RegistryEntry] : []; });
  const receipts = (context?.dependencyReceipts ?? []).flatMap((receipt) => { const parsed = dependencyEvidenceReceiptSchema.safeParse(receipt); return parsed.success ? [parsed.data] : []; });
  let checks: DependencyCheck[];
  if (!validClock || !validBoundary || hasCycle(action, registry)) checks = action.dependencies.map((dependency) => violated(dependency, !validClock || !validBoundary ? "INVALID_DEPENDENCY_CONTEXT" : "DEPENDENCY_CYCLE"));
  else checks = action.dependencies.map((dependency) => {
    if (dependency.evaluationBoundary !== context.evaluationBoundary) return unknown(dependency, "DEPENDENCY_BOUNDARY_NOT_SELECTED", [dependency.evaluationBoundary]);
    const exact = receipts.filter((receipt) => receipt.dependentActionId === action.actionId && receipt.dependentActionFingerprint === fingerprint && receipt.dependencyId === dependency.dependencyId && receipt.evaluationBoundary === dependency.evaluationBoundary);
    if (!exact.length) return unknown(dependency, "MISSING_BOUND_DEPENDENCY_RECEIPT", [dependency.dependencyId]);
    if (exact.length > 1) return unknown(dependency, "AMBIGUOUS_BOUND_DEPENDENCY_RECEIPT", [dependency.dependencyId]);
    const receipt = exact[0]!, observed = Date.parse(receipt.observedAt), evaluated = Date.parse(context.evaluatedAt);
    if (observed > evaluated) return unknown(dependency, "FUTURE_DEPENDENCY_RECEIPT", [dependency.dependencyId]);
    if (context.maximumAgeSeconds !== undefined && evaluated - observed > context.maximumAgeSeconds * 1000) return unknown(dependency, "STALE_DEPENDENCY_RECEIPT", [dependency.dependencyId]);
    const factMatches = dependency.kind === "ENTITY_LIFECYCLE"
      ? receipt.fact.kind === "ENTITY_LIFECYCLE"
      : dependency.kind === "HARD_CONSTRAINT_GATE"
        ? receipt.fact.kind === "CONSTRAINT_INPUT" && receipt.fact.constraintId === dependency.constraintId
        : dependency.kind === "ELIGIBILITY_CHECK_GATE"
          ? receipt.fact.kind === "ELIGIBILITY_INPUT" && receipt.fact.checkId === dependency.checkId
          : receipt.fact.kind === "EXPERIMENT_READINESS_INPUT" && receipt.fact.requirement === dependency.requirement;
    if (!factMatches) return unknown(dependency, "DEPENDENCY_RECEIPT_FACT_MISMATCH", [dependency.dependencyId]);
    const derived = dependency.kind === "ENTITY_LIFECYCLE" ? lifecycleCheck(dependency, context, registry, receipt) : dependency.kind === "HARD_CONSTRAINT_GATE" ? constraintCheck(action, dependency, context) : dependency.kind === "ELIGIBILITY_CHECK_GATE" ? eligibilityCheck(action, dependency, context) : experimentCheck(action, dependency, context);
    return { ...derived, evidenceRefs: [...new Set([...derived.evidenceRefs, ...receipt.evidenceRefs, receipt.receiptId, ...receipt.provenance])].sort() };
  });
  checks.sort((left, right) => left.dependencyId.localeCompare(right.dependencyId));
  const status: DependencyAssessment["status"] = checks.some((item) => item.status === "VIOLATED" || (item.status === "UNKNOWN" && item.whenUnknown === "BLOCKED")) ? "BLOCKED" : checks.some((item) => item.status === "UNKNOWN") ? "UNKNOWN" : "READY";
  const projection = { actionId: action.actionId, actionFingerprint: fingerprint, evaluatedAt: context.evaluatedAt, evaluationBoundary: context.evaluationBoundary, status, checks };
  return { ...projection, assessmentFingerprint: fingerprintDependencyAssessment(projection) };
}
