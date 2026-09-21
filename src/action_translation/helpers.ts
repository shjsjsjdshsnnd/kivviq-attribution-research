import type {
  Action,
  ActionScope,
  ScalarValue,
  ValueOperation,
} from "../action_ontology/types.js";
import {
  SIMULATOR_INTERVENTION_SCHEMA_VERSION,
  type SimulatorIntervention,
  type SimulatorInterventionDraft,
  type SimulatorInterventionDuration,
  type SimulatorOperation,
  type SimulatorScope,
  type SimulatorScalarValue,
  type SimulatorTarget,
} from "../simulator_intervention/types.js";
import {
  assertValidSimulatorIntervention,
} from "../simulator_intervention/validation.js";
import {
  deterministicInterventionId,
} from "../simulator_intervention/semantics.js";
import {
  ACTION_TRANSLATION_VERSION,
  type TranslationContext,
  type TranslationFailure,
  type TranslationOrigin,
} from "./types.js";
import {
  resolveReference,
  resolveSimulatorTarget,
  scalarToSimulatorValue,
} from "./context.js";

export type PreparedTarget =
  | { readonly ok: true; readonly target: SimulatorTarget }
  | { readonly ok: false; readonly failure: TranslationFailure };

export function prepareTarget(
  action: Action,
  context: TranslationContext,
): PreparedTarget {
  const resolution = resolveSimulatorTarget(context, action.target);

  if (resolution.status === "missing") {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "MISSING_ENTITY_MAPPING",
        message: "No simulator entity mapping exists for the Action target.",
        missingContextRefs: [resolution.ref],
      },
    };
  }
  if (resolution.status === "ambiguous") {
    return {
      ok: false,
      failure: {
        status: "AMBIGUOUS_TRANSLATION",
        actionId: action.actionId,
        code: "AMBIGUOUS_ENTITY_MAPPING",
        message: "Multiple simulator entity mappings exist for the same Action target.",
        missingContextRefs: [resolution.ref],
      },
    };
  }

  return { ok: true, target: resolution.target };
}

export type PreparedEffectiveTime =
  | { readonly ok: true; readonly effectiveTime: Action["timing"]["decisionTime"] }
  | { readonly ok: false; readonly failure: TranslationFailure };

export function prepareEffectiveTime(action: Action): PreparedEffectiveTime {
  if (action.timing.effectiveStart.kind === "unknown") {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "UNKNOWN_EFFECTIVE_TIME",
        message:
          "Simulator translation requires a known effective time; it is not inferred from the simulator clock.",
        missingContextRefs: ["action.timing.effectiveStart"],
      },
    };
  }

  return {
    ok: true,
    effectiveTime: action.timing.effectiveStart.at,
  };
}

export function copyScope(scope: ActionScope): SimulatorScope {
  return {
    dimensions: scope.dimensions.map((dimension) => {
      switch (dimension.kind) {
        case "geography":
          return {
            kind: "geography" as const,
            include: [...dimension.include],
            ...(dimension.exclude ? { exclude: [...dimension.exclude] } : {}),
          };
        case "device":
          return {
            kind: "device" as const,
            devices: [...dimension.devices],
          };
        case "customer_population":
          return {
            kind: "customer_population" as const,
            segmentIds: [...dimension.segmentIds],
          };
        case "product_population":
          return {
            kind: "product_population" as const,
            ...(dimension.productIds
              ? { productIds: [...dimension.productIds] }
              : {}),
            ...(dimension.skuIds ? { skuIds: [...dimension.skuIds] } : {}),
            ...(dimension.collectionIds
              ? { collectionIds: [...dimension.collectionIds] }
              : {}),
          };
        case "channel_subset":
          return {
            kind: "channel_subset" as const,
            channelIds: [...dimension.channelIds],
            ...(dimension.campaignIds
              ? { campaignIds: [...dimension.campaignIds] }
              : {}),
          };
        case "paid_media_segment":
          return {
            kind: "paid_media_segment" as const,
            classification: dimension.classification,
            taxonomySource: dimension.taxonomySource,
            ...(dimension.segmentId
              ? { segmentId: dimension.segmentId }
              : {}),
          };
        case "time_window":
          return {
            kind: "time_window" as const,
            start: dimension.start,
            end: dimension.end,
          };
      }
    }),
  };
}

export function copyDuration(
  action: Action,
): SimulatorInterventionDuration {
  switch (action.duration.kind) {
    case "instantaneous":
      return { kind: "instantaneous" };
    case "temporary":
      return {
        kind: "temporary",
        durationSeconds: action.duration.durationSeconds,
      };
    case "persistent":
      return { kind: "persistent" };
    case "until_reversed":
      return { kind: "until_reversed" };
    case "recurring":
      return {
        kind: "recurring",
        recurrence: { ...action.duration.recurrence },
      };
  }
}

export function copyEndCondition(action: Action) {
  return { ...action.termination };
}

export type PreparedOperation =
  | { readonly ok: true; readonly operation: SimulatorOperation }
  | { readonly ok: false; readonly failure: TranslationFailure };

export function translateOperation<T extends ScalarValue>(
  action: Action,
  context: TranslationContext,
  operation: ValueOperation<T>,
  expectedKind: T["kind"],
): PreparedOperation {
  if (operation.kind === "SET") {
    if (operation.value.kind !== expectedKind) {
      return {
        ok: false,
        failure: {
          status: "INVALID_ACTION",
          actionId: action.actionId,
          code: "SET_UNIT_KIND_MISMATCH",
          message: "SET value kind does not match translator semantics.",
        },
      };
    }
    return {
      ok: true,
      operation: {
        kind: "SET",
        value: scalarToSimulatorValue(operation.value),
      },
    };
  }

  const reference = resolveReference(
    context,
    action,
    operation.reference,
    expectedKind,
  );

  if (reference.status === "missing") {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "MISSING_REFERENCE_BASELINE",
        message:
          "Relative Action semantics require an explicit decision-time baseline; none was available.",
        missingContextRefs: [reference.ref],
      },
    };
  }
  if (reference.status === "ambiguous") {
    return {
      ok: false,
      failure: {
        status: "AMBIGUOUS_TRANSLATION",
        actionId: action.actionId,
        code: "AMBIGUOUS_REFERENCE_BASELINE",
        message: "Multiple context bindings match the Action reference baseline.",
        missingContextRefs: [reference.ref],
      },
    };
  }
  if (reference.status === "unit_mismatch") {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "REFERENCE_BASELINE_UNIT_MISMATCH",
        message: "Available baseline uses incompatible units.",
        missingContextRefs: [reference.ref],
      },
    };
  }

  const baseline = {
    value: reference.value,
    referenceKind: operation.reference.kind,
    source: reference.source,
    sourceRef: reference.sourceRef,
  } as const;

  if (operation.kind === "DELTA") {
    if (operation.amount.kind !== expectedKind) {
      return {
        ok: false,
        failure: {
          status: "INVALID_ACTION",
          actionId: action.actionId,
          code: "DELTA_UNIT_KIND_MISMATCH",
          message: "DELTA amount kind does not match translator semantics.",
        },
      };
    }

    return {
      ok: true,
      operation: {
        kind: "DELTA",
        direction: operation.direction,
        amount: scalarToSimulatorValue(operation.amount),
        baseline,
      },
    };
  }

  return {
    ok: true,
    operation: {
      kind: "MULTIPLY",
      factor: operation.factor,
      baseline,
    },
  };
}

export function buildIntervention(
  action: Action,
  origin: TranslationOrigin,
  translatorId: string,
  interventionType: SimulatorInterventionDraft["interventionType"],
  target: SimulatorTarget,
  operation: SimulatorOperation,
  interventionIndexWithinComponent = 0,
  interventionCountWithinComponent = 1,
  membershipProvenance?: {
    readonly membershipSourceRef: string;
    readonly membershipBindingRef: string;
    readonly membershipBoundary:
      | "decision_time"
      | "translation_time"
      | "effective_time";
    readonly membershipSnapshotTime: Action["timing"]["decisionTime"];
  },
): SimulatorIntervention {
  const time = prepareEffectiveTime(action);
  if (!time.ok) throw new Error(time.failure.code);

  const draft: SimulatorInterventionDraft = {
    interventionType,
    schemaVersion: SIMULATOR_INTERVENTION_SCHEMA_VERSION,
    target,
    scope: copyScope(action.scope),
    operation,
    effectiveTime: time.effectiveTime,
    duration: copyDuration(action),
    endCondition: copyEndCondition(action),
    provenance: {
      originatingBusinessActionId: origin.originatingBusinessActionId,
      sourceActionId: origin.sourceActionId,
      translationVersion: ACTION_TRANSLATION_VERSION,
      translatorId,
      componentIndex: origin.componentIndex,
      componentCount: origin.componentCount,
      interventionIndexWithinComponent,
      interventionCountWithinComponent,
      ...(membershipProvenance ?? {}),
    },
  };

  return assertValidSimulatorIntervention({
    interventionId: deterministicInterventionId(draft),
    ...draft,
  });
}

export function scalarKind(
  value: SimulatorScalarValue,
): SimulatorScalarValue["kind"] {
  return value.kind;
}
