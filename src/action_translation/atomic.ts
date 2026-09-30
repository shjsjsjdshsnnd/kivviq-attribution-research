import {
  SUPPORTED_ACTION_SCHEMA_VERSIONS,
  type Action,
  type CompoundAction,
} from "../action_ontology/types.js";

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
import { contextHasCapability, validateTranslationContext } from "./context.js";
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

export function translateAtomic(
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
      "No explicit translator is registered for Action type " +
        action.actionType +
        ".",
      action.actionId,
    );
  }
  if (translators.length > 1) {
    return failure(
      "AMBIGUOUS_TRANSLATION",
      "DUPLICATE_REGISTERED_TRANSLATORS",
      "More than one translator is registered for Action type " +
        action.actionType +
        ".",
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
      "Simulator does not declare capability " +
        translator.requiredCapability +
        ".",
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
      originatingBusinessActionId: resolvedOrigin.originatingBusinessActionId,
    };
  }

  if (result.status !== "TRANSLATED") return result;

  return {
    status: "TRANSLATED",
    originatingBusinessActionId: resolvedOrigin.originatingBusinessActionId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    interventions: result.interventions,
  };
}
