import type { CanonicalAction } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { CompoundAction } from "../compound_action/schema.js";
import { fingerprintCompoundAction } from "../compound_action/schema.js";
import { experimentWhatSchema } from "../experiment/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { compoundActionSchema } from "../compound_action/schema.js";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type {
  ActionCharacteristics,
  CostLineItem,
  OperationalBurdenLineItem,
  OperationalQuantity,
  Reversibility,
  StageCancellationCost,
} from "./schema.js";

export type CharacteristicAggregateNode =
  | { readonly kind: "ACTION"; readonly action: CanonicalAction }
  | {
      readonly kind: "COMPOUND";
      readonly compoundId: string;
      readonly executionPolicy: "PARALLEL" | "ORDERED" | "DEPENDENCY_GATED";
      readonly members: readonly {
        readonly componentId: string;
        readonly dependsOn?: readonly string[];
        readonly node: CharacteristicAggregateNode;
      }[];
    };

export interface SharedExecutionAlias {
  readonly aliasContractRef: string;
  readonly version: string;
  readonly actionId: string;
  readonly actionFingerprint: string;
  readonly paths: readonly string[];
}

export interface CharacteristicAggregationContext {
  readonly aliases?: readonly SharedExecutionAlias[];
  readonly calendarAnchors?: readonly {
    readonly actionId: string;
    readonly actionFingerprint: string;
    readonly start: string;
    readonly timeZone: string;
  }[];
}

type AggregateState =
  | { readonly state: "KNOWN"; readonly amountMinor: number }
  | { readonly state: "RANGE"; readonly minimumMinor: number; readonly maximumMinor: number }
  | { readonly state: "UNKNOWN"; readonly reasons: readonly string[] }
  | { readonly state: "NOT_APPLICABLE"; readonly reasons: readonly string[] };

type QuantityState =
  | { readonly state: "KNOWN"; readonly quantity: number }
  | { readonly state: "RANGE"; readonly minimum: number; readonly maximum: number }
  | { readonly state: "UNKNOWN"; readonly reasons: readonly string[] }
  | { readonly state: "NOT_APPLICABLE"; readonly reasons: readonly string[] };

export interface CharacteristicsAggregateResult {
  readonly aggregateFingerprint: string;
  readonly status: "VALID" | "INVALID" | "UNKNOWN";
  readonly issues: readonly string[];
  readonly costs: readonly {
    readonly category: CostLineItem["category"];
    readonly currency: string | null;
    readonly phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION";
    readonly stage?: StageCancellationCost["stage"];
    readonly amount: AggregateState;
    readonly memberPaths: readonly string[];
  }[];
  readonly burdens: readonly {
    readonly resource: OperationalQuantity["resource"] | null;
    readonly unit: OperationalQuantity["unit"] | null;
    readonly resourceKey: string;
    readonly unitKey: string;
    readonly burdenId: string;
    readonly phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION";
    readonly stage?: StageCancellationCost["stage"];
    readonly amount: QuantityState;
    readonly memberPaths: readonly string[];
  }[];
  readonly declaredDelays: readonly { readonly memberPath: string; readonly value: CanonicalAction["timing"]["implementationDelay"] }[];
  readonly derivedCriticalPathDelay: { readonly state: "KNOWN"; readonly seconds: number } | { readonly state: "UNKNOWN"; readonly reasons: readonly string[] };
  readonly parallelBranches: readonly { readonly path: string; readonly delay: number | null }[];
  readonly reversibility: { readonly summary: Reversibility["kind"]; readonly components: readonly { readonly memberPath: string; readonly value: Reversibility }[] };
  readonly audit: {
    readonly members: readonly { readonly memberPath: string; readonly actionId: string; readonly actionFingerprint: string }[];
    readonly aliases: readonly SharedExecutionAlias[];
  };
}

interface Leaf { path: string; action: CanonicalAction; characteristics: ActionCharacteristics }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${key}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const serialized = stable(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index++)
    hash = ((hash ^ BigInt(serialized.charCodeAt(index))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

const aliasSchema = z.object({
  aliasContractRef: z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/),
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  actionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
  actionFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/),
  paths: z.array(z.string().min(1)).min(2),
}).strict().superRefine((value, context) => {
  if (new Set(value.paths).size !== value.paths.length) context.addIssue({ code: "custom", path: ["paths"], message: "Alias paths must be unique" });
});
const calendarAnchorSchema = z.object({
  actionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
  actionFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/),
  start: z.string().datetime({ offset: true }).refine((value) => value.endsWith("Z")),
  timeZone: z.string().min(1),
}).strict();

function emptyResult(issue: string): CharacteristicsAggregateResult {
  const body = { status: "INVALID" as const, issues: [issue], costs: [], burdens: [], declaredDelays: [], derivedCriticalPathDelay: { state: "UNKNOWN" as const, reasons: [issue] }, parallelBranches: [], reversibility: { summary: "UNKNOWN" as const, components: [] }, audit: { members: [], aliases: [] } };
  return { aggregateFingerprint: fingerprint(body), ...body };
}

function delaySeconds(action: CanonicalAction, context: CharacteristicAggregationContext, issues: Set<string>): number | null {
  const delay = action.timing.implementationDelay;
  if (delay.state === "ABSENT" || delay.state === "NOT_APPLICABLE") return 0;
  if (delay.state !== "SPECIFIED") return null;
  const value = delay.value;
  if (value.kind === "ELAPSED") {
    const seconds = value.amount * (value.unit === "SECOND" ? 1 : value.unit === "MINUTE" ? 60 : 3600);
    if (!Number.isSafeInteger(seconds)) { issues.add("UNSAFE_DELAY_ARITHMETIC"); return null; }
    return seconds;
  }
  const fp = fingerprintCanonicalAction(action);
  const anchors = (context.calendarAnchors ?? []).filter((entry) => entry.actionId === action.actionId && entry.actionFingerprint === fp);
  if (anchors.length !== 1) { if (anchors.length > 1) issues.add("AMBIGUOUS_CALENDAR_ANCHOR"); return null; }
  try {
    const anchor = anchors[0]!;
    const start = Temporal.Instant.from(anchor.start).toZonedDateTimeISO(anchor.timeZone);
    const end = start.add(value.unit === "DAY" ? { days: value.amount } : value.unit === "WEEK" ? { weeks: value.amount } : { months: value.amount });
    const seconds = Number((end.epochNanoseconds - start.epochNanoseconds) / 1_000_000_000n);
    if (!Number.isSafeInteger(seconds)) { issues.add("UNSAFE_DELAY_ARITHMETIC"); return null; }
    return seconds;
  } catch { issues.add("INVALID_CALENDAR_ANCHOR"); return null; }
}

function checkedAdd(left: number, right: number, issues: Set<string>): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) issues.add("UNSAFE_NUMERIC_AGGREGATE");
  return total;
}

function checkedQuantityAdd(left: number, right: number, issues: Set<string>): number {
  const total = left + right;
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) issues.add("UNSAFE_NUMERIC_AGGREGATE");
  return total;
}

function computeDelay(node: CharacteristicAggregateNode, context: CharacteristicAggregationContext, issues: Set<string>, active: Set<object>): number | null {
  if (node.kind === "ACTION") return delaySeconds(node.action, context, issues);
  if (active.has(node as object)) { issues.add("EXPANSION_CYCLE"); return null; }
  active.add(node as object);
  const values = new Map<string, number | null>();
  for (const member of node.members) values.set(member.componentId, computeDelay(member.node, context, issues, active));
  active.delete(node as object);
  if ([...values.values()].some((value) => value === null)) return null;
  if (node.executionPolicy === "PARALLEL") return Math.max(0, ...[...values.values()].map((value) => value!));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const path = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) { issues.add("DEPENDENCY_CYCLE"); return 0; }
    visiting.add(id);
    const index = node.members.findIndex((entry) => entry.componentId === id);
    const member = node.members[index];
    if (!member) { issues.add("UNKNOWN_DEPENDENCY_MEMBER"); return 0; }
    const implicit = node.executionPolicy === "ORDERED" && index > 0 ? [node.members[index - 1]!.componentId] : [];
    const predecessors = [...new Set([...(member.dependsOn ?? []), ...implicit])];
    const prior = Math.max(0, ...predecessors.map(path));
    const own = values.get(id) ?? 0;
    const total = checkedAdd(prior, own, issues);
    visiting.delete(id); memo.set(id, total); return total;
  };
  return Math.max(0, ...node.members.map(({ componentId }) => path(componentId)));
}

function collect(node: CharacteristicAggregateNode, path: string, active: Set<object>, leaves: Leaf[], issues: Set<string>): void {
  if (node.kind === "ACTION") {
    if (node.action.characteristics.state !== "PRESENT") { issues.add("CHARACTERISTICS_ABSENT"); return; }
    leaves.push({ path, action: node.action, characteristics: node.action.characteristics.value });
    return;
  }
  if (active.has(node as object)) { issues.add("EXPANSION_CYCLE"); return; }
  active.add(node as object);
  const ids = node.members.map((member) => member.componentId);
  if (new Set(ids).size !== ids.length) issues.add("DUPLICATE_COMPONENT_ID");
  const idSet = new Set(ids);
  for (const member of node.members) {
    if (new Set(member.dependsOn ?? []).size !== (member.dependsOn ?? []).length) issues.add("DUPLICATE_DEPENDENCY");
    if ((member.dependsOn ?? []).some((dependency) => !idSet.has(dependency))) issues.add("UNKNOWN_DEPENDENCY_MEMBER");
    collect(member.node, `${path}/${member.componentId}`, active, leaves, issues);
  }
  active.delete(node as object);
}

function moneyKey(item: CostLineItem, phase: string, stage?: string): string {
  const currency = item.amount.state === "KNOWN" ? item.amount.value.currency : item.amount.state === "RANGE" ? item.amount.minimum.currency : null;
  return `${phase}|${stage ?? ""}|${item.category}|${currency ?? item.amount.state}`;
}

function aggregateMoney(entries: readonly { item: CostLineItem; path: string }[], issues: Set<string>): AggregateState {
  const unknown = entries.filter(({ item }) => item.amount.state === "UNKNOWN").map(({ item }) => item.amount.state === "UNKNOWN" ? item.amount.reason : "");
  if (unknown.length) return { state: "UNKNOWN", reasons: [...new Set(unknown)].sort() };
  const applicable = entries.filter(({ item }) => item.amount.state === "KNOWN" || item.amount.state === "RANGE");
  if (!applicable.length) return { state: "NOT_APPLICABLE", reasons: entries.map(({ item }) => item.amount.state === "NOT_APPLICABLE" ? item.amount.reason : "").filter(Boolean).sort() };
  let minimum = 0, maximum = 0, ranged = false;
  for (const { item } of applicable) {
    if (item.amount.state === "KNOWN") minimum = checkedAdd(minimum, item.amount.value.amountMinor, issues), maximum = checkedAdd(maximum, item.amount.value.amountMinor, issues);
    else if (item.amount.state === "RANGE") minimum = checkedAdd(minimum, item.amount.minimum.amountMinor, issues), maximum = checkedAdd(maximum, item.amount.maximum.amountMinor, issues), ranged = true;
  }
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) return { state: "UNKNOWN", reasons: ["UNSAFE_NUMERIC_AGGREGATE"] };
  return ranged ? { state: "RANGE", minimumMinor: minimum, maximumMinor: maximum } : { state: "KNOWN", amountMinor: minimum };
}

function aggregateQuantity(entries: readonly { item: OperationalBurdenLineItem; path: string }[], issues: Set<string>): QuantityState {
  const unknown = entries.filter(({ item }) => item.amount.state === "UNKNOWN").map(({ item }) => item.amount.state === "UNKNOWN" ? item.amount.reason : "");
  if (unknown.length) return { state: "UNKNOWN", reasons: [...new Set(unknown)].sort() };
  const applicable = entries.filter(({ item }) => item.amount.state === "KNOWN" || item.amount.state === "RANGE");
  if (!applicable.length) return { state: "NOT_APPLICABLE", reasons: entries.map(({ item }) => item.amount.state === "NOT_APPLICABLE" ? item.amount.reason : "").filter(Boolean).sort() };
  let minimum = 0, maximum = 0, ranged = false;
  for (const { item } of applicable) {
    if (item.amount.state === "KNOWN") minimum = checkedQuantityAdd(minimum, item.amount.value.quantity, issues), maximum = checkedQuantityAdd(maximum, item.amount.value.quantity, issues);
    else if (item.amount.state === "RANGE") minimum = checkedQuantityAdd(minimum, item.amount.minimum.quantity, issues), maximum = checkedQuantityAdd(maximum, item.amount.maximum.quantity, issues), ranged = true;
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > Number.MAX_SAFE_INTEGER || maximum > Number.MAX_SAFE_INTEGER) return { state: "UNKNOWN", reasons: ["UNSAFE_NUMERIC_AGGREGATE"] };
  return ranged ? { state: "RANGE", minimum, maximum } : { state: "KNOWN", quantity: minimum };
}

const reversalRank: Record<Reversibility["kind"], number> = { IRREVERSIBLE: 5, PARTIALLY_REVERSIBLE: 4, UNKNOWN: 3, FULLY_REVERSIBLE: 2, NOT_APPLICABLE: 1 };

function aggregateActionCharacteristicsUnsafe(nodeInput: unknown, contextInput: unknown = {}): CharacteristicsAggregateResult {
  if (!nodeInput || typeof nodeInput !== "object" || !contextInput || typeof contextInput !== "object" || Array.isArray(contextInput)) return emptyResult("INVALID_AGGREGATION_INPUT");
  const context = contextInput as CharacteristicAggregationContext;
  if (context.aliases !== undefined && (!Array.isArray(context.aliases) || context.aliases.some((alias) => !aliasSchema.safeParse(alias).success))) return emptyResult("INVALID_ALIAS_CONTEXT");
  if (context.aliases && new Set(context.aliases.map((alias) => `${alias.aliasContractRef}|${alias.version}`)).size !== context.aliases.length) return emptyResult("DUPLICATE_ALIAS_CONTRACT");
  if (context.calendarAnchors !== undefined && (!Array.isArray(context.calendarAnchors) || context.calendarAnchors.some((anchor) => !calendarAnchorSchema.safeParse(anchor).success))) return emptyResult("INVALID_CALENDAR_CONTEXT");
  const node = nodeInput as CharacteristicAggregateNode;
  if (node.kind !== "ACTION" && node.kind !== "COMPOUND") return emptyResult("INVALID_AGGREGATE_NODE");
  if (node.kind === "ACTION" && !canonicalActionSchema.safeParse(node.action).success) return emptyResult("INVALID_MEMBER_ACTION");
  if (node.kind === "COMPOUND" && (typeof node.compoundId !== "string" || !Array.isArray(node.members) || !["PARALLEL", "ORDERED", "DEPENDENCY_GATED"].includes(node.executionPolicy))) return emptyResult("INVALID_COMPOUND_NODE");
  const issues = new Set<string>();
  const rawLeaves: Leaf[] = [];
  const rootPath = node.kind === "ACTION" ? node.action.actionId : node.compoundId;
  collect(node, rootPath, new Set(), rawLeaves, issues);
  const identities = new Map<string, Leaf[]>();
  const fingerprintsById = new Map<string, Set<string>>();
  for (const leaf of rawLeaves) {
    const fp = fingerprintCanonicalAction(leaf.action);
    const key = `${leaf.action.actionId}|${fp}`;
    identities.set(key, [...(identities.get(key) ?? []), leaf]);
    fingerprintsById.set(leaf.action.actionId, new Set([...(fingerprintsById.get(leaf.action.actionId) ?? []), fp]));
  }
  if ([...fingerprintsById.values()].some((values) => values.size > 1)) issues.add("ACTION_ID_FINGERPRINT_CONFLICT");
  const leaves: Leaf[] = [];
  for (const group of identities.values()) {
    if (group.length === 1) { leaves.push(group[0]!); continue; }
    const orderedGroup = [...group].sort((left, right) => left.path.localeCompare(right.path));
    const first = orderedGroup[0]!;
    const fingerprint = fingerprintCanonicalAction(first.action);
    const aliases = (context.aliases ?? []).filter((alias) => alias.actionId === first.action.actionId && alias.actionFingerprint === fingerprint && stable([...alias.paths].sort()) === stable(orderedGroup.map(({ path }) => path).sort()));
    if (aliases.length !== 1) issues.add(aliases.length > 1 ? "AMBIGUOUS_ALIAS_CONTRACT" : "DUPLICATE_EXECUTION_IDENTITY");
    else leaves.push(first);
  }

  const costGroups = new Map<string, { item: CostLineItem; path: string; phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION"; stage?: StageCancellationCost["stage"] }[]>();
  const burdenGroups = new Map<string, { item: OperationalBurdenLineItem; path: string; phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION"; stage?: StageCancellationCost["stage"] }[]>();
  const addCost = (item: CostLineItem, path: string, phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION", stage?: StageCancellationCost["stage"]) => {
    const key = moneyKey(item, phase, stage);
    const entry = stage === undefined ? { item, path, phase } : { item, path, phase, stage };
    costGroups.set(key, [...(costGroups.get(key) ?? []), entry]);
  };
  const addBurden = (item: OperationalBurdenLineItem, path: string, phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION", stage?: StageCancellationCost["stage"]) => {
    const exemplar = item.amount.state === "KNOWN" ? item.amount.value : item.amount.state === "RANGE" ? item.amount.minimum : null;
    const key = exemplar
      ? `${phase}|${stage ?? ""}|${stable(exemplar.resource)}|${stable(exemplar.unit)}`
      : `${phase}|${stage ?? ""}|${item.amount.state}|${item.burdenId}|${path}`;
    const entry = stage === undefined ? { item, path, phase } : { item, path, phase, stage };
    burdenGroups.set(key, [...(burdenGroups.get(key) ?? []), entry]);
  };
  for (const leaf of leaves) {
    leaf.characteristics.implementationCost.forEach((item) => addCost(item, leaf.path, "IMPLEMENTATION"));
    leaf.characteristics.operationalBurden.forEach((item) => addBurden(item, leaf.path, "IMPLEMENTATION"));
    for (const stage of leaf.characteristics.cancellationCosts) {
      stage.cancellationCost.forEach((item) => addCost(item, leaf.path, "CANCELLATION", stage.stage));
      stage.compensationCost.forEach((item) => addCost(item, leaf.path, "COMPENSATION", stage.stage));
      stage.operationalBurden.forEach((item) => addBurden(item, leaf.path, stage.cancellationAvailable ? "CANCELLATION" : "COMPENSATION", stage.stage));
    }
  }
  const costs = [...costGroups.values()].map((entries) => {
    const first = entries[0]!; const amount = aggregateMoney(entries, issues);
    const currency = first.item.amount.state === "KNOWN" ? first.item.amount.value.currency : first.item.amount.state === "RANGE" ? first.item.amount.minimum.currency : null;
    return { category: first.item.category, currency, phase: first.phase, ...(first.stage ? { stage: first.stage } : {}), amount, memberPaths: [...new Set(entries.map(({ path }) => path))].sort() };
  }).sort((a, b) => stable(a).localeCompare(stable(b)));
  const burdens = [...burdenGroups.entries()].map(([key, entries]) => {
    const first = entries[0]!.item.amount;
    const exemplar = first.state === "KNOWN" ? first.value : first.state === "RANGE" ? first.minimum : null;
    return {
      resource: exemplar?.resource ?? null,
      unit: exemplar?.unit ?? null,
      resourceKey: exemplar ? stable(exemplar.resource) : "?",
      unitKey: exemplar ? stable(exemplar.unit) : "?",
      burdenId: entries[0]!.item.burdenId,
      phase: entries[0]!.phase,
      ...(entries[0]!.stage ? { stage: entries[0]!.stage } : {}),
      amount: aggregateQuantity(entries, issues),
      memberPaths: [...new Set(entries.map(({ path }) => path))].sort(),
    };
  }).sort((a, b) => stable(a).localeCompare(stable(b)));
  let delay = computeDelay(node, context, issues, new Set());
  if (issues.has("UNSAFE_NUMERIC_AGGREGATE") || issues.has("UNSAFE_DELAY_ARITHMETIC")) delay = null;
  if (delay === null && !issues.has("UNSAFE_NUMERIC_AGGREGATE") && !issues.has("UNSAFE_DELAY_ARITHMETIC")) issues.add("UNRESOLVED_IMPLEMENTATION_DELAY");
  const reversibilityComponents = leaves.map((leaf) => ({ memberPath: leaf.path, value: leaf.characteristics.reversibility })).sort((a, b) => a.memberPath.localeCompare(b.memberPath));
  const summary = reversibilityComponents.reduce<Reversibility["kind"]>((current, entry) => reversalRank[entry.value.kind] > reversalRank[current] ? entry.value.kind : current, "NOT_APPLICABLE");
  const parallelBranches = node.kind === "COMPOUND" && node.executionPolicy === "PARALLEL" ? node.members.map((member) => ({ path: `${rootPath}/${member.componentId}`, delay: computeDelay(member.node, context, issues, new Set()) })).sort((a, b) => a.path.localeCompare(b.path)) : [];
  const unknownIssues = new Set(["CHARACTERISTICS_ABSENT", "UNRESOLVED_IMPLEMENTATION_DELAY"]);
  const invalid = [...issues].some((issue) => !unknownIssues.has(issue));
  const aggregateStatus: CharacteristicsAggregateResult["status"] = invalid ? "INVALID" : issues.size ? "UNKNOWN" : "VALID";
  const criticalPath: CharacteristicsAggregateResult["derivedCriticalPathDelay"] = delay === null ? { state: "UNKNOWN", reasons: ["UNRESOLVED_IMPLEMENTATION_DELAY"] } : { state: "KNOWN", seconds: delay };
  const body: Omit<CharacteristicsAggregateResult, "aggregateFingerprint"> = {
    status: aggregateStatus,
    issues: [...issues].sort(), costs, burdens,
    declaredDelays: leaves.map((leaf) => ({ memberPath: leaf.path, value: leaf.action.timing.implementationDelay })).sort((a, b) => a.memberPath.localeCompare(b.memberPath)),
    derivedCriticalPathDelay: criticalPath,
    parallelBranches,
    reversibility: { summary, components: reversibilityComponents },
    audit: {
      members: leaves.map((leaf) => ({ memberPath: leaf.path, actionId: leaf.action.actionId, actionFingerprint: fingerprintCanonicalAction(leaf.action) })).sort((a, b) => a.memberPath.localeCompare(b.memberPath)),
      aliases: [...(context.aliases ?? [])].map((alias) => ({ ...alias, paths: [...alias.paths].sort() })).sort((a, b) => `${a.aliasContractRef}|${a.version}`.localeCompare(`${b.aliasContractRef}|${b.version}`)),
    },
  };
  return { aggregateFingerprint: fingerprint(body), ...body };
}

export function aggregateActionCharacteristics(nodeInput: unknown, contextInput: unknown = {}): CharacteristicsAggregateResult {
  try { return aggregateActionCharacteristicsUnsafe(nodeInput, contextInput); }
  catch { return emptyResult("INVALID_AGGREGATION_INPUT"); }
}

export function aggregateCompoundCharacteristics(
  compoundInput: unknown,
  context: CharacteristicAggregationContext = {},
): CharacteristicsAggregateResult {
  const parsedCompound = compoundActionSchema.safeParse(compoundInput);
  if (!parsedCompound.success) return emptyResult("INVALID_COMPOUND_ACTION");
  const compound = parsedCompound.data;
  const dependencies = new Map<string, string[]>();
  for (const dependency of compound.dependencies)
    dependencies.set(dependency.componentId, [...(dependencies.get(dependency.componentId) ?? []), dependency.dependsOn]);
  return aggregateActionCharacteristics({
    kind: "COMPOUND",
    compoundId: compound.compoundActionId,
    executionPolicy:
      compound.ordering === "ORDERED"
        ? "ORDERED"
        : compound.atomicity === "DEPENDENCY_GATED" || compound.dependencies.length > 0
          ? "DEPENDENCY_GATED"
          : "PARALLEL",
    members: compound.components.map((component) => ({
      componentId: component.componentId,
      ...(dependencies.has(component.componentId)
        ? { dependsOn: [...new Set(dependencies.get(component.componentId)!)].sort() }
        : {}),
      node: { kind: "ACTION", action: component.action },
    })),
  }, context);
}

export interface ExperimentCharacteristicsRegistry {
  readonly actions?: readonly CanonicalAction[];
  readonly compounds?: readonly CompoundAction[];
  readonly aliases?: readonly SharedExecutionAlias[];
}

export interface ExperimentCharacteristicsResult {
  readonly aggregateFingerprint: string;
  readonly status: "VALID" | "INVALID" | "UNKNOWN";
  readonly issues: readonly string[];
  readonly sharedSetup?: CharacteristicsAggregateResult;
  readonly arms: readonly {
    readonly armId: string;
    readonly role: "CONTROL" | "TREATMENT";
    readonly allocationBasisPoints: number;
    readonly vector: CharacteristicsAggregateResult;
  }[];
  readonly audit: readonly { readonly armId: string; readonly entityId: string; readonly entityFingerprint: string; readonly registryMatches: number }[];
}

export function aggregateExperimentCharacteristics(
  experimentInput: unknown,
  registryInput: unknown,
): ExperimentCharacteristicsResult {
  const invalid = (issue: string): ExperimentCharacteristicsResult => {
    const body = { status: "INVALID" as const, issues: [issue], arms: [], audit: [] };
    return { aggregateFingerprint: fingerprint(body), ...body };
  };
  const parsedAction = canonicalActionSchema.safeParse(experimentInput);
  if (!parsedAction.success) return invalid("INVALID_EXPERIMENT_ACTION");
  if (!registryInput || typeof registryInput !== "object" || Array.isArray(registryInput)) return invalid("INVALID_EXPERIMENT_REGISTRY");
  const experiment = parsedAction.data;
  const registry = registryInput as ExperimentCharacteristicsRegistry;
  if ((registry.actions !== undefined && !Array.isArray(registry.actions)) || (registry.compounds !== undefined && !Array.isArray(registry.compounds))) return invalid("INVALID_EXPERIMENT_REGISTRY");
  if ((registry.actions ?? []).some((entry) => !canonicalActionSchema.safeParse(entry).success) || (registry.compounds ?? []).some((entry) => !compoundActionSchema.safeParse(entry).success)) return invalid("INVALID_EXPERIMENT_REGISTRY_ENTRY");
  if (registry.aliases !== undefined && (!Array.isArray(registry.aliases) || registry.aliases.some((entry) => !aliasSchema.safeParse(entry).success))) return invalid("INVALID_ALIAS_CONTEXT");
  const actionFingerprints = new Map<string, Set<string>>();
  for (const entry of registry.actions ?? []) actionFingerprints.set(entry.actionId, new Set([...(actionFingerprints.get(entry.actionId) ?? []), fingerprintCanonicalAction(entry)]));
  if ([...actionFingerprints.values()].some((values) => values.size > 1)) return invalid("ACTION_ID_FINGERPRINT_CONFLICT");
  const compoundFingerprints = new Map<string, Set<string>>();
  for (const entry of registry.compounds ?? []) compoundFingerprints.set(entry.compoundActionId, new Set([...(compoundFingerprints.get(entry.compoundActionId) ?? []), fingerprintCompoundAction(entry)]));
  if ([...compoundFingerprints.values()].some((values) => values.size > 1)) return invalid("COMPOUND_ID_FINGERPRINT_CONFLICT");
  const parsedExperiment = experimentWhatSchema.safeParse(experiment.what);
  if (!parsedExperiment.success) return invalid("NOT_AN_EXPERIMENT");
  const aggregateContext: CharacteristicAggregationContext = registry.aliases === undefined ? {} : { aliases: registry.aliases };
  const issues = new Set<string>();
  const arms: ExperimentCharacteristicsResult["arms"][number][] = [];
  const audit: ExperimentCharacteristicsResult["audit"][number][] = [];
  for (const arm of parsedExperiment.data.arms) {
    let vector: CharacteristicsAggregateResult | undefined;
    if (arm.entityKind === "COMPOUND") {
      const matches = (registry.compounds ?? []).filter((entry) => entry.compoundActionId === arm.compoundActionId);
      audit.push({ armId: arm.armId, entityId: arm.compoundActionId, entityFingerprint: arm.actionFingerprint, registryMatches: matches.length });
      if (matches.length !== 1) issues.add(matches.length ? "AMBIGUOUS_EXPERIMENT_ARM" : "MISSING_EXPERIMENT_ARM");
      else if (fingerprintCompoundAction(matches[0]!) !== arm.actionFingerprint) issues.add("EXPERIMENT_ARM_FINGERPRINT_MISMATCH");
      else vector = aggregateCompoundCharacteristics(matches[0]!, aggregateContext);
    } else {
      const matches = (registry.actions ?? []).filter((entry) => entry.actionId === arm.actionId);
      audit.push({ armId: arm.armId, entityId: arm.actionId, entityFingerprint: arm.actionFingerprint, registryMatches: matches.length });
      if (matches.length !== 1) issues.add(matches.length ? "AMBIGUOUS_EXPERIMENT_ARM" : "MISSING_EXPERIMENT_ARM");
      else if (fingerprintCanonicalAction(matches[0]!) !== arm.actionFingerprint) issues.add("EXPERIMENT_ARM_FINGERPRINT_MISMATCH");
      else vector = aggregateActionCharacteristics({ kind: "ACTION", action: matches[0]! }, aggregateContext);
    }
    if (vector) arms.push({ armId: arm.armId, role: arm.role, allocationBasisPoints: arm.allocationBasisPoints, vector });
  }
  const nestedStatus = arms.some(({ vector }) => vector.status === "INVALID") ? "INVALID" : arms.some(({ vector }) => vector.status === "UNKNOWN") ? "UNKNOWN" : "VALID";
  const sharedSetup = experiment.characteristics.state === "PRESENT"
    ? aggregateActionCharacteristics({ kind: "ACTION", action: experiment }, aggregateContext)
    : undefined;
  const resultStatus: ExperimentCharacteristicsResult["status"] = issues.size
      ? ([...issues].some((issue) => issue.includes("MISMATCH") || issue.includes("AMBIGUOUS")) ? "INVALID" as const : "UNKNOWN" as const)
      : sharedSetup?.status === "INVALID" || nestedStatus === "INVALID"
        ? "INVALID"
        : sharedSetup?.status === "UNKNOWN" || nestedStatus === "UNKNOWN"
          ? "UNKNOWN"
          : "VALID";
  const body: Omit<ExperimentCharacteristicsResult, "aggregateFingerprint"> = {
    status: resultStatus,
    issues: [...issues].sort(),
    ...(sharedSetup ? { sharedSetup } : {}),
    arms: arms.sort((a, b) => a.armId.localeCompare(b.armId)),
    audit: audit.sort((a, b) => a.armId.localeCompare(b.armId)),
  };
  return { aggregateFingerprint: fingerprint(body), ...body };
}
