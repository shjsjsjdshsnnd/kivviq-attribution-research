import type { CanonicalAction } from "../canonical_action/schema.js";
import type { TimingResolution } from "../action_timing/types.js";
import type {
  TranslationFailure,
  TranslationOrigin,
  TranslationResult,
} from "./types.js";
import { validateTranslationContext } from "./context.js";
import { CORE_TRANSLATION_REGISTRY } from "./registry.js";
import { translateAtomic } from "./atomic.js";

/** A resolved one-occurrence time window can be represented by existing
 * simulator contracts. Never erase populations, recurrence or state gates. */
export function translateResolvedLegacyBusiness(
  action: CanonicalAction,
  resolution: TimingResolution,
  simulator: unknown,
  origin?: TranslationOrigin,
): TranslationResult {
  const fail = (
    status: TranslationFailure["status"],
    code: string,
    message: string,
  ): TranslationFailure => ({
    status,
    actionId: action.actionId,
    code,
    message,
  });
  if (!("kind" in action.what) || action.what.kind !== "legacy_business")
    return fail(
      "INVALID_ACTION",
      "NOT_LEGACY_BUSINESS",
      "Expected inherited business semantics",
    );
  const timing = action.timing;
  if (
    action.population ||
    timing.recurrence.state === "SPECIFIED" ||
    timing.terminationCondition.state === "SPECIFIED" ||
    timing.dependencies.length
  )
    return fail(
      "UNSUPPORTED_SIMULATOR_CAPABILITY",
      "CANONICAL_SEMANTICS_UNSUPPORTED",
      "The legacy simulator adapter cannot preserve population, recurrence or state/dependency semantics.",
    );
  if (
    timing.decisionTime.state !== "SPECIFIED" ||
    timing.duration.state !== "SPECIFIED" ||
    !resolution.resolvedRequestedStart ||
    !resolution.resolvedEffectiveStart
  )
    return fail(
      "MISSING_CONTEXT",
      "RESOLVED_WINDOW_REQUIRED",
      "Translation requires an explicit decision and complete resolved time window.",
    );
  const d = timing.duration.value;
  const end = resolution.resolvedEnd;
  if (d.kind !== "PERSISTENT" && d.kind !== "INSTANTANEOUS" && !end)
    return fail(
      "MISSING_CONTEXT",
      "RESOLVED_END_REQUIRED",
      "A finite intervention requires its resolved end.",
    );
  const effective = resolution.resolvedEffectiveStart;
  const seconds = end ? (Date.parse(end) - Date.parse(effective)) / 1000 : 0;
  if (
    d.kind !== "PERSISTENT" &&
    d.kind !== "INSTANTANEOUS" &&
    (!Number.isSafeInteger(seconds) || seconds <= 0)
  )
    return fail(
      "UNSUPPORTED_SIMULATOR_CAPABILITY",
      "UNREPRESENTABLE_TIME_WINDOW",
      "Simulator duration requires positive whole elapsed seconds.",
    );
  const checked = validateTranslationContext(simulator);
  if (!checked.ok) return checked.failure;
  const { kind: _, legacySchemaVersion, ...business } = action.what;
  const duration =
    d.kind === "PERSISTENT"
      ? { kind: "persistent" }
      : d.kind === "INSTANTANEOUS"
        ? { kind: "instantaneous" }
        : { kind: "temporary", durationSeconds: seconds };
  const historical = {
    ...business,
    kind: "atomic_action",
    actionId: action.actionId,
    schemaVersion: legacySchemaVersion,
    timing: {
      decisionTime: timing.decisionTime.value,
      requestedStart: { kind: "known", at: resolution.resolvedRequestedStart },
      effectiveStart: { kind: "known", at: effective },
      implementationDelaySeconds: {
        kind: "known",
        seconds:
          (Date.parse(effective) -
            Date.parse(resolution.resolvedRequestedStart)) /
          1000,
      },
    },
    duration,
    termination: end ? { kind: "fixed_end", at: end } : { kind: "persistent" },
    provenance: {
      source: "human",
      createdAt: timing.decisionTime.value,
      evidenceRefs: action.provenance,
    },
  };
  const translated = translateAtomic(
    historical,
    checked.context,
    CORE_TRANSLATION_REGISTRY,
    origin,
  );
  return translated.status === "TRANSLATED"
    ? { ...translated, decisionType: "BUSINESS_INTERVENTION" }
    : translated;
}
