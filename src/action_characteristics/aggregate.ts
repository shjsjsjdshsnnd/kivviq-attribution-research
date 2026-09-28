import type { CanonicalAction } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { CompoundAction } from "../compound_action/schema.js";
import { fingerprintCompoundAction } from "../compound_action/schema.js";
import { experimentWhatSchema } from "../experiment/schema.js";
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
    readonly amount: QuantityState;
    readonly memberPaths: readonly string[];
  }[];
  readonly declaredDelays: readonly { readonly memberPath: string; readonly value: CanonicalAction["timing"]["implementationDelay"] }[];
  readonly derivedCriticalPathDelay: { readonly state: "KNOWN"; readonly seconds: number } | { readonly state: "UNKNOWN"; readonly reasons: readonly string[] };
  readonly parallelBranches: readonly { readonly path: string; readonly delay: number | null }[];
  readonly reversibility: { readonly summary: Reversibility["kind"]; readonly components: readonly { readonly memberPath: string; readonly value: Reversibility }[] };
}

interface Leaf { path: string; action: CanonicalAction; characteristics: ActionCharacteristics }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${key}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function delaySeconds(action: CanonicalAction): number | null {
  const delay = action.timing.implementationDelay;
  if (delay.state !== "SPECIFIED") return null;
  const value = delay.value;
  if (value.kind === "ELAPSED")
    return value.amount * (value.unit === "SECOND" ? 1 : value.unit === "MINUTE" ? 60 : 3600);
  if (value.unit === "DAY") return value.amount * 86_400;
  if (value.unit === "WEEK") return value.amount * 604_800;
  return null;
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

function computeDelay(node: CharacteristicAggregateNode, issues: Set<string>, active: Set<object>): number | null {
  if (node.kind === "ACTION") return delaySeconds(node.action);
  if (active.has(node as object)) { issues.add("EXPANSION_CYCLE"); return null; }
  active.add(node as object);
  const values = new Map<string, number | null>();
  for (const member of node.members) values.set(member.componentId, computeDelay(member.node, issues, active));
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
  for (const member of node.members) collect(member.node, `${path}/${member.componentId}`, active, leaves, issues);
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
  return ranged ? { state: "RANGE", minimum, maximum } : { state: "KNOWN", quantity: minimum };
}

const reversalRank: Record<Reversibility["kind"], number> = { IRREVERSIBLE: 5, PARTIALLY_REVERSIBLE: 4, UNKNOWN: 3, FULLY_REVERSIBLE: 2, NOT_APPLICABLE: 1 };

export function aggregateActionCharacteristics(node: CharacteristicAggregateNode, context: CharacteristicAggregationContext = {}): CharacteristicsAggregateResult {
  const issues = new Set<string>();
  const rawLeaves: Leaf[] = [];
  const rootPath = node.kind === "ACTION" ? node.action.actionId : node.compoundId;
  collect(node, rootPath, new Set(), rawLeaves, issues);
  const identities = new Map<string, Leaf[]>();
  for (const leaf of rawLeaves) {
    const key = `${leaf.action.actionId}|${fingerprintCanonicalAction(leaf.action)}`;
    identities.set(key, [...(identities.get(key) ?? []), leaf]);
  }
  const leaves: Leaf[] = [];
  for (const group of identities.values()) {
    if (group.length === 1) { leaves.push(group[0]!); continue; }
    const first = group[0]!;
    const fingerprint = fingerprintCanonicalAction(first.action);
    const aliases = (context.aliases ?? []).filter((alias) => alias.actionId === first.action.actionId && alias.actionFingerprint === fingerprint && stable([...alias.paths].sort()) === stable(group.map(({ path }) => path).sort()));
    if (aliases.length !== 1) issues.add(aliases.length > 1 ? "AMBIGUOUS_ALIAS_CONTRACT" : "DUPLICATE_EXECUTION_IDENTITY");
    else leaves.push(first);
  }

  const costGroups = new Map<string, { item: CostLineItem; path: string; phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION"; stage?: StageCancellationCost["stage"] }[]>();
  const burdenGroups = new Map<string, { item: OperationalBurdenLineItem; path: string }[]>();
  const addCost = (item: CostLineItem, path: string, phase: "IMPLEMENTATION" | "CANCELLATION" | "COMPENSATION", stage?: StageCancellationCost["stage"]) => {
    const key = moneyKey(item, phase, stage);
    const entry = stage === undefined ? { item, path, phase } : { item, path, phase, stage };
    costGroups.set(key, [...(costGroups.get(key) ?? []), entry]);
  };
  const addBurden = (item: OperationalBurdenLineItem, path: string) => {
    const exemplar = item.amount.state === "KNOWN" ? item.amount.value : item.amount.state === "RANGE" ? item.amount.minimum : null;
    const key = exemplar ? `${stable(exemplar.resource)}|${stable(exemplar.unit)}` : `?|${item.amount.state}`;
    burdenGroups.set(key, [...(burdenGroups.get(key) ?? []), { item, path }]);
  };
  for (const leaf of leaves) {
    leaf.characteristics.implementationCost.forEach((item) => addCost(item, leaf.path, "IMPLEMENTATION"));
    leaf.characteristics.operationalBurden.forEach((item) => addBurden(item, leaf.path));
    for (const stage of leaf.characteristics.cancellationCosts) {
      stage.cancellationCost.forEach((item) => addCost(item, leaf.path, "CANCELLATION", stage.stage));
      stage.compensationCost.forEach((item) => addCost(item, leaf.path, "COMPENSATION", stage.stage));
      stage.operationalBurden.forEach((item) => addBurden(item, leaf.path));
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
      resourceKey: key.split("|")[0]!,
      unitKey: key.split("|")[1]!,
      amount: aggregateQuantity(entries, issues),
      memberPaths: [...new Set(entries.map(({ path }) => path))].sort(),
    };
  }).sort((a, b) => stable(a).localeCompare(stable(b)));
  const delay = computeDelay(node, issues, new Set());
  const reversibilityComponents = leaves.map((leaf) => ({ memberPath: leaf.path, value: leaf.characteristics.reversibility })).sort((a, b) => a.memberPath.localeCompare(b.memberPath));
  const summary = reversibilityComponents.reduce<Reversibility["kind"]>((current, entry) => reversalRank[entry.value.kind] > reversalRank[current] ? entry.value.kind : current, "NOT_APPLICABLE");
  const invalid = [...issues].some((issue) => issue !== "CHARACTERISTICS_ABSENT");
  return {
    status: invalid ? "INVALID" : issues.size ? "UNKNOWN" : "VALID",
    issues: [...issues].sort(), costs, burdens,
    declaredDelays: leaves.map((leaf) => ({ memberPath: leaf.path, value: leaf.action.timing.implementationDelay })).sort((a, b) => a.memberPath.localeCompare(b.memberPath)),
    derivedCriticalPathDelay: delay === null ? { state: "UNKNOWN", reasons: ["UNRESOLVED_IMPLEMENTATION_DELAY"] } : { state: "KNOWN", seconds: delay },
    parallelBranches: node.kind === "COMPOUND" && node.executionPolicy === "PARALLEL" ? node.members.map((member) => ({ path: `${rootPath}/${member.componentId}`, delay: computeDelay(member.node, issues, new Set()) })) : [],
    reversibility: { summary, components: reversibilityComponents },
  };
}

export function aggregateCompoundCharacteristics(
  compound: CompoundAction,
  context: CharacteristicAggregationContext = {},
): CharacteristicsAggregateResult {
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
  readonly status: "VALID" | "INVALID" | "UNKNOWN";
  readonly issues: readonly string[];
  readonly sharedSetup?: CharacteristicsAggregateResult;
  readonly arms: readonly {
    readonly armId: string;
    readonly role: "CONTROL" | "TREATMENT";
    readonly allocationBasisPoints: number;
    readonly vector: CharacteristicsAggregateResult;
  }[];
}

export function aggregateExperimentCharacteristics(
  experiment: CanonicalAction,
  registry: ExperimentCharacteristicsRegistry,
): ExperimentCharacteristicsResult {
  const parsedExperiment = experimentWhatSchema.safeParse(experiment.what);
  if (!parsedExperiment.success)
    return { status: "INVALID", issues: ["NOT_AN_EXPERIMENT"], arms: [] };
  const aggregateContext: CharacteristicAggregationContext = registry.aliases === undefined ? {} : { aliases: registry.aliases };
  const issues = new Set<string>();
  const arms: ExperimentCharacteristicsResult["arms"][number][] = [];
  for (const arm of parsedExperiment.data.arms) {
    let vector: CharacteristicsAggregateResult | undefined;
    if (arm.entityKind === "COMPOUND") {
      const matches = (registry.compounds ?? []).filter((entry) => entry.compoundActionId === arm.compoundActionId);
      if (matches.length !== 1) issues.add(matches.length ? "AMBIGUOUS_EXPERIMENT_ARM" : "MISSING_EXPERIMENT_ARM");
      else if (fingerprintCompoundAction(matches[0]!) !== arm.actionFingerprint) issues.add("EXPERIMENT_ARM_FINGERPRINT_MISMATCH");
      else vector = aggregateCompoundCharacteristics(matches[0]!, aggregateContext);
    } else {
      const matches = (registry.actions ?? []).filter((entry) => entry.actionId === arm.actionId);
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
  return {
    status: issues.size
      ? ([...issues].some((issue) => issue.includes("MISMATCH")) ? "INVALID" : "UNKNOWN")
      : sharedSetup?.status === "INVALID" || nestedStatus === "INVALID"
        ? "INVALID"
        : sharedSetup?.status === "UNKNOWN" || nestedStatus === "UNKNOWN"
          ? "UNKNOWN"
          : "VALID",
    issues: [...issues].sort(),
    ...(sharedSetup ? { sharedSetup } : {}),
    arms: arms.sort((a, b) => a.armId.localeCompare(b.armId)),
  };
}
