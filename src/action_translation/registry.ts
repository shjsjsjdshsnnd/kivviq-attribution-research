import {
  CORE_ACTION_TRANSLATORS,
} from "./translators.js";
import type {
  ActionTranslator,
  TranslationRegistry,
} from "./types.js";

export const CORE_TRANSLATION_REGISTRY: TranslationRegistry = {
  translators: CORE_ACTION_TRANSLATORS,
};

export function translatorsForActionType(
  registry: TranslationRegistry,
  actionType: string,
): readonly ActionTranslator[] {
  return registry.translators.filter(
    (translator) => translator.actionType === actionType,
  );
}

export function createTranslationRegistry(
  translators: readonly ActionTranslator[],
): TranslationRegistry {
  return { translators: [...translators] };
}
