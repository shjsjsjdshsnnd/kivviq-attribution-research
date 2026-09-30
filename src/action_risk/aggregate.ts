import { z } from "zod";
import { canonicalActionSchema, type CanonicalAction } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import { compoundActionSchema, fingerprintCompoundAction, type CompoundAction } from "../compound_action/schema.js";
import { experimentWhatSchema } from "../experiment/schema.js";
import {
  actionRiskMeasurementContractsSchema,
  riskMeasurementContractSchema,
  type ActionRiskMeasurementContracts,
  type RiskMeasurementContract,
} from "./schema.js";

export const RISK_DIMENSIONS = [
  "FINANCIAL_DOWNSIDE",
  "IRREVERSIBILITY",
  "UNCERTAINTY",
  "INVENTORY_EXPOSURE",
  "CUSTOMER_IMPACT",
  "TIME_TO_RECOVERY",
] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

export type RiskContractAggregateNode =
  | { readonly kind: "ACTION"; readonly action: CanonicalAction }
  | {
      readonly kind: "COMPOUND";
      readonly compoundId: string;
      readonly members: readonly {
        readonly componentId: string;
        readonly node: RiskContractAggregateNode;
      }[];
    };

export interface RiskExecutionAlias {
  readonly aliasContractRef: string;
  readonly version: string;
  readonly actionId: string;
  readonly actionFingerprint: string;
  readonly paths: readonly string[];
}

export interface RiskInteractionDefinition {
  readonly interactionId: string;
  readonly memberPaths: readonly string[];
  readonly measurements: readonly RiskMeasurementContract[];
}

export interface RiskAggregationRule {
  readonly registryRef: string;
  readonly code: string;
  readonly version: string;
  readonly dimension: RiskDimension;
  readonly origins: readonly { readonly memberPath: string; readonly measurementId: string }[];
}

export interface RiskContractViewContext {
  readonly aliases?: readonly RiskExecutionAlias[];
  readonly interactions?: readonly RiskInteractionDefinition[];
  readonly aggregationRules?: readonly RiskAggregationRule[];
}

type MemberOrigin = {
  readonly kind: "MEMBER";
  readonly memberPaths: readonly string[];
  readonly actionId: string;
  readonly actionFingerprint: string;
};
type InteractionOrigin = {
  readonly kind: "INTERACTION";
  readonly interactionId: string;
  readonly memberPaths: readonly string[];
};
export type RiskContractOrigin = MemberOrigin | InteractionOrigin;
export interface RiskContractViewEntry {
  readonly origin: RiskContractOrigin;
  readonly measurement: RiskMeasurementContract;
}
type DimensionView = { readonly [K in RiskDimension]: readonly RiskContractViewEntry[] };

export interface RiskContractViewResult {
  readonly viewFingerprint: string;
  readonly status: "VALID" | "INVALID" | "UNKNOWN";
  readonly issues: readonly string[];
  readonly dimensions: DimensionView;
  readonly aggregationGroups: readonly RiskAggregationRule[];
  readonly audit: {
    readonly members: readonly { readonly memberPath: string; readonly actionId: string; readonly actionFingerprint: string }[];
    readonly aliases: readonly RiskExecutionAlias[];
    readonly interactions: readonly { readonly interactionId: string; readonly memberPaths: readonly string[] }[];
  };
}

const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const fingerprintSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
const aliasSchema = z.object({
  aliasContractRef: ref,
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  actionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
  actionFingerprint: fingerprintSchema,
  paths: z.array(z.string().min(1)).min(2),
}).strict().superRefine((value, context) => {
  if (new Set(value.paths).size !== value.paths.length)
    context.addIssue({ code: "custom", path: ["paths"], message: "Alias paths must be unique" });
});
const interactionSchema = z.object({
  interactionId: ref,
  memberPaths: z.array(z.string().min(1)).min(2),
  measurements: z.array(riskMeasurementContractSchema).min(1),
}).strict().superRefine((value, context) => {
  if (new Set(value.memberPaths).size !== value.memberPaths.length)
    context.addIssue({ code: "custom", path: ["memberPaths"], message: "Interaction paths must be unique" });
  const ids = value.measurements.map(({ measurementId }) => measurementId);
  if (new Set(ids).size !== ids.length)
    context.addIssue({ code: "custom", path: ["measurements"], message: "Interaction measurement IDs must be unique" });
});
const aggregationOriginSchema = z.object({ memberPath: z.string().min(1), measurementId: ref }).strict();
const aggregationRuleSchema = z.object({
  registryRef: ref,
  code: ref,
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  dimension: z.enum(RISK_DIMENSIONS),
  origins: z.array(aggregationOriginSchema).min(2),
}).strict().superRefine((value, context) => {
  const keys = value.origins.map((origin) => `${origin.memberPath}\u0000${origin.measurementId}`);
  if (new Set(keys).size !== keys.length)
    context.addIssue({ code: "custom", path: ["origins"], message: "Aggregation origins must be unique" });
});
const contextSchema = z.object({
  aliases: z.array(aliasSchema).optional(),
  interactions: z.array(interactionSchema).optional(),
  aggregationRules: z.array(aggregationRuleSchema).optional(),
}).strict().superRefine((value, context) => {
  const interactions = value.interactions?.map(({ interactionId }) => interactionId) ?? [];
  if (new Set(interactions).size !== interactions.length)
    context.addIssue({ code: "custom", path: ["interactions"], message: "Interaction IDs must be unique" });
  const rules = value.aggregationRules?.map(({ registryRef, code, version }) => `${registryRef}\u0000${code}\u0000${version}`) ?? [];
  if (new Set(rules).size !== rules.length)
    context.addIssue({ code: "custom", path: ["aggregationRules"], message: "Aggregation rule identities must be unique" });
});

interface Leaf { path: string; action: CanonicalAction }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const serialized = stable(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index++)
    hash = ((hash ^ BigInt(serialized.charCodeAt(index))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function emptyDimensions(): Record<RiskDimension, RiskContractViewEntry[]> {
  return Object.fromEntries(RISK_DIMENSIONS.map((dimension) => [dimension, []])) as unknown as Record<RiskDimension, RiskContractViewEntry[]>;
}

function result(body: Omit<RiskContractViewResult, "viewFingerprint">): RiskContractViewResult {
  return { viewFingerprint: fingerprint(body), ...body };
}

function invalid(issue: string): RiskContractViewResult {
  return result({ status: "INVALID", issues: [issue], dimensions: emptyDimensions(), aggregationGroups: [], audit: { members: [], aliases: [], interactions: [] } });
}

function collect(node: RiskContractAggregateNode, path: string, active: Set<object>, leaves: Leaf[], issues: Set<string>): void {
  if (!node || typeof node !== "object") { issues.add("INVALID_AGGREGATE_NODE"); return; }
  if (node.kind === "ACTION") {
    if (Object.keys(node).some((key) => key !== "kind" && key !== "action")) { issues.add("INVALID_AGGREGATE_NODE"); return; }
    const parsed = canonicalActionSchema.safeParse(node.action);
    if (!parsed.success) { issues.add("INVALID_MEMBER_ACTION"); return; }
    leaves.push({ path, action: parsed.data });
    return;
  }
  if (node.kind !== "COMPOUND" || !/^compound_[A-Za-z0-9_.:-]+$/.test(node.compoundId) || !Array.isArray(node.members) || Object.keys(node).some((key) => !["kind", "compoundId", "members"].includes(key))) { issues.add("INVALID_AGGREGATE_NODE"); return; }
  if (active.has(node as object)) { issues.add("EXPANSION_CYCLE"); return; }
  active.add(node as object);
  const ids = node.members.map((member) => member?.componentId);
  if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) issues.add("DUPLICATE_COMPONENT_ID");
  for (const member of node.members) {
    if (!member || typeof member.componentId !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(member.componentId) || Object.keys(member).some((key) => key !== "componentId" && key !== "node")) { issues.add("INVALID_COMPONENT"); continue; }
    collect(member.node, `${path}/${member.componentId}`, active, leaves, issues);
  }
  active.delete(node as object);
}

function describeRiskContractsUnsafe(nodeInput: unknown, contextInput: unknown = {}): RiskContractViewResult {
  const parsedContext = contextSchema.safeParse(contextInput);
  if (!parsedContext.success) return invalid("INVALID_RISK_VIEW_CONTEXT");
  if (!nodeInput || typeof nodeInput !== "object") return invalid("INVALID_AGGREGATE_NODE");
  const node = nodeInput as RiskContractAggregateNode;
  const rootPath = node.kind === "ACTION" && node.action && typeof node.action === "object" && "actionId" in node.action
    ? String(node.action.actionId)
    : node.kind === "COMPOUND" ? node.compoundId : "invalid";
  const issues = new Set<string>();
  const rawLeaves: Leaf[] = [];
  collect(node, rootPath, new Set(), rawLeaves, issues);
  const auditMembers = rawLeaves.map(({ path, action }) => ({ memberPath: path, actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) })).sort((left, right) => left.memberPath.localeCompare(right.memberPath));
  const knownPaths = new Set(auditMembers.map(({ memberPath }) => memberPath));
  const byIdentity = new Map<string, Leaf[]>();
  const fingerprintsById = new Map<string, Set<string>>();
  for (const leaf of rawLeaves) {
    const actionFingerprint = fingerprintCanonicalAction(leaf.action);
    const key = `${leaf.action.actionId}\u0000${actionFingerprint}`;
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), leaf]);
    fingerprintsById.set(leaf.action.actionId, new Set([...(fingerprintsById.get(leaf.action.actionId) ?? []), actionFingerprint]));
  }
  if ([...fingerprintsById.values()].some((fingerprints) => fingerprints.size > 1)) issues.add("ACTION_ID_FINGERPRINT_CONFLICT");

  const selected: { leaves: Leaf[]; action: CanonicalAction }[] = [];
  const consumedAliases = new Set<RiskExecutionAlias>();
  for (const group of byIdentity.values()) {
    const ordered = [...group].sort((left, right) => left.path.localeCompare(right.path));
    const first = ordered[0]!;
    if (ordered.length === 1) { selected.push({ leaves: ordered, action: first.action }); continue; }
    const actionFingerprint = fingerprintCanonicalAction(first.action);
    const paths = ordered.map(({ path }) => path);
    const aliases = (parsedContext.data.aliases ?? []).filter((alias) =>
      alias.actionId === first.action.actionId && alias.actionFingerprint === actionFingerprint && stable([...alias.paths].sort()) === stable(paths));
    if (aliases.length !== 1) issues.add(aliases.length > 1 ? "AMBIGUOUS_ALIAS_CONTRACT" : "DUPLICATE_EXECUTION_IDENTITY");
    else { selected.push({ leaves: ordered, action: first.action }); consumedAliases.add(aliases[0]!); }
  }

  const dimensions = emptyDimensions();
  for (const { leaves, action } of selected) {
    if ("state" in action.riskDimensions) { issues.add("RISK_CONTRACTS_ABSENT"); continue; }
    const parsed = actionRiskMeasurementContractsSchema.safeParse(action.riskDimensions);
    if (!parsed.success) { issues.add("INVALID_RISK_CONTRACTS"); continue; }
    const origin: MemberOrigin = { kind: "MEMBER", memberPaths: leaves.map(({ path }) => path).sort(), actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action) };
    for (const dimension of RISK_DIMENSIONS)
      for (const measurement of parsed.data[dimension]) dimensions[dimension].push({ origin, measurement });
  }

  const interactionAudit: { interactionId: string; memberPaths: string[] }[] = [];
  for (const interaction of parsedContext.data.interactions ?? []) {
    if (interaction.memberPaths.some((path) => !knownPaths.has(path))) { issues.add("UNKNOWN_INTERACTION_MEMBER_PATH"); continue; }
    const memberPaths = [...interaction.memberPaths].sort();
    interactionAudit.push({ interactionId: interaction.interactionId, memberPaths });
    const origin: InteractionOrigin = { kind: "INTERACTION", interactionId: interaction.interactionId, memberPaths };
    for (const measurement of interaction.measurements) dimensions[measurement.dimension].push({ origin, measurement });
  }

  for (const dimension of RISK_DIMENSIONS)
    dimensions[dimension].sort((left, right) => stable(left).localeCompare(stable(right)));

  const contractOrigins = new Set<string>();
  for (const dimension of RISK_DIMENSIONS)
    for (const entry of dimensions[dimension])
      if (entry.origin.kind === "MEMBER")
        for (const memberPath of entry.origin.memberPaths) contractOrigins.add(`${dimension}\u0000${memberPath}\u0000${entry.measurement.measurementId}`);
  const aggregationGroups: RiskAggregationRule[] = [];
  for (const rule of parsedContext.data.aggregationRules ?? []) {
    if (rule.origins.some(({ memberPath, measurementId }) => !contractOrigins.has(`${rule.dimension}\u0000${memberPath}\u0000${measurementId}`))) {
      issues.add("UNKNOWN_AGGREGATION_ORIGIN"); continue;
    }
    aggregationGroups.push({ ...rule, origins: [...rule.origins].sort((left, right) => left.memberPath.localeCompare(right.memberPath) || left.measurementId.localeCompare(right.measurementId)) });
  }
  aggregationGroups.sort((left, right) => stable(left).localeCompare(stable(right)));
  const unknownOnly = [...issues].every((issue) => issue === "RISK_CONTRACTS_ABSENT");
  const body: Omit<RiskContractViewResult, "viewFingerprint"> = {
    status: issues.size === 0 ? "VALID" : unknownOnly ? "UNKNOWN" : "INVALID",
    issues: [...issues].sort(), dimensions, aggregationGroups,
    audit: {
      members: auditMembers,
      aliases: [...consumedAliases].map((alias) => ({ ...alias, paths: [...alias.paths].sort() })).sort((left, right) => stable(left).localeCompare(stable(right))),
      interactions: interactionAudit.sort((left, right) => left.interactionId.localeCompare(right.interactionId)),
    },
  };
  return result(body);
}

export function describeCompoundRiskContracts(nodeInput: unknown, contextInput: unknown = {}): RiskContractViewResult {
  try { return describeRiskContractsUnsafe(nodeInput, contextInput); }
  catch { return invalid("INVALID_RISK_VIEW_INPUT"); }
}

export function describeActionRiskContracts(actionInput: unknown): RiskContractViewResult {
  try {
    const parsed = canonicalActionSchema.safeParse(actionInput);
    if (!parsed.success) return invalid("INVALID_ACTION");
    return describeRiskContractsUnsafe({ kind: "ACTION", action: parsed.data });
  } catch { return invalid("INVALID_ACTION"); }
}

/** Validates and projects an Action's six value-free measurement contracts. */
export function validateRiskMeasurementContracts(actionInput: unknown): RiskContractViewResult {
  return describeActionRiskContracts(actionInput);
}

export function describeCanonicalCompoundRiskContracts(compoundInput: unknown, contextInput: unknown = {}): RiskContractViewResult {
  try {
    const parsed = compoundActionSchema.safeParse(compoundInput);
    if (!parsed.success) return invalid("INVALID_COMPOUND_ACTION");
    return describeRiskContractsUnsafe({
      kind: "COMPOUND", compoundId: parsed.data.compoundActionId,
      members: parsed.data.components.map((component) => ({ componentId: component.componentId, node: { kind: "ACTION" as const, action: component.action } })),
    }, contextInput);
  } catch { return invalid("INVALID_COMPOUND_ACTION"); }
}

export interface ExperimentRiskRegistry {
  readonly actions?: readonly CanonicalAction[];
  readonly compounds?: readonly CompoundAction[];
  readonly aliases?: readonly RiskExecutionAlias[];
  readonly interactions?: readonly RiskInteractionDefinition[];
  readonly aggregationRules?: readonly RiskAggregationRule[];
}
export interface ExperimentRiskContractViewResult {
  readonly viewFingerprint: string;
  readonly status: "VALID" | "INVALID" | "UNKNOWN";
  readonly issues: readonly string[];
  readonly sharedSetup?: RiskContractViewResult;
  readonly arms: readonly { readonly armId: string; readonly role: "CONTROL" | "TREATMENT"; readonly allocationBasisPoints: number; readonly view: RiskContractViewResult }[];
  readonly audit: readonly { readonly armId: string; readonly entityKind: "ACTION" | "COMPOUND"; readonly entityId: string; readonly entityFingerprint: string; readonly registryMatches: number }[];
}

const experimentRegistrySchema = z.object({
  actions: z.array(canonicalActionSchema).optional(), compounds: z.array(compoundActionSchema).optional(),
  aliases: z.array(aliasSchema).optional(), interactions: z.array(interactionSchema).optional(), aggregationRules: z.array(aggregationRuleSchema).optional(),
}).strict();

function invalidExperiment(issue: string): ExperimentRiskContractViewResult {
  const body = { status: "INVALID" as const, issues: [issue], arms: [], audit: [] };
  return { viewFingerprint: fingerprint(body), ...body };
}

function describeExperimentRiskContractsUnsafe(experimentInput: unknown, registryInput: unknown): ExperimentRiskContractViewResult {
  const parsedExperimentAction = canonicalActionSchema.safeParse(experimentInput);
  if (!parsedExperimentAction.success) return invalidExperiment("INVALID_EXPERIMENT_ACTION");
  const parsedWhat = experimentWhatSchema.safeParse(parsedExperimentAction.data.what);
  if (!parsedWhat.success) return invalidExperiment("NOT_AN_EXPERIMENT");
  const parsedRegistry = experimentRegistrySchema.safeParse(registryInput);
  if (!parsedRegistry.success) return invalidExperiment("INVALID_EXPERIMENT_REGISTRY");
  const registry = parsedRegistry.data;
  const issues = new Set<string>();
  const actionFingerprints = new Map<string, Set<string>>();
  for (const action of registry.actions ?? [])
    actionFingerprints.set(action.actionId, new Set([...(actionFingerprints.get(action.actionId) ?? []), fingerprintCanonicalAction(action)]));
  if ([...actionFingerprints.values()].some((fingerprints) => fingerprints.size > 1))
    issues.add("ACTION_ID_FINGERPRINT_CONFLICT");
  const compoundFingerprints = new Map<string, Set<string>>();
  for (const compound of registry.compounds ?? [])
    compoundFingerprints.set(compound.compoundActionId, new Set([...(compoundFingerprints.get(compound.compoundActionId) ?? []), fingerprintCompoundAction(compound)]));
  if ([...compoundFingerprints.values()].some((fingerprints) => fingerprints.size > 1))
    issues.add("COMPOUND_ID_FINGERPRINT_CONFLICT");
  const arms: ExperimentRiskContractViewResult["arms"][number][] = [];
  const audit: ExperimentRiskContractViewResult["audit"][number][] = [];
  const contextForCompound = (compoundActionId: string) => ({
    ...(registry.aliases ? { aliases: registry.aliases.filter((alias) => alias.paths.every((path) => path.startsWith(`${compoundActionId}/`))) } : {}),
    ...(registry.interactions ? { interactions: registry.interactions.filter((interaction) => interaction.memberPaths.every((path) => path.startsWith(`${compoundActionId}/`))) } : {}),
    ...(registry.aggregationRules ? { aggregationRules: registry.aggregationRules.filter((rule) => rule.origins.every((origin) => origin.memberPath.startsWith(`${compoundActionId}/`))) } : {}),
  });
  for (const arm of parsedWhat.data.arms) {
    if (arm.entityKind === "COMPOUND") {
      const matches = (registry.compounds ?? []).filter(({ compoundActionId }) => compoundActionId === arm.compoundActionId);
      audit.push({ armId: arm.armId, entityKind: "COMPOUND", entityId: arm.compoundActionId, entityFingerprint: arm.actionFingerprint, registryMatches: matches.length });
      if (matches.length !== 1) { issues.add(matches.length ? "AMBIGUOUS_EXPERIMENT_ARM" : "MISSING_EXPERIMENT_ARM"); continue; }
      if (fingerprintCompoundAction(matches[0]!) !== arm.actionFingerprint) { issues.add("EXPERIMENT_ARM_FINGERPRINT_MISMATCH"); continue; }
      arms.push({ armId: arm.armId, role: arm.role, allocationBasisPoints: arm.allocationBasisPoints, view: describeCanonicalCompoundRiskContracts(matches[0]!, contextForCompound(arm.compoundActionId)) });
    } else {
      const matches = (registry.actions ?? []).filter(({ actionId }) => actionId === arm.actionId);
      audit.push({ armId: arm.armId, entityKind: "ACTION", entityId: arm.actionId, entityFingerprint: arm.actionFingerprint, registryMatches: matches.length });
      if (matches.length !== 1) { issues.add(matches.length ? "AMBIGUOUS_EXPERIMENT_ARM" : "MISSING_EXPERIMENT_ARM"); continue; }
      if (fingerprintCanonicalAction(matches[0]!) !== arm.actionFingerprint) { issues.add("EXPERIMENT_ARM_FINGERPRINT_MISMATCH"); continue; }
      arms.push({ armId: arm.armId, role: arm.role, allocationBasisPoints: arm.allocationBasisPoints, view: describeActionRiskContracts(matches[0]!) });
    }
  }
  const sharedSetup = "state" in parsedExperimentAction.data.riskDimensions ? undefined : describeActionRiskContracts(parsedExperimentAction.data);
  const nestedStatus = arms.some(({ view }) => view.status === "INVALID") ? "INVALID" : arms.some(({ view }) => view.status === "UNKNOWN") ? "UNKNOWN" : "VALID";
  const invalidIssue = [...issues].some((issue) => issue !== "MISSING_EXPERIMENT_ARM");
  const status = invalidIssue || nestedStatus === "INVALID"
    ? "INVALID" as const
    : issues.size || nestedStatus === "UNKNOWN"
      ? "UNKNOWN" as const
      : "VALID" as const;
  const body: Omit<ExperimentRiskContractViewResult, "viewFingerprint"> = {
    status, issues: [...issues].sort(), ...(sharedSetup ? { sharedSetup } : {}),
    arms: arms.sort((left, right) => left.armId.localeCompare(right.armId)),
    audit: audit.sort((left, right) => left.armId.localeCompare(right.armId)),
  };
  return { viewFingerprint: fingerprint(body), ...body };
}

export function describeExperimentRiskContracts(experimentInput: unknown, registryInput: unknown): ExperimentRiskContractViewResult {
  try { return describeExperimentRiskContractsUnsafe(experimentInput, registryInput); }
  catch { return invalidExperiment("INVALID_EXPERIMENT_INPUT"); }
}
