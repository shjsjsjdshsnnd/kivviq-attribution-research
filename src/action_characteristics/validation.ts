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
        if (domainFamily(candidate.what.actionType) !== domainFamily(action.what.actionType))
          issues.push("REVERSAL_ACTION_DOMAIN_MISMATCH");
        if ("kind" in action.what && action.what.kind === "legacy_business" && "kind" in candidate.what && candidate.what.kind === "legacy_business") {
          if (candidate.what.reversalOfActionId !== undefined && candidate.what.reversalOfActionId !== action.actionId)
            issues.push("REVERSAL_ACTION_SOURCE_MISMATCH");
          if (stable(candidate.what.target) !== stable(action.what.target))
            issues.push("REVERSAL_ACTION_TARGET_MISMATCH");
        }
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
