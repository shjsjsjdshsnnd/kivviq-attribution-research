import { z } from "zod";
import type { CanonicalAction } from "../canonical_action/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { ActionTimingResolutionContext, ResolvedOccurrence } from "../action_timing/types.js";
import { resolveActionTiming } from "../action_timing/resolution.js";
import { utcTimestamp } from "../core/units.js";
import type { CompoundAction } from "../compound_action/schema.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../compound_action/schema.js";
import { experimentWhatSchema } from "../experiment/schema.js";
import { canonicalEntityReferenceSchema, type CanonicalEntityReference } from "../action_dependencies/schema.js";
import { registeredConflictSemantics, type PriceOperation } from "./adapters.js";
import {
  canonicalConflictEntityKey,
  normalizeConflictRelationIdentity,
  conflictScopeSchema,
  scopeIntersectionEvidenceSchema,
  type ActionConflictDefinition,
  type ConflictCoordinate,
  type ConflictScope,
  type ScopeIntersectionEvidence,
  type NormalizedConflictRelationIdentity,
} from "./schema.js";

type RegistryEntry = { entityKind: "ACTION"; action: CanonicalAction } | { entityKind: "COMPOUND"; action: CompoundAction };
export interface PortfolioMember { reference: CanonicalEntityReference; originPath: string; action: CanonicalAction; experimentId?: string; armId?: string; }
export interface PriceBaselineReceipt { receiptId: string; baselineRef: string; baselineFingerprint: string; amountMinor: number; currency: string; pairKey: string; evaluationBoundary: EvaluationBoundary; observedAt: string; sourceRef: string; provenance: readonly string[]; }
export interface PartitionReceipt { receiptId: string; experimentActionId: string; leftArmId: string; rightArmId: string; pairKey: string; evaluationBoundary: EvaluationBoundary; observedAt: string; disjoint: boolean; sourceRef: string; provenance: readonly string[]; }
type EvaluationBoundary = "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
const evidenceRefSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const fingerprintSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
const pairKeySchema = z.string().min(1);
export const priceBaselineReceiptSchema = z.object({
  receiptId: evidenceRefSchema, baselineRef: evidenceRefSchema, baselineFingerprint: fingerprintSchema,
  amountMinor: z.number().int().nonnegative().safe(), currency: z.string().regex(/^[A-Z]{3}$/), pairKey: pairKeySchema,
  evaluationBoundary: z.enum(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"]), observedAt: z.string().datetime({ offset: true }).refine((v) => v.endsWith("Z")),
  sourceRef: evidenceRefSchema, provenance: z.array(evidenceRefSchema).min(1),
}).strict();
export const experimentPartitionReceiptSchema = z.object({
  receiptId: evidenceRefSchema, experimentActionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
  leftArmId: z.string().regex(/^arm_[A-Za-z0-9._:-]+$/), rightArmId: z.string().regex(/^arm_[A-Za-z0-9._:-]+$/), pairKey: pairKeySchema,
  evaluationBoundary: z.enum(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"]), observedAt: z.string().datetime({ offset: true }).refine((v) => v.endsWith("Z")),
  disjoint: z.boolean(), sourceRef: evidenceRefSchema, provenance: z.array(evidenceRefSchema).min(1),
}).strict().refine((v) => v.leftArmId !== v.rightArmId, "Partition evidence requires two different arms");
export interface PortfolioCompatibilityContext {
  evaluatedAt: string; evaluationBoundary: EvaluationBoundary; maximumAgeSeconds?: number;
  registry: readonly RegistryEntry[];
  timingContexts: Readonly<Record<string, Omit<ActionTimingResolutionContext, "actionId">>>;
  horizonStart?: string; horizonEnd?: string; occurrenceSafetyCap?: number;
  scopeIntersectionReceipts: readonly unknown[];
  priceBaselineReceipts: readonly PriceBaselineReceipt[];
  partitionReceipts: readonly PartitionReceipt[];
  executionAliases?: readonly { aliasId: string; version: string; originPaths: readonly string[] }[];
}
export interface PortfolioPairAssessment {
  left: { reference: CanonicalEntityReference; originPath: string; experimentId?: string; armId?: string };
  right: { reference: CanonicalEntityReference; originPath: string; experimentId?: string; armId?: string };
  status: "CONFLICT" | "COEXIST" | "UNKNOWN";
  reasonCodes: readonly string[]; evidenceRefs: readonly string[]; relationPaths: readonly string[]; relations: readonly NormalizedConflictRelationIdentity[];
  temporal?: { mode: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP"; leftOccurrences: readonly ResolvedConflictOccurrence[]; rightOccurrences: readonly ResolvedConflictOccurrence[] };
}
export interface PortfolioCompatibilityAssessment {
  portfolioFingerprint: string; evaluatedAt: string; validity: "VALID" | "INVALID" | "UNKNOWN";
  status: "COMPATIBLE" | "CONFLICTING" | "UNKNOWN";
  expandedMembers: readonly CanonicalEntityReference[]; memberPaths: readonly string[];
  pairs: readonly PortfolioPairAssessment[]; reasonCodes: readonly string[]; evidenceRefs: readonly string[]; assessmentFingerprint: string;
}

const utc = z.string().datetime({ offset: true }).refine((v) => v.endsWith("Z"));
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}` : JSON.stringify(v);
const hash = (v: unknown): string => { let h = 0xcbf29ce484222325n; for (const c of stable(v)) h = ((h ^ BigInt(c.codePointAt(0)!)) * 0x100000001b3n) & 0xffffffffffffffffn; return `fnv1a64:${h.toString(16).padStart(16, "0")}`; };
const entityFingerprint = (entry: RegistryEntry) => entry.entityKind === "ACTION" ? fingerprintCanonicalAction(entry.action) : fingerprintCompoundAction(entry.action);
const entryId = (entry: RegistryEntry) => entry.entityKind === "ACTION" ? entry.action.actionId : entry.action.compoundActionId;
const refFingerprint = (ref: CanonicalEntityReference) => ref.entityKind === "ACTION" ? ref.actionFingerprint : ref.compoundFingerprint;
const refId = (ref: CanonicalEntityReference) => ref.entityKind === "ACTION" ? ref.actionId : ref.compoundActionId;
const makeRef = (entry: RegistryEntry): CanonicalEntityReference => entry.entityKind === "ACTION" ? { entityKind: "ACTION", actionId: entry.action.actionId, actionFingerprint: entityFingerprint(entry) } : { entityKind: "COMPOUND", compoundActionId: entry.action.compoundActionId, compoundFingerprint: entityFingerprint(entry) };
const pairKey = (a: CanonicalEntityReference, b: CanonicalEntityReference) => [canonicalConflictEntityKey(a), canonicalConflictEntityKey(b)].sort().join("|");
const fresh = (at: string, context: PortfolioCompatibilityContext) => utc.safeParse(at).success && Date.parse(at) <= Date.parse(context.evaluatedAt) && (context.maximumAgeSeconds === undefined || Date.parse(context.evaluatedAt) - Date.parse(at) <= context.maximumAgeSeconds * 1000);

function dimension(c: ConflictCoordinate): string {
  if (c.kind === "PRODUCT" || c.kind === "VARIANT") return "PRODUCT";
  if (c.kind === "CHANNEL" || c.kind === "PLACEMENT") return "CHANNEL";
  if (c.kind === "CUSTOM") return `CUSTOM:${c.registryRef}`;
  return c.kind;
}
function structuralCoordinate(left: ConflictCoordinate, right: ConflictCoordinate): "INTERSECTS" | "DISJOINT" | "UNKNOWN" {
  if (left.kind === "GLOBAL" || right.kind === "GLOBAL") return "INTERSECTS";
  if ((left.kind === "PRODUCT" || left.kind === "VARIANT") && (right.kind === "PRODUCT" || right.kind === "VARIANT")) {
    if (left.productRef !== right.productRef) return "DISJOINT";
    return left.kind === "VARIANT" && right.kind === "VARIANT" && left.variantRef !== right.variantRef ? "DISJOINT" : "INTERSECTS";
  }
  if ((left.kind === "CHANNEL" || left.kind === "PLACEMENT") && (right.kind === "CHANNEL" || right.kind === "PLACEMENT")) {
    if (left.channelRef !== right.channelRef) return "DISJOINT";
    return left.kind === "PLACEMENT" && right.kind === "PLACEMENT" && left.placementRef !== right.placementRef ? "DISJOINT" : "INTERSECTS";
  }
  if (left.kind === "RESOURCE" && right.kind === "RESOURCE") {
    if (left.resourceRef !== right.resourceRef) return "DISJOINT";
    return left.unit === right.unit ? "INTERSECTS" : "UNKNOWN";
  }
  if (left.kind === "POPULATION" && right.kind === "POPULATION") {
    const same = left.populationId === right.populationId && left.version === right.version && left.definitionFingerprint === right.definitionFingerprint && left.binding === right.binding && left.membershipMode === right.membershipMode;
    if (same && left.snapshotRef === right.snapshotRef) return "INTERSECTS";
    return "UNKNOWN";
  }
  if (left.kind === "CUSTOM" && right.kind === "CUSTOM" && left.registryRef === right.registryRef) return "UNKNOWN";
  return dimension(left) === dimension(right) ? "UNKNOWN" : "DISJOINT";
}

/** Structural matrix; non-structural receipts may be supplied with exact scope fingerprints. */
export function assessScopeIntersection(leftInput: ConflictScope, rightInput: ConflictScope, receipts: readonly ScopeIntersectionEvidence[], binding?: { pairKey: string; evaluationBoundary: EvaluationBoundary; evaluatedAt: string; maximumAgeSeconds?: number }): "INTERSECTS" | "DISJOINT" | "UNKNOWN" {
  const left = conflictScopeSchema.safeParse(leftInput), right = conflictScopeSchema.safeParse(rightInput);
  if (!left.success || !right.success) return "UNKNOWN";
  if (left.data.coordinates.some((c) => c.kind === "GLOBAL") || right.data.coordinates.some((c) => c.kind === "GLOBAL")) return "INTERSECTS";
  const leftBy = new Map(left.data.coordinates.map((c) => [dimension(c), c])), rightBy = new Map(right.data.coordinates.map((c) => [dimension(c), c]));
  let unresolved = false;
  for (const d of new Set([...leftBy.keys(), ...rightBy.keys()])) {
    const a = leftBy.get(d), b = rightBy.get(d);
    if (!a || !b) continue;
    const result = structuralCoordinate(a, b);
    if (result === "DISJOINT") return "DISJOINT";
    if (result === "UNKNOWN") unresolved = true;
  }
  if (!unresolved) return "INTERSECTS";
  if (!binding) return "UNKNOWN";
  const leftFp = hash(left.data), rightFp = hash(right.data);
  const matches = receipts.filter((receipt) => receipt.pairKey === binding.pairKey && receipt.evaluationBoundary === binding.evaluationBoundary && ((receipt.leftScopeFingerprint === leftFp && receipt.rightScopeFingerprint === rightFp) || (receipt.leftScopeFingerprint === rightFp && receipt.rightScopeFingerprint === leftFp)));
  if (matches.length !== 1) return "UNKNOWN";
  const receipt = matches[0]!;
  if (Date.parse(receipt.observedAt) > Date.parse(binding.evaluatedAt) || (binding.maximumAgeSeconds !== undefined && Date.parse(binding.evaluatedAt) - Date.parse(receipt.observedAt) > binding.maximumAgeSeconds * 1000)) return "UNKNOWN";
  return receipt.intersection;
}

function resolveReference(reference: CanonicalEntityReference, context: PortfolioCompatibilityContext): RegistryEntry[] {
  return context.registry.filter((entry) => entry.entityKind === reference.entityKind && entryId(entry) === refId(reference) && entityFingerprint(entry) === refFingerprint(reference));
}
function expand(reference: CanonicalEntityReference, path: string, context: PortfolioCompatibilityContext, ancestors: Set<string>): { members: PortfolioMember[]; reasons: string[] } {
  const found = resolveReference(reference, context);
  if (found.length !== 1) return { members: [], reasons: [found.length ? "AMBIGUOUS_REGISTRY_IDENTITY" : "UNRESOLVED_REGISTRY_IDENTITY"] };
  const entry = found[0]!, key = canonicalConflictEntityKey(reference);
  if (ancestors.has(key)) return { members: [], reasons: ["EXPANSION_CYCLE"] };
  if (entry.entityKind === "COMPOUND") {
    const next = new Set(ancestors).add(key), members: PortfolioMember[] = [], reasons: string[] = [];
    for (const component of entry.action.components) {
      const componentRef: CanonicalEntityReference = { entityKind: "ACTION", actionId: component.action.actionId, actionFingerprint: fingerprintCanonicalAction(component.action) };
      const nested = expandEmbedded(component.action, componentRef, `${path}/component:${component.componentId}`, context, next);
      members.push(...nested.members); reasons.push(...nested.reasons);
    }
    return { members, reasons };
  }
  return expandEmbedded(entry.action, reference, path, context, new Set(ancestors).add(key));
}
function expandEmbedded(action: CanonicalAction, reference: CanonicalEntityReference, path: string, context: PortfolioCompatibilityContext, ancestors: Set<string>): { members: PortfolioMember[]; reasons: string[] } {
  const experiment = experimentWhatSchema.safeParse(action.what);
  if (!experiment.success) return { members: [{ action, reference, originPath: path }], reasons: [] };
  const members: PortfolioMember[] = [], reasons: string[] = [];
  for (const arm of experiment.data.arms) {
    const armRef: CanonicalEntityReference = arm.entityKind === "COMPOUND"
      ? { entityKind: "COMPOUND", compoundActionId: arm.compoundActionId, compoundFingerprint: arm.actionFingerprint }
      : { entityKind: "ACTION", actionId: arm.actionId, actionFingerprint: arm.actionFingerprint };
    const nested = expand(armRef, `${path}/experiment:${action.actionId}/arm:${arm.armId}`, context, ancestors);
    members.push(...nested.members.map((member) => ({ ...member, experimentId: action.actionId, armId: arm.armId }))); reasons.push(...nested.reasons);
  }
  return { members, reasons };
}

export interface ResolvedConflictOccurrence { occurrenceIndex: number; originalStart: string; originalEnd?: string; comparisonStart: string; comparisonEnd?: string; instantaneous: boolean; }
interface Interval extends ResolvedConflictOccurrence { start: number; end?: number; instant: boolean; }
function intervals(member: PortfolioMember, mode: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP", context: PortfolioCompatibilityContext): { intervals: Interval[]; unknown?: string } {
  const timingContext: Omit<ActionTimingResolutionContext, "actionId"> = context.timingContexts[member.action.actionId] ?? { approvedClock: utcTimestamp(context.evaluatedAt) };
  const cap = context.occurrenceSafetyCap ?? timingContext.maxOccurrences;
  const resolution = resolveActionTiming(member.action.timing, { ...timingContext, ...(cap === undefined ? {} : { maxOccurrences: cap }), ...(context.horizonEnd === undefined ? {} : { horizonEnd: utcTimestamp(context.horizonEnd) }), actionId: member.action.actionId });
  if (resolution.status !== "VALID") return { intervals: [], unknown: resolution.status === "INVALID" ? "INVALID_TIMING" : "UNRESOLVED_TIMING" };
  const selected = mode === "ANY_OVERLAP" ? resolution.resolvedRequestedStart : resolution.resolvedEffectiveStart;
  if (!selected) return { intervals: [], unknown: "MODE_SELECTED_START_REQUIRED" };
  const duration = member.action.timing.duration.state === "SPECIFIED" ? member.action.timing.duration.value : undefined;
  const recurring = member.action.timing.recurrence.state === "SPECIFIED";
  if (duration?.kind === "PERSISTENT" && !context.horizonEnd) return { intervals: [], unknown: "FINITE_HORIZON_REQUIRED" };
  if (recurring && member.action.timing.recurrence.state === "SPECIFIED") {
    const recurrence = member.action.timing.recurrence.value;
    if (recurrence.boundary.kind === "OPEN_ENDED" && !context.horizonEnd) return { intervals: [], unknown: "RECURRENCE_HORIZON_REQUIRED" };
    if (cap !== undefined && recurrence.boundary.kind === "BOUNDED" && recurrence.boundary.maxOccurrences !== undefined && cap < recurrence.boundary.maxOccurrences && !context.horizonEnd) return { intervals: [], unknown: "RECURRENCE_SAFETY_CAP_TRUNCATION" };
    if (context.occurrenceSafetyCap !== undefined && resolution.occurrences.length >= context.occurrenceSafetyCap) {
      const declaredCountReached = recurrence.boundary.kind === "BOUNDED" && recurrence.boundary.maxOccurrences !== undefined && resolution.occurrences.length >= recurrence.boundary.maxOccurrences;
      const declaredEndReached = recurrence.boundary.kind === "BOUNDED" && recurrence.boundary.recurrenceEnd?.kind === "UTC" && resolution.occurrences.length > 0 && Date.parse(resolution.occurrences[resolution.occurrences.length - 1]!.effectiveStart) >= Date.parse(recurrence.boundary.recurrenceEnd.at);
      if (!declaredCountReached && !declaredEndReached) return { intervals: [], unknown: "RECURRENCE_SAFETY_CAP_TRUNCATION" };
    }
  }
  const effectiveOffset = resolution.resolvedEffectiveStart ? Date.parse(selected) - Date.parse(resolution.resolvedEffectiveStart) : 0;
  const source: readonly ResolvedOccurrence[] = resolution.occurrences.length ? resolution.occurrences : [{ occurrenceIndex: 0, effectiveStart: resolution.resolvedEffectiveStart!, ...(resolution.resolvedEnd ? { end: resolution.resolvedEnd } : {}) }];
  const horizonStart = context.horizonStart ? Date.parse(context.horizonStart) : -Infinity, horizonEnd = context.horizonEnd ? Date.parse(context.horizonEnd) : Infinity;
  const result: Interval[] = [];
  for (const occurrence of source) {
    const originalStartMs = Date.parse(occurrence.effectiveStart) + effectiveOffset;
    const originalEndMs = duration?.kind === "INSTANTANEOUS" ? originalStartMs : occurrence.end ? Date.parse(occurrence.end) : resolution.resolvedEnd ? Date.parse(resolution.resolvedEnd) : context.horizonEnd ? horizonEnd : undefined;
    const instant = duration?.kind === "INSTANTANEOUS";
    if (instant ? originalStartMs < horizonStart || originalStartMs >= horizonEnd : originalEndMs !== undefined && (originalEndMs <= horizonStart || originalStartMs >= horizonEnd)) continue;
    const clippedStart = Math.max(originalStartMs, horizonStart), clippedEnd = originalEndMs === undefined ? undefined : Math.min(originalEndMs, horizonEnd);
    result.push({ start: clippedStart, ...(clippedEnd === undefined ? {} : { end: clippedEnd }), instant, occurrenceIndex: occurrence.occurrenceIndex, originalStart: new Date(originalStartMs).toISOString(), ...(originalEndMs === undefined ? {} : { originalEnd: new Date(originalEndMs).toISOString() }), comparisonStart: new Date(clippedStart).toISOString(), ...(clippedEnd === undefined ? {} : { comparisonEnd: new Date(clippedEnd).toISOString() }), instantaneous: instant });
  }
  return { intervals: result };
}
function temporalOverlap(left: PortfolioMember, right: PortfolioMember, mode: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP", context: PortfolioCompatibilityContext): "OVERLAP" | "DISJOINT" | "UNKNOWN" {
  const a = intervals(left, mode, context), b = intervals(right, mode, context);
  if (a.unknown || b.unknown) return "UNKNOWN";
  for (const x of a.intervals) for (const y of b.intervals) {
    if (x.instant && y.instant ? x.start === y.start : x.instant ? y.start <= x.start && (y.end === undefined || x.start < y.end) : y.instant ? x.start <= y.start && (x.end === undefined || y.start < x.end) : Math.max(x.start, y.start) < Math.min(x.end ?? Infinity, y.end ?? Infinity)) return "OVERLAP";
  }
  return "DISJOINT";
}
function temporalDetail(left: PortfolioMember, right: PortfolioMember, mode: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP", context: PortfolioCompatibilityContext) {
  const a = intervals(left, mode, context), b = intervals(right, mode, context);
  if (a.unknown || b.unknown) return undefined;
  const clean = ({ start: _start, end: _end, instant: _instant, ...value }: Interval): ResolvedConflictOccurrence => value;
  return { mode, leftOccurrences: a.intervals.map(clean), rightOccurrences: b.intervals.map(clean) };
}

function exactPriceBaseline(operation: PriceOperation, pair: string, context: PortfolioCompatibilityContext): { amount: number; currency: string; evidence: string[] } | undefined {
  if (operation.kind === "SET") return { amount: operation.amountMinor, currency: operation.currency, evidence: [] };
  if (operation.baselineRef?.startsWith("explicit:") && operation.baselineFingerprint) {
    const [, currency, amount] = operation.baselineRef.split(":"); return { amount: Number(amount), currency: currency!, evidence: [] };
  }
  if (!operation.baselineRef || !operation.baselineFingerprint) return undefined;
  const matches = context.priceBaselineReceipts.flatMap((candidate) => { const parsed = priceBaselineReceiptSchema.safeParse(candidate); return parsed.success ? [parsed.data] : []; }).filter((r) => r.pairKey === pair && r.baselineRef === operation.baselineRef && r.baselineFingerprint === operation.baselineFingerprint && r.evaluationBoundary === context.evaluationBoundary && fresh(r.observedAt, context));
  if (matches.length !== 1) return undefined;
  const r = matches[0]!; return { amount: r.amountMinor, currency: r.currency, evidence: [r.receiptId, r.sourceRef, ...r.provenance] };
}
function priceResult(operation: PriceOperation, pair: string, context: PortfolioCompatibilityContext): { amount: number; currency: string; evidence: string[] } | undefined {
  if (operation.kind === "SET") return exactPriceBaseline(operation, pair, context);
  const baseline = exactPriceBaseline(operation, pair, context); if (!baseline) return undefined;
  if (operation.currency && operation.currency !== baseline.currency) return undefined;
  return { amount: operation.kind === "DELTA" ? baseline.amount + operation.amountMinor : Math.round(baseline.amount * operation.factor), currency: baseline.currency, evidence: baseline.evidence };
}

function comparePair(left: PortfolioMember, right: PortfolioMember, context: PortfolioCompatibilityContext, receipts: ScopeIntersectionEvidence[]): PortfolioPairAssessment {
  const ordered = [left, right].sort((a, b) => `${canonicalConflictEntityKey(a.reference)}:${a.originPath}`.localeCompare(`${canonicalConflictEntityKey(b.reference)}:${b.originPath}`)); [left, right] = ordered as [PortfolioMember, PortfolioMember];
  const base = { left: { reference: left.reference, originPath: left.originPath, ...(left.experimentId ? { experimentId: left.experimentId, armId: left.armId } : {}) }, right: { reference: right.reference, originPath: right.originPath, ...(right.experimentId ? { experimentId: right.experimentId, armId: right.armId } : {}) } };
  const key = pairKey(left.reference, right.reference), candidates: { kind: ActionConflictDefinition["kind"]; targetFingerprint: string; scopeLeft: ConflictScope; scopeRight: ConflictScope; mode: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP"; source: string; registryIdentity?: string; price?: [PriceOperation, PriceOperation] }[] = [];
  const leftAdapters = registeredConflictSemantics(left.action), rightAdapters = registeredConflictSemantics(right.action);
  for (const a of leftAdapters) for (const b of rightAdapters) if (a.adapterId === b.adapterId && a.kind === b.kind) candidates.push({ kind: a.kind, targetFingerprint: hash(a.adapterId), scopeLeft: a.scope, scopeRight: b.scope, mode: "EFFECTIVE_OVERLAP", source: a.adapterId, registryIdentity: a.adapterId, ...(a.operation && b.operation ? { price: [a.operation, b.operation] } : {}) });
  for (const [owner, other] of [[left, right], [right, left]] as const) for (const conflict of owner.action.conflicts) {
    if ("entityKind" in conflict.counterparty && canonicalConflictEntityKey(conflict.counterparty) === canonicalConflictEntityKey(other.reference)) candidates.push({ kind: conflict.kind, targetFingerprint: hash(conflict.target), scopeLeft: conflict.scope, scopeRight: conflict.scope, mode: conflict.overlapRule, source: `${owner.originPath}/conflict:${conflict.conflictId}` });
    if ("registryRef" in conflict.counterparty) {
      const counterparty = conflict.counterparty;
      const otherMatch = (owner === left ? rightAdapters : leftAdapters).filter((adapter) => adapter.adapterId === `${counterparty.registryRef}.${counterparty.code}@${counterparty.version}`);
      if (otherMatch.length === 1) candidates.push({ kind: conflict.kind, targetFingerprint: hash(conflict.target), scopeLeft: conflict.scope, scopeRight: otherMatch[0]!.scope, mode: conflict.overlapRule, source: `${owner.originPath}/conflict:${conflict.conflictId}`, registryIdentity: `${counterparty.registryRef}.${counterparty.code}@${counterparty.version}` });
    }
  }
  if (!candidates.length) return { ...base, status: "COEXIST", reasonCodes: ["NO_CONFLICT_RELATION"], evidenceRefs: [], relationPaths: [], relations: [] };
  const relationPaths = [...new Set(candidates.map((candidate) => candidate.source))].sort();
  const relations = candidates.map((candidate) => normalizeConflictRelationIdentity({ left: left.reference, right: right.reference, kind: candidate.kind, targetFingerprint: candidate.targetFingerprint, leftScopeFingerprint: hash(candidate.scopeLeft), rightScopeFingerprint: hash(candidate.scopeRight), temporalMode: candidate.mode })).filter((relation, index, all) => all.findIndex((other) => stable(other) === stable(relation)) === index).sort((a, b) => stable(a).localeCompare(stable(b)));
  const declarations = candidates.filter((c) => c.source.includes("/conflict:"));
  const signatures = new Set(declarations.map((c) => { const scopes = [hash(c.scopeLeft), hash(c.scopeRight)].sort(); return stable({ kind: c.kind, targetFingerprint: c.targetFingerprint, scopes, mode: c.mode, registryIdentity: c.registryIdentity }); }));
  if (signatures.size > 1) return { ...base, status: "UNKNOWN", reasonCodes: ["CONTRADICTORY_CONFLICT_DECLARATIONS"], evidenceRefs: [], relationPaths, relations };
  let unknown = false; const evidence: string[] = [];
  for (const candidate of candidates) {
    const scope = assessScopeIntersection(candidate.scopeLeft, candidate.scopeRight, receipts, { pairKey: key, evaluationBoundary: context.evaluationBoundary, evaluatedAt: context.evaluatedAt, ...(context.maximumAgeSeconds === undefined ? {} : { maximumAgeSeconds: context.maximumAgeSeconds }) });
    if (scope === "DISJOINT") continue;
    if (scope === "UNKNOWN") { unknown = true; continue; }
    if (left.experimentId && left.experimentId === right.experimentId && left.armId !== right.armId && candidate.scopeLeft.coordinates.every((c) => c.kind === "POPULATION") && candidate.scopeRight.coordinates.every((c) => c.kind === "POPULATION")) {
      const partitions = context.partitionReceipts.flatMap((candidate) => { const parsed = experimentPartitionReceiptSchema.safeParse(candidate); return parsed.success ? [parsed.data] : []; }).filter((r) => r.experimentActionId === left.experimentId && new Set([r.leftArmId, r.rightArmId]).size === 2 && [r.leftArmId, r.rightArmId].includes(left.armId!) && [r.leftArmId, r.rightArmId].includes(right.armId!) && r.pairKey === key && r.evaluationBoundary === context.evaluationBoundary && fresh(r.observedAt, context));
      if (partitions.length !== 1) { unknown = true; continue; }
      evidence.push(partitions[0]!.receiptId, partitions[0]!.sourceRef, ...partitions[0]!.provenance);
      if (partitions[0]!.disjoint) continue;
    }
    const time = temporalOverlap(left, right, candidate.mode, context);
    if (time === "UNKNOWN") { unknown = true; continue; }
    if (time === "DISJOINT") continue;
    if (candidate.price) {
      const a = priceResult(candidate.price[0], key, context), b = priceResult(candidate.price[1], key, context);
      if (!a || !b) { unknown = true; continue; }
      if (a.currency !== b.currency) continue;
      evidence.push(...a.evidence, ...b.evidence);
      if (a.amount === b.amount) continue;
    }
    const temporal = temporalDetail(left, right, candidate.mode, context);
    return { ...base, status: "CONFLICT", reasonCodes: [candidate.kind], evidenceRefs: [...new Set(evidence)].sort(), relationPaths, relations, ...(temporal ? { temporal } : {}) };
  }
  return { ...base, status: unknown ? "UNKNOWN" : "COEXIST", reasonCodes: [unknown ? "CONFLICT_RELATION_UNRESOLVED" : "SCOPES_OR_TIMES_DISJOINT"], evidenceRefs: [...new Set(evidence)].sort(), relationPaths, relations };
}

export function assessPortfolioCompatibility(portfolioInput: readonly unknown[], context: PortfolioCompatibilityContext): PortfolioCompatibilityAssessment {
  const parsedRefs = portfolioInput.map((value) => canonicalEntityReferenceSchema.safeParse(value));
  const reasons: string[] = [];
  if (!utc.safeParse(context.evaluatedAt).success) reasons.push("INVALID_EVALUATED_AT");
  if (parsedRefs.some((result) => !result.success)) reasons.push("INVALID_PORTFOLIO_REFERENCE");
  const receipts = context.scopeIntersectionReceipts.flatMap((value) => { const parsed = scopeIntersectionEvidenceSchema.safeParse(value); return parsed.success ? [parsed.data] : []; });
  const members: PortfolioMember[] = [];
  parsedRefs.forEach((result) => { if (!result.success) return; const expanded = expand(result.data, `portfolio:${canonicalConflictEntityKey(result.data)}`, context, new Set()); members.push(...expanded.members); reasons.push(...expanded.reasons); });
  for (const member of members) for (const conflict of member.action.conflicts) {
    if ("entityKind" in conflict.counterparty) {
      if (canonicalConflictEntityKey(conflict.counterparty) === canonicalConflictEntityKey(member.reference)) reasons.push("SELF_CONFLICT_DECLARATION");
      else if (resolveReference(conflict.counterparty, context).length === 0) reasons.push("UNRESOLVED_CONFLICT_COUNTERPARTY");
      else if (resolveReference(conflict.counterparty, context).length > 1) reasons.push("AMBIGUOUS_CONFLICT_COUNTERPARTY");
    } else {
      const adapterId = `${conflict.counterparty.registryRef}.${conflict.counterparty.code}@${conflict.counterparty.version}`;
      const matches = context.registry.flatMap((entry) => entry.entityKind === "ACTION" ? registeredConflictSemantics(entry.action).filter((adapter) => adapter.adapterId === adapterId) : []);
      if (matches.length === 0) reasons.push("UNRESOLVED_CONFLICT_REGISTRY");
      else if (matches.length > 1) reasons.push("AMBIGUOUS_CONFLICT_REGISTRY");
    }
  }
  const byExecution = new Map<string, PortfolioMember[]>();
  for (const member of members) { const key = canonicalConflictEntityKey(member.reference); byExecution.set(key, [...(byExecution.get(key) ?? []), member]); }
  for (const repeated of byExecution.values()) if (repeated.length > 1) {
    const paths = repeated.map((m) => m.originPath).sort();
    const aliased = context.executionAliases?.some((alias) => alias.version.length > 0 && paths.every((path) => alias.originPaths.includes(path)));
    if (!aliased) reasons.push("DUPLICATE_EXECUTION_PATH");
  }
  const sorted = [...members].sort((a, b) => `${canonicalConflictEntityKey(a.reference)}:${a.originPath}`.localeCompare(`${canonicalConflictEntityKey(b.reference)}:${b.originPath}`));
  const pairs: PortfolioPairAssessment[] = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) pairs.push(comparePair(sorted[i]!, sorted[j]!, context, receipts));
  const invalid = reasons.some((r) => ["INVALID_EVALUATED_AT", "INVALID_PORTFOLIO_REFERENCE", "DUPLICATE_EXECUTION_PATH", "EXPANSION_CYCLE", "AMBIGUOUS_REGISTRY_IDENTITY", "SELF_CONFLICT_DECLARATION", "AMBIGUOUS_CONFLICT_COUNTERPARTY", "AMBIGUOUS_CONFLICT_REGISTRY"].includes(r));
  const unresolved = reasons.length > 0 || pairs.some((pair) => pair.status === "UNKNOWN");
  const status: PortfolioCompatibilityAssessment["status"] = pairs.some((pair) => pair.status === "CONFLICT") ? "CONFLICTING" : unresolved ? "UNKNOWN" : "COMPATIBLE";
  const expandedMembers = sorted.map((member) => member.reference), memberPaths = sorted.map((member) => member.originPath), evidenceRefs = [...new Set(pairs.flatMap((pair) => pair.evidenceRefs))].sort();
  const projection = { portfolioFingerprint: hash(expandedMembers), evaluatedAt: context.evaluatedAt, validity: invalid ? "INVALID" as const : unresolved ? "UNKNOWN" as const : "VALID" as const, status, expandedMembers, memberPaths, pairs, reasonCodes: [...new Set(reasons)].sort(), evidenceRefs };
  return { ...projection, assessmentFingerprint: hash(projection) };
}
