import {
  canonicalActionSchema,
  fingerprintCanonicalAction,
  type CanonicalAction,
} from "../canonical_action/index.js";
import {
  compoundActionSchema,
  fingerprintCompoundAction,
  type CompoundAction,
} from "../compound_action/index.js";
import {
  assessPortfolioCompatibility,
  type PortfolioCompatibilityAssessment,
  type PortfolioCompatibilityContext,
} from "../action_conflicts/assessment.js";
import { translateBusinessAction } from "../action_translation/translate.js";
import type {
  BusinessActionTranslationInput,
  TranslationContext,
  TranslationResult,
} from "../action_translation/types.js";

export const ACTION_SPACE_VALIDATION_VERSION = "1.0.0" as const;

export type ValidatedActionSpaceEntity =
  | {
      readonly entityKind: "ACTION";
      readonly action: CanonicalAction;
      readonly fingerprint: string;
    }
  | {
      readonly entityKind: "COMPOUND";
      readonly action: CompoundAction;
      readonly fingerprint: string;
    };

export type ActionSpaceEntityValidation =
  | {
      readonly valid: true;
      readonly entity: ValidatedActionSpaceEntity;
    }
  | {
      readonly valid: false;
      readonly reasonCodes: readonly string[];
    };

export type ActionSpacePortfolioValidation =
  | {
      readonly valid: true;
      readonly members: readonly ValidatedActionSpaceEntity[];
      readonly references: readonly unknown[];
    }
  | {
      readonly valid: false;
      readonly reasonCodes: readonly string[];
    };

function issues(prefix: string, value: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string[] {
  return value.issues.map((issue) => {
    const path = issue.path.length > 0 ? "." + issue.path.map(String).join(".") : "";
    return `${prefix}${path}: ${issue.message}`;
  });
}

export function validateActionSpaceEntity(
  input: unknown,
): ActionSpaceEntityValidation {
  const action = canonicalActionSchema.safeParse(input);
  if (action.success)
    return {
      valid: true,
      entity: {
        entityKind: "ACTION",
        action: action.data,
        fingerprint: fingerprintCanonicalAction(action.data),
      },
    };

  const compound = compoundActionSchema.safeParse(input);
  if (compound.success)
    return {
      valid: true,
      entity: {
        entityKind: "COMPOUND",
        action: compound.data,
        fingerprint: fingerprintCompoundAction(compound.data),
      },
    };

  return {
    valid: false,
    reasonCodes: [
      ...issues("ACTION", action.error),
      ...issues("COMPOUND", compound.error),
    ].sort(),
  };
}

function entityIdentity(entity: ValidatedActionSpaceEntity): string {
  return entity.entityKind === "ACTION"
    ? `ACTION:${entity.action.actionId}`
    : `COMPOUND:${entity.action.compoundActionId}`;
}

function entityReference(entity: ValidatedActionSpaceEntity): unknown {
  return entity.entityKind === "ACTION"
    ? {
        entityKind: "ACTION" as const,
        actionId: entity.action.actionId,
        actionFingerprint: entity.fingerprint,
      }
    : {
        entityKind: "COMPOUND" as const,
        compoundActionId: entity.action.compoundActionId,
        compoundFingerprint: entity.fingerprint,
      };
}

export function validateActionSpacePortfolio(
  input: unknown,
): ActionSpacePortfolioValidation {
  if (!Array.isArray(input) || input.length === 0)
    return {
      valid: false,
      reasonCodes: ["PORTFOLIO_CONTAINER_INVALID"],
    };

  const members: ValidatedActionSpaceEntity[] = [];
  const reasonCodes: string[] = [];
  input.forEach((candidate, index) => {
    const checked = validateActionSpaceEntity(candidate);
    if (!checked.valid)
      reasonCodes.push(
        ...checked.reasonCodes.map((code) => `MEMBER_${index}:${code}`),
      );
    else members.push(checked.entity);
  });
  if (reasonCodes.length > 0)
    return { valid: false, reasonCodes: reasonCodes.sort() };

  const identities = members.map(entityIdentity);
  if (new Set(identities).size !== identities.length)
    return {
      valid: false,
      reasonCodes: ["DUPLICATE_PORTFOLIO_ENTITY_IDENTITY"],
    };

  return {
    valid: true,
    members,
    references: members.map(entityReference),
  };
}

export function assessActionSpacePortfolio(
  input: unknown,
  context: PortfolioCompatibilityContext | unknown,
):
  | {
      readonly valid: false;
      readonly reasonCodes: readonly string[];
    }
  | {
      readonly valid: true;
      readonly compatibility: PortfolioCompatibilityAssessment;
    } {
  const structural = validateActionSpacePortfolio(input);
  if (!structural.valid) return structural;
  return {
    valid: true,
    compatibility: assessPortfolioCompatibility(
      structural.references,
      context,
    ),
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function expectedTranslationProvenance(
  input: BusinessActionTranslationInput,
): {
  originatingBusinessActionId: string;
  sourceActionIds: ReadonlySet<string>;
} {
  if (input.kind === "resolved_compound_business_action")
    return {
      originatingBusinessActionId: input.compoundAction.compoundActionId,
      sourceActionIds: new Set(input.components.map((component) => component.actionId)),
    };
  return {
    originatingBusinessActionId: input.actionId,
    sourceActionIds: new Set([input.actionId]),
  };
}

function translationProvenancePreserved(
  input: BusinessActionTranslationInput,
  result: TranslationResult,
): boolean {
  if (result.status !== "TRANSLATED") return true;
  const expected = expectedTranslationProvenance(input);
  return result.interventions.every(
    (intervention) =>
      intervention.provenance.originatingBusinessActionId ===
        expected.originatingBusinessActionId &&
      expected.sourceActionIds.has(intervention.provenance.sourceActionId),
  );
}

export interface DeterministicTranslationAudit {
  readonly first: TranslationResult;
  readonly second: TranslationResult;
  readonly deterministic: boolean;
  readonly inputUnchanged: boolean;
  readonly provenancePreserved: boolean;
}

export function auditDeterministicBusinessTranslation(
  input: BusinessActionTranslationInput,
  context: TranslationContext,
): DeterministicTranslationAudit {
  const before = serialized(input);
  const first = translateBusinessAction(input, context);
  const between = serialized(input);
  const second = translateBusinessAction(input, context);
  const after = serialized(input);
  return {
    first,
    second,
    deterministic: serialized(first) === serialized(second),
    inputUnchanged: before === between && before === after,
    provenancePreserved:
      translationProvenancePreserved(input, first) &&
      translationProvenancePreserved(input, second),
  };
}
