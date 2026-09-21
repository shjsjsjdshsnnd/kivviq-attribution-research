import type {
  Action,
  ActionTarget,
  ReferenceValue,
  ScalarValue,
} from "../action_ontology/types.js";
import type {
  SimulatorScalarValue,
  SimulatorTarget,
} from "../simulator_intervention/types.js";
import {
  SUPPORTED_TRANSLATION_CONTEXT_SCHEMA_VERSIONS,
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type PricingMembershipBinding,
  type TranslationContext,
  type TranslationFailure,
} from "./types.js";

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "futureDemand",
  "futureConversions",
  "futureRevenue",
  "futureStockout",
  "counterfactualRevenue",
  "counterfactualProfit",
  "trueIncrementalROAS",
  "trueResponseCurve",
  "oracleState",
  "oracleBestAction",
  "groundTruth",
  "groundTruthId",
  "evaluatorResult",
  "recommendationScore",
  "optimizerOutput",
]);

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function stableKey(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function scanForbidden(
  input: unknown,
  path: string,
  hits: string[],
): void {
  if (Array.isArray(input)) {
    input.forEach((entry, index) =>
      scanForbidden(entry, path + "[" + index + "]", hits),
    );
    return;
  }
  if (!record(input)) return;

  for (const [key, value] of Object.entries(input)) {
    const next = path === "$" ? key : path + "." + key;
    if (FORBIDDEN_CONTEXT_KEYS.has(key)) hits.push(next);
    scanForbidden(value, next, hits);
  }
}


function validatePricingMembershipBindings(
  input: unknown,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "pricingMembershipBindings must be an array",
    };
  }

  const bindingIds = new Set<string>();
  for (const binding of input) {
    if (
      !record(binding) ||
      !record(binding.actionTarget) ||
      !["product", "category", "collection"].includes(
        String(binding.actionTarget.kind),
      ) ||
      !["decision_time", "translation_time", "effective_time"].includes(
        String(binding.evaluateAt),
      ) ||
      !nonEmpty(binding.bindingRef) ||
      !nonEmpty(binding.sourceRef) ||
      typeof binding.snapshotTime !== "string" ||
      !binding.snapshotTime.endsWith("Z") ||
      !Number.isFinite(Date.parse(binding.snapshotTime)) ||
      !Array.isArray(binding.members) ||
      binding.members.length === 0
    ) {
      return {
        ok: false,
        message: "pricing membership binding is malformed",
      };
    }

    if (bindingIds.has(binding.bindingRef)) {
      return {
        ok: false,
        message: "pricing membership bindingRef values must be unique",
      };
    }
    bindingIds.add(binding.bindingRef);

    const members = new Set<string>();
    for (const member of binding.members) {
      if (
        !record(member) ||
        !record(member.skuTarget) ||
        member.skuTarget.kind !== "sku" ||
        !nonEmpty(member.skuTarget.skuId) ||
        !record(member.simulatorTarget) ||
        member.simulatorTarget.kind !== "sku" ||
        !nonEmpty(member.simulatorTarget.simulatorSkuId) ||
        !record(member.priceAtBoundary) ||
        member.priceAtBoundary.kind !== "money" ||
        !Number.isInteger(member.priceAtBoundary.amountMinor) ||
        Number(member.priceAtBoundary.amountMinor) < 0 ||
        typeof member.priceAtBoundary.currency !== "string" ||
        !/^[A-Z]{3}$/.test(member.priceAtBoundary.currency) ||
        !nonEmpty(member.priceSourceRef)
      ) {
        return {
          ok: false,
          message: "pricing membership member is malformed",
        };
      }

      if (members.has(member.skuTarget.skuId)) {
        return {
          ok: false,
          message: "pricing membership contains duplicate SKU members",
        };
      }
      members.add(member.skuTarget.skuId);
    }
  }

  return { ok: true };
}

export type TranslationContextValidationResult =
  | {
      readonly ok: true;
      readonly context: TranslationContext;
    }
  | {
      readonly ok: false;
      readonly failure: TranslationFailure;
    };

export function validateTranslationContext(
  input: unknown,
): TranslationContextValidationResult {
  if (!record(input)) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "INVALID_TRANSLATION_CONTEXT",
        message: "TranslationContext must be an object.",
      },
    };
  }

  const forbidden: string[] = [];
  scanForbidden(input, "$", forbidden);
  if (forbidden.length > 0) {
    return {
      ok: false,
      failure: {
        status: "INVALID_ACTION",
        code: "FORBIDDEN_TRANSLATION_CONTEXT_INFORMATION",
        message:
          "TranslationContext contains forbidden future/oracle/evaluator information: " +
          forbidden.join(", "),
      },
    };
  }

  if (
    !SUPPORTED_TRANSLATION_CONTEXT_SCHEMA_VERSIONS.includes(
      input.schemaVersion as never,
    )
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "UNSUPPORTED_TRANSLATION_CONTEXT_VERSION",
        message: "Unsupported TranslationContext schema version.",
      },
    };
  }

  if (
    typeof input.simulatorClock !== "string" ||
    !input.simulatorClock.endsWith("Z") ||
    !Number.isFinite(Date.parse(input.simulatorClock))
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "INVALID_SIMULATOR_CLOCK",
        message: "TranslationContext requires a valid UTC simulator clock.",
      },
    };
  }

  if (
    !Array.isArray(input.capabilities) ||
    !Array.isArray(input.entityMappings) ||
    !Array.isArray(input.referenceBindings)
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_TRANSLATION_CONTEXT",
        message:
          "TranslationContext capabilities, entityMappings and referenceBindings must be arrays.",
      },
    };
  }

  const pricingMembershipValidation = validatePricingMembershipBindings(
    input.pricingMembershipBindings,
  );
  if (!pricingMembershipValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_PRICING_MEMBERSHIP_CONTEXT",
        message: pricingMembershipValidation.message,
      },
    };
  }

  return { ok: true, context: input as TranslationContext };
}

export type TargetResolution =
  | { readonly status: "resolved"; readonly target: SimulatorTarget }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolveSimulatorTarget(
  context: TranslationContext,
  target: ActionTarget,
): TargetResolution {
  const key = stableKey(target);
  const matches = context.entityMappings.filter(
    (mapping) => stableKey(mapping.actionTarget) === key,
  );

  if (matches.length === 0) {
    return { status: "missing", ref: "target:" + key };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", ref: "target:" + key };
  }

  return { status: "resolved", target: matches[0]!.simulatorTarget };
}

export function scalarToSimulatorValue(
  value: ScalarValue,
): SimulatorScalarValue {
  switch (value.kind) {
    case "money":
      return {
        kind: "money",
        amountMinor: value.amountMinor,
        currency: value.currency,
      };
    case "money_rate":
      return {
        kind: "money_rate",
        amountMinor: value.amountMinor,
        currency: value.currency,
        per: value.per,
      };
    case "percentage":
      return { kind: "percentage", basisPoints: value.basisPoints };
    case "quantity":
      return { kind: "quantity", value: value.value, unit: value.unit };
    case "frequency":
      return { kind: "frequency", count: value.count, per: value.per };
    case "boolean":
      return { kind: "boolean", value: value.value };
    case "string":
      return { kind: "string", value: value.value };
  }
}

export type ReferenceResolution =
  | {
      readonly status: "resolved";
      readonly value: SimulatorScalarValue;
      readonly source: "action_explicit" | "translation_context";
      readonly sourceRef: string;
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string }
  | { readonly status: "unit_mismatch"; readonly ref: string };

export function resolveReference(
  context: TranslationContext,
  action: Action,
  reference: ReferenceValue,
  expectedKind: ScalarValue["kind"],
): ReferenceResolution {
  if (reference.kind === "explicit_baseline") {
    if (reference.value.kind !== expectedKind) {
      return {
        status: "unit_mismatch",
        ref: "action:" + action.actionId + ":explicit_baseline",
      };
    }
    return {
      status: "resolved",
      value: scalarToSimulatorValue(reference.value),
      source: "action_explicit",
      sourceRef: "action:" + action.actionId + ":explicit_baseline",
    };
  }

  const referenceKey = stableKey(reference);
  const matches = context.referenceBindings.filter(
    (binding) =>
      binding.actionId === action.actionId &&
      stableKey(binding.reference) === referenceKey,
  );

  if (matches.length === 0) {
    return {
      status: "missing",
      ref: "reference:" + action.actionId + ":" + referenceKey,
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      ref: "reference:" + action.actionId + ":" + referenceKey,
    };
  }

  const match = matches[0]!;
  if (match.value.kind !== expectedKind) {
    return {
      status: "unit_mismatch",
      ref: "reference:" + action.actionId + ":" + referenceKey,
    };
  }

  return {
    status: "resolved",
    value: scalarToSimulatorValue(match.value),
    source: "translation_context",
    sourceRef: match.sourceRef,
  };
}

export function contextHasCapability(
  context: TranslationContext,
  capability: string,
): boolean {
  return context.capabilities.includes(capability as never);
}


export type PricingMembershipResolution =
  | {
      readonly status: "resolved";
      readonly binding: PricingMembershipBinding;
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolvePricingMembership(
  context: TranslationContext,
  action: Action,
): PricingMembershipResolution {
  if (
    action.parameters.kind !== "price_adjustment" ||
    !action.parameters.membership ||
    !["product", "category", "collection"].includes(action.target.kind)
  ) {
    return {
      status: "missing",
      ref: "pricing-membership:not-applicable:" + action.actionId,
    };
  }

  const targetKey = stableKey(action.target);
  const matches = (context.pricingMembershipBindings ?? []).filter(
    (binding) =>
      stableKey(binding.actionTarget) === targetKey &&
      binding.evaluateAt === action.parameters.membership?.evaluateAt &&
      (!action.parameters.membership?.bindingRef ||
        binding.bindingRef === action.parameters.membership.bindingRef),
  );

  const ref =
    "pricing-membership:" +
    action.actionId +
    ":" +
    action.parameters.membership.evaluateAt +
    ":" +
    (action.parameters.membership.bindingRef ?? targetKey);

  if (matches.length === 0) {
    return { status: "missing", ref };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", ref };
  }

  const binding = matches[0]!;
  if (binding.members.length === 0) {
    return { status: "missing", ref };
  }

  return { status: "resolved", binding };
}
