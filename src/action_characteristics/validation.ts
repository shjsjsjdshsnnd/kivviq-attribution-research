import type { CanonicalAction } from "../canonical_action/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import {
  actionCharacteristicsSchema,
  assertReachableCancellationStages,
  type StageReachabilityInput,
} from "./schema.js";
import { z } from "zod";

export interface RegisteredReversalContract {
  readonly kind: "REGISTERED";
  readonly registryRef: string;
  readonly code: string;
  readonly version: string;
  readonly domainActionTypes: readonly string[];
}

export interface CharacteristicsValidationContext {
  readonly actions?: readonly CanonicalAction[];
  readonly registeredReversals?: readonly RegisteredReversalContract[];
}

const safeRef = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const registeredReversalSchema = z.object({
  kind: z.literal("REGISTERED"), registryRef: safeRef, code: safeRef, version: versionRef,
  domainActionTypes: z.array(safeRef).min(1).superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "Domain action types must be unique" });
  }),
}).strict();
const validationContextSchema = z.object({
  actions: z.array(canonicalActionSchema).optional(),
  registeredReversals: z.array(registeredReversalSchema).optional(),
}).strict().superRefine((value, context) => {
  const contracts = value.registeredReversals ?? [];
  const keys = contracts.map((entry) => `${entry.registryRef}|${entry.code}|${entry.version}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["registeredReversals"], message: "Registered reversal contracts must be unique" });
});

export interface CharacteristicsValidationResult {
  readonly status: "VALID" | "INVALID" | "UNKNOWN";
  readonly issues: readonly string[];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${key}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function domainFamily(actionType: string): string {
  return actionType.split(".", 1)[0]!;
}

const rollbackActionTypes: Readonly<Record<string, { actionType: string; parameterKind: string }>> = {
  pricing: { actionType: "pricing.rollback_price", parameterKind: "price_rollback" },
  shipping: { actionType: "shipping.rollback_policy", parameterKind: "shipping_policy_rollback" },
  merchandising: { actionType: "merchandising.rollback_rank", parameterKind: "merchandising_rank_rollback" },
  cro: { actionType: "cro.rollback_experience", parameterKind: "cro_rollback" },
};

function validateTypedRollbackContract(source: CanonicalAction, candidate: CanonicalAction): readonly string[] {
  const adapter = rollbackActionTypes[domainFamily(source.what.actionType)];
  if (!adapter) return domainFamily(candidate.what.actionType) === domainFamily(source.what.actionType) ? [] : ["REVERSAL_ACTION_DOMAIN_MISMATCH"];
  if (candidate.what.actionType !== adapter.actionType) return ["REVERSAL_ACTION_TYPE_MISMATCH"];
  if (!("kind" in source.what) || source.what.kind !== "legacy_business" || !("kind" in candidate.what) || candidate.what.kind !== "legacy_business")
    return ["REVERSAL_ACTION_CONTRACT_UNSUPPORTED"];
  const candidateWhat = candidate.what as typeof candidate.what & { reversalOfActionId?: string; parameters?: { kind?: string; originalActionId?: string; conflictGuard?: { sourceActionId?: string } }; target?: unknown };
  const sourceWhat = source.what as typeof source.what & { target?: unknown };
  const issues: string[] = [];
  if (candidateWhat.reversalOfActionId !== source.actionId || candidateWhat.parameters?.originalActionId !== source.actionId || candidateWhat.parameters?.conflictGuard?.sourceActionId !== source.actionId)
    issues.push("REVERSAL_ACTION_SOURCE_MISMATCH");
  if (candidateWhat.parameters?.kind !== adapter.parameterKind) issues.push("REVERSAL_ACTION_TYPE_MISMATCH");
  if (stable(candidateWhat.target) !== stable(sourceWhat.target)) issues.push("REVERSAL_ACTION_TARGET_MISMATCH");
  return issues;
}

function hasFiniteCompletion(action: CanonicalAction): boolean {
  return (
    action.timing.end.state === "SPECIFIED" ||
    (action.timing.duration.state === "SPECIFIED" &&
      action.timing.duration.value.kind !== "PERSISTENT")
  );
}

function profile(action: CanonicalAction): StageReachabilityInput | undefined {
  const type = action.what.actionType;
  if (type === "lifecycle.send") return { kind: "INSTANTANEOUS_SEND" };
  if (type === "inventory.reorder")
    return {
      kind: "COMMITTED_INVENTORY_PURCHASE",
      commitmentOccursDuringImplementation: true,
      hasCompletion: hasFiniteCompletion(action),
    };
  if (type === "pricing.adjust_price" && hasFiniteCompletion(action))
    return {
      kind: "TEMPORARY_PRICE",
      implementationPrecedesEffect: true,
      hasFiniteCompletion: true,
    };
  if (["advertising.adjust_budget", "lifecycle.adjust_frequency", "lifecycle.adjust_contact_policy"].includes(type))
    return { kind: "PERSISTENT_POLICY", hasExplicitCompletion: hasFiniteCompletion(action) };
  return undefined;
}

export function validateActionCharacteristics(
  input: unknown,
  contextInput: unknown = {},
): CharacteristicsValidationResult {
  const parsedContext = validationContextSchema.safeParse(contextInput);
  if (!parsedContext.success) return { status: "INVALID", issues: ["INVALID_VALIDATION_CONTEXT"] };
  const context = parsedContext.data;
  const parsedAction = canonicalActionSchema.safeParse(input);
  if (!parsedAction.success)
    return { status: "INVALID", issues: ["INVALID_ACTION"] };
  const action = parsedAction.data;
  if (action.characteristics.state !== "PRESENT")
    return { status: "UNKNOWN", issues: ["CHARACTERISTICS_ABSENT"] };
  const parsed = actionCharacteristicsSchema.safeParse(action.characteristics.value);
  if (!parsed.success)
    return { status: "INVALID", issues: ["INVALID_CHARACTERISTICS"] };

  const issues: string[] = [];
  let unknown = false;
  const stageProfile = profile(action);
  if (!stageProfile) { unknown = true; issues.push("UNSUPPORTED_STAGE_PROFILE"); }
  else try { assertReachableCancellationStages(stageProfile, parsed.data); }
  catch { issues.push("STAGE_PROFILE_MISMATCH"); }

  const reversibility = parsed.data.reversibility;
  if (action.what.actionType === "lifecycle.send" && reversibility.kind === "FULLY_REVERSIBLE")
    issues.push("IRREVERSIBLE_DOMAIN_CANNOT_BE_FULLY_REVERSIBLE");
  if (action.what.actionType === "inventory.reorder" && reversibility.kind === "FULLY_REVERSIBLE")
    issues.push("COMMITTED_INVENTORY_CANNOT_BE_FULLY_REVERSIBLE");

  if (reversibility.kind === "FULLY_REVERSIBLE" || reversibility.kind === "PARTIALLY_REVERSIBLE") {
    const reversal = reversibility.reversal;
    if (reversal.kind === "ACTION") {
      const matches = (context.actions ?? []).filter(({ actionId }) => actionId === reversal.actionId);
      if (matches.length !== 1) {
        unknown = true;
        issues.push(matches.length === 0 ? "REVERSAL_ACTION_MISSING" : "REVERSAL_ACTION_AMBIGUOUS");
      } else if (fingerprintCanonicalAction(matches[0]!) !== reversal.actionFingerprint) {
        issues.push("REVERSAL_ACTION_FINGERPRINT_MISMATCH");
      } else {
        const candidate = matches[0]!;
        issues.push(...validateTypedRollbackContract(action, candidate));
      }
    } else {
      const matches = (context.registeredReversals ?? []).filter(
        (entry) =>
          entry.registryRef === reversal.registryRef &&
          entry.code === reversal.code &&
          entry.version === reversal.version,
      );
      if (matches.length !== 1) {
        unknown = true;
        issues.push(matches.length === 0 ? "REGISTERED_REVERSAL_MISSING" : "REGISTERED_REVERSAL_AMBIGUOUS");
      } else if (!matches[0]!.domainActionTypes.includes(action.what.actionType)) {
        issues.push("REGISTERED_REVERSAL_DOMAIN_MISMATCH");
      }
    }
  }
  const invalid = issues.some((issue) => issue !== "UNSUPPORTED_STAGE_PROFILE" && !issue.endsWith("_MISSING") && !issue.endsWith("_AMBIGUOUS"));
  return { status: invalid ? "INVALID" : unknown ? "UNKNOWN" : "VALID", issues: [...new Set(issues)].sort() };
}
