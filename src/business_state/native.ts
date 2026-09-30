import {
  canonicalActionSchema,
} from "../canonical_action/schema.js";
import {
  fingerprintCanonicalAction,
} from "../canonical_action/serialization.js";
import {
  translateCanonicalAction,
} from "../action_translation/canonical.js";
import type {
  TranslationResult,
  TranslatedResult,
} from "../action_translation/types.js";
import type {
  SimulatorIntervention,
} from "../simulator_intervention/types.js";
import {
  assessActionCompatibility,
  type ActionCompatibility,
  type BusinessActionCandidate,
} from "./decision.js";
import type { BusinessStateSnapshot } from "./schema.js";

export type NativeBusinessStateTranslation =
  | {
      readonly status: "BLOCKED_BY_BUSINESS_STATE";
      readonly actionId: string;
      readonly actionFingerprint: string;
      readonly assessment: ActionCompatibility;
      readonly interventions: readonly [];
      readonly automaticDecisionAllowed: false;
    }
  | {
      readonly status: "ABSTAINED_BY_BUSINESS_STATE";
      readonly actionId: string;
      readonly actionFingerprint: string;
      readonly assessment: ActionCompatibility;
      readonly interventions: readonly [];
      readonly automaticDecisionAllowed: false;
    }
  | {
      readonly status: "NATIVE_TRANSLATION_FAILED";
      readonly actionId: string;
      readonly actionFingerprint: string;
      readonly assessment: ActionCompatibility;
      readonly translation: TranslationResult;
      readonly interventions: readonly [];
      readonly automaticDecisionAllowed: false;
    }
  | {
      readonly status: "NATIVE_TRANSLATED";
      readonly actionId: string;
      readonly actionFingerprint: string;
      readonly assessment: ActionCompatibility;
      readonly translation: TranslatedResult;
      readonly interventions: readonly SimulatorIntervention[];
      readonly automaticDecisionAllowed: false;
    };

export interface NativeStateBoundAction {
  readonly candidate: BusinessActionCandidate;
  readonly canonicalAction: unknown;
  /**
   * Raw native Action Translation context. Business State does not forge
   * eligibility, portfolio, timing, population, or simulator bindings.
   * The native translator independently validates all of them.
   */
  readonly translationContext: unknown;
}

export function translateStateBoundCanonicalAction(
  snapshot: BusinessStateSnapshot,
  input: NativeStateBoundAction,
): NativeBusinessStateTranslation {
  const action = canonicalActionSchema.parse(input.canonicalAction);
  if (action.actionId !== input.candidate.actionId) {
    throw new RangeError(
      "Business State candidate actionId must match the exact canonical Action",
    );
  }

  const actionFingerprint = fingerprintCanonicalAction(action);
  const assessment = assessActionCompatibility(snapshot, input.candidate);

  if (assessment.status === "BLOCKED") {
    return {
      status: "BLOCKED_BY_BUSINESS_STATE",
      actionId: action.actionId,
      actionFingerprint,
      assessment,
      interventions: [],
      automaticDecisionAllowed: false,
    };
  }

  if (assessment.status === "ABSTAIN") {
    return {
      status: "ABSTAINED_BY_BUSINESS_STATE",
      actionId: action.actionId,
      actionFingerprint,
      assessment,
      interventions: [],
      automaticDecisionAllowed: false,
    };
  }

  const translation = translateCanonicalAction(
    action,
    input.translationContext,
  );

  if (translation.status !== "TRANSLATED") {
    return {
      status: "NATIVE_TRANSLATION_FAILED",
      actionId: action.actionId,
      actionFingerprint,
      assessment,
      translation,
      interventions: [],
      automaticDecisionAllowed: false,
    };
  }

  return {
    status: "NATIVE_TRANSLATED",
    actionId: action.actionId,
    actionFingerprint,
    assessment,
    translation,
    interventions: translation.interventions,
    automaticDecisionAllowed: false,
  };
}

export function assertNoStateBypass(
  result: NativeBusinessStateTranslation,
): void {
  if (
    (result.status === "BLOCKED_BY_BUSINESS_STATE" ||
      result.status === "ABSTAINED_BY_BUSINESS_STATE" ||
      result.status === "NATIVE_TRANSLATION_FAILED") &&
    result.interventions.length !== 0
  ) {
    throw new Error(
      "A blocked, abstained, or failed state-bound action emitted an intervention",
    );
  }
}
