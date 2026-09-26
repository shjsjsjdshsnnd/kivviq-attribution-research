import {
  SUPPORTED_ACTION_SCHEMA_VERSIONS,
  type Action,
  type CompoundAction,
} from "../action_ontology/types.js";
import { translateCanonicalAction } from './canonical.js';
import { validateAction } from "../action_ontology/validation.js";
import {
  ACTION_TRANSLATION_VERSION,
  type BusinessActionTranslationInput,
  type ExperimentTranslationReadiness,
  type ResolvedCompoundBusinessAction,
  type TranslatedResult,
  type TranslationContext,
  type TranslationFailure,
  type TranslationOrigin,
  type TranslationRegistry,
  type TranslationResult,
} from "./types.js";
import {
  contextHasCapability,
  validateTranslationContext,
} from "./context.js";
import {
  CORE_TRANSLATION_REGISTRY,
  translatorsForActionType,
} from "./registry.js";

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  status: TranslationFailure["status"],
  code: string,
  message: string,
  actionId?: string,
): TranslationFailure {
  return {
    status,
    code,
    message,
    ...(actionId ? { actionId } : {}),
  };
}

function translateAtomic(
  actionInput: unknown,
  context: TranslationContext,
  registry: TranslationRegistry,
  origin?: TranslationOrigin,
): TranslationResult {
  const validation = validateAction(actionInput);
  if (!validation.ok) {
    return failure(
      "INVALID_ACTION",
      "INVALID_CANONICAL_ACTION",
      validation.errors.map((issue) => issue.code).join(", "),
      record(actionInput) && typeof actionInput.actionId === "string"
        ? actionInput.actionId
        : undefined,
    );
  }

  const action = validation.action;
  const translators = translatorsForActionType(registry, action.actionType);

  if (translators.length === 0) {
    return failure(
      "UNSUPPORTED_ACTION_TYPE",
      "NO_REGISTERED_TRANSLATOR",
      "No explicit translator is registered for Action type " + action.actionType + ".",
      action.actionId,
    );
  }
  if (translators.length > 1) {
    return failure(
      "AMBIGUOUS_TRANSLATION",
      "DUPLICATE_REGISTERED_TRANSLATORS",
      "More than one translator is registered for Action type " + action.actionType + ".",
      action.actionId,
    );
  }

  const translator = translators[0]!;
  if (!translator.supportedTargetKinds.includes(action.target.kind)) {
    return failure(
      "UNSUPPORTED_TARGET",
      "TRANSLATOR_TARGET_UNSUPPORTED",
      "Translator " +
        translator.translatorId +
        " does not support target kind " +
        action.target.kind +
        ".",
      action.actionId,
    );
  }

  if (
    translator.requiredCapability &&
    !contextHasCapability(context, translator.requiredCapability)
  ) {
    return failure(
      "UNSUPPORTED_SIMULATOR_CAPABILITY",
      "SIMULATOR_CAPABILITY_UNAVAILABLE",
      "Simulator does not declare capability " + translator.requiredCapability + ".",
      action.actionId,
    );
  }

  const resolvedOrigin: TranslationOrigin = origin ?? {
    originatingBusinessActionId: action.actionId,
    sourceActionId: action.actionId,
    componentIndex: 0,
    componentCount: 1,
  };

  const result = translator.translate(action, context, resolvedOrigin);

  if (result.status === "EXPERIMENT_REQUIRES_ENGINE") {
    return {
      ...result,
      originatingBusinessActionId:
        resolvedOrigin.originatingBusinessActionId,
    };
  }

  if (result.status !== "TRANSLATED") return result;

  return {
    status: "TRANSLATED",
    originatingBusinessActionId:
      resolvedOrigin.originatingBusinessActionId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    interventions: result.interventions,
  };
}

function validateResolvedCompound(
  input: unknown,
):
  | { readonly ok: true; readonly value: ResolvedCompoundBusinessAction }
  | { readonly ok: false; readonly failure: TranslationFailure } {
  if (
    !record(input) ||
    input.kind !== "resolved_compound_business_action" ||
    !record(input.compoundAction) ||
    !Array.isArray(input.components)
  ) {
    return {
      ok: false,
      failure: failure(
        "INVALID_ACTION",
        "INVALID_RESOLVED_COMPOUND_ACTION",
        "Resolved compound translation input is malformed.",
      ),
    };
  }

  const compound = input.compoundAction as CompoundAction;
  if (
    compound.kind !== "compound_action" ||
    !SUPPORTED_ACTION_SCHEMA_VERSIONS.includes(compound.schemaVersion as never) ||
    typeof compound.compoundActionId !== "string" ||
    !Array.isArray(compound.componentActionIds) ||
    compound.componentActionIds.length < 2
  ) {
    return {
      ok: false,
      failure: failure(
        "INVALID_ACTION",
        "INVALID_COMPOUND_ACTION",
        "CompoundAction readiness contract is invalid.",
        typeof compound.compoundActionId === "string"
          ? compound.compoundActionId
          : undefined,
      ),
    };
  }

  if (input.components.length !== compound.componentActionIds.length) {
    return {
      ok: false,
      failure: failure(
        "INVALID_ACTION",
        "COMPOUND_COMPONENT_COUNT_MISMATCH",
        "Resolved components must match CompoundAction component IDs exactly.",
        compound.compoundActionId,
      ),
    };
  }

  const byId = new Map<string, Action>();
  for (const component of input.components) {
    const validation = validateAction(component);
    if (!validation.ok) {
      return {
        ok: false,
        failure: failure(
          "INVALID_ACTION",
          "INVALID_COMPOUND_COMPONENT",
          "A CompoundAction component is not a valid canonical Action.",
          compound.compoundActionId,
        ),
      };
    }
    if (byId.has(validation.action.actionId)) {
      return {
        ok: false,
        failure: failure(
          "AMBIGUOUS_TRANSLATION",
          "DUPLICATE_COMPOUND_COMPONENT",
          "CompoundAction contains duplicate component Action IDs.",
          compound.compoundActionId,
        ),
      };
    }
    byId.set(validation.action.actionId, validation.action);
  }

  const ordered: Action[] = [];
  for (const componentId of compound.componentActionIds) {
    const component = byId.get(componentId);
    if (!component) {
      return {
        ok: false,
        failure: failure(
          "INVALID_ACTION",
          "MISSING_COMPOUND_COMPONENT",
          "A referenced component Action is missing.",
          compound.compoundActionId,
        ),
      };
    }
    ordered.push(component);
  }

  return {
    ok: true,
    value: {
      kind: "resolved_compound_business_action",
      compoundAction: compound,
      components: ordered,
    },
  };
}

function translateCompound(
  input: unknown,
  context: TranslationContext,
  registry: TranslationRegistry,
): TranslationResult {
  const validated = validateResolvedCompound(input);
  if (!validated.ok) return validated.failure;

  const compound = validated.value.compoundAction;
  const components = validated.value.components;
  const interventions = [];

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    const result = translateAtomic(component, context, registry, {
      originatingBusinessActionId: compound.compoundActionId,
      sourceActionId: component.actionId,
      componentIndex: index,
      componentCount: components.length,
    });

    if (result.status === "EXPERIMENT_REQUIRES_ENGINE") {
      return failure(
        "AMBIGUOUS_TRANSLATION",
        "EXPERIMENT_COMPONENT_REQUIRES_ENGINE",
        "Compound Action translation cannot mix simulator interventions with experiment-engine readiness.",
        compound.compoundActionId,
      );
    }
    if (result.status !== "TRANSLATED") {
      return {
        ...result,
        actionId: compound.compoundActionId,
        message:
          "Compound component " +
          component.actionId +
          " could not be translated: " +
          result.message,
      };
    }

    interventions.push(...result.interventions);
  }

  return {
    status: "TRANSLATED",
    originatingBusinessActionId: compound.compoundActionId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    interventions,
  };
}

export function translateBusinessAction(
  input: unknown,
  contextInput: unknown,
  registry: TranslationRegistry = CORE_TRANSLATION_REGISTRY,
): TranslationResult {
  if (record(input) && input.schemaVersion === '2.0.0') {
    return translateCanonicalAction(input, contextInput);
  }
  const contextValidation = validateTranslationContext(contextInput);
  if (!contextValidation.ok) return contextValidation.failure;
  const context = contextValidation.context;

  if (
    record(input) &&
    input.kind === "resolved_compound_business_action"
  ) {
    return translateCompound(input, context, registry);
  }

  return translateAtomic(input, context, registry);
}
