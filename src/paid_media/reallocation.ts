import type {
  Action,
  MonetaryRateValue,
} from "../action_ontology/types.js";
import { validateAction } from "../action_ontology/validation.js";
import {
  actionSemanticKey,
} from "../action_ontology/semantics.js";
import type {
  PaidMediaFundingPolicy,
  PaidMediaReallocationBundle,
} from "./types.js";

export interface PaidMediaReallocationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type PaidMediaReallocationValidationResult =
  | {
      readonly ok: true;
      readonly bundle: PaidMediaReallocationBundle;
      readonly errors: readonly [];
    }
  | {
      readonly ok: false;
      readonly errors: readonly PaidMediaReallocationIssue[];
    };

function add(
  errors: PaidMediaReallocationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
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

function stable(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function targetScopeKey(action: Action): string {
  return stable({ target: action.target, scope: action.scope });
}

function moneyRateFromBudgetDelta(
  action: Action,
):
  | {
      readonly direction: "increase" | "decrease";
      readonly amount: MonetaryRateValue;
    }
  | undefined {
  if (
    action.actionType !== "advertising.adjust_budget" ||
    action.parameters.kind !== "budget_adjustment" ||
    action.parameters.operation.kind !== "DELTA" ||
    action.parameters.operation.amount.kind !== "money_rate"
  ) {
    return undefined;
  }

  return {
    direction: action.parameters.operation.direction,
    amount: action.parameters.operation.amount,
  };
}

function transferLeg(
  action: Action,
) {
  if (
    action.actionType !== "advertising.transfer_budget_leg" ||
    action.parameters.kind !== "paid_media_transfer_leg"
  ) {
    return undefined;
  }
  return action.parameters;
}

function sameMoneyRateUnit(
  left: MonetaryRateValue,
  right: MonetaryRateValue,
): boolean {
  return left.currency === right.currency && left.per === right.per;
}

function fundingSignedAmount(
  funding: PaidMediaFundingPolicy,
  base: MonetaryRateValue,
  errors: PaidMediaReallocationIssue[],
): number {
  if (funding.kind === "pure_reallocation") return 0;
  if (!sameMoneyRateUnit(funding.amount, base)) {
    add(
      errors,
      "FUNDING_UNIT_MISMATCH",
      "fundingPolicy.amount",
      "funding currency and rate period must match the reallocation legs",
    );
    return Number.NaN;
  }
  return funding.kind === "incremental_funding"
    ? funding.amount.amountMinor
    : -funding.amount.amountMinor;
}

export function validatePaidMediaReallocation(
  input: PaidMediaReallocationBundle,
): PaidMediaReallocationValidationResult {
  const errors: PaidMediaReallocationIssue[] = [];
  const compound = input.compoundAction;

  if (
    compound.kind !== "compound_action" ||
    compound.componentActionIds.length < 2
  ) {
    add(
      errors,
      "INVALID_REALLOCATION_COMPOUND",
      "compoundAction",
      "reallocation requires a CompoundAction with at least two components",
    );
  }

  if (input.components.length !== compound.componentActionIds.length) {
    add(
      errors,
      "REALLOCATION_COMPONENT_COUNT_MISMATCH",
      "components",
      "component count must match CompoundAction componentActionIds",
    );
  }

  const byId = new Map<string, Action>();
  for (const [index, component] of input.components.entries()) {
    const result = validateAction(component);
    if (!result.ok) {
      add(
        errors,
        "INVALID_REALLOCATION_COMPONENT",
        "components[" + index + "]",
        "component is not a valid canonical Action",
      );
      continue;
    }
    if (byId.has(component.actionId)) {
      add(
        errors,
        "DUPLICATE_REALLOCATION_COMPONENT",
        "components[" + index + "].actionId",
        "component Action IDs must be unique",
      );
    }
    byId.set(component.actionId, component);
  }

  const ordered: Action[] = [];
  for (const componentId of compound.componentActionIds) {
    const component = byId.get(componentId);
    if (!component) {
      add(
        errors,
        "MISSING_REALLOCATION_COMPONENT",
        "compoundAction.componentActionIds",
        "referenced component Action is missing",
      );
    } else {
      ordered.push(component);
    }
  }

  if (ordered.length > 1) {
    const coordinationTiming = stable({
      timing: ordered[0]!.timing,
      duration: ordered[0]!.duration,
      termination: ordered[0]!.termination,
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const candidateTiming = stable({
        timing: ordered[index]!.timing,
        duration: ordered[index]!.duration,
        termination: ordered[index]!.termination,
      });
      if (candidateTiming !== coordinationTiming) {
        add(
          errors,
          "REALLOCATION_TIMING_MISMATCH",
          "components[" + index + "]",
          "coordinated reallocation legs must share timing, duration and termination semantics",
        );
      }
    }
  }

  const budgetLegs = ordered.map(moneyRateFromBudgetDelta);
  const transferLegs = ordered.map(transferLeg);
  const allBudget = budgetLegs.every((leg) => leg !== undefined);
  const allTransfer = transferLegs.every((leg) => leg !== undefined);

  if (!allBudget && !allTransfer) {
    add(
      errors,
      "MIXED_OR_UNSUPPORTED_REALLOCATION_LEGS",
      "components",
      "reallocation components must all be budget DELTAs or all be paid-media transfer legs",
    );
  }

  const sourceKeys = new Set<string>();
  const destinationKeys = new Set<string>();

  if (allBudget) {
    const legs = budgetLegs.filter(
      (leg): leg is NonNullable<typeof leg> => leg !== undefined,
    );
    const reference = legs[0]?.amount;
    if (reference) {
      let signedNet = 0;
      for (let index = 0; index < legs.length; index += 1) {
        const leg = legs[index]!;
        const component = ordered[index]!;
        if (!sameMoneyRateUnit(reference, leg.amount)) {
          add(
            errors,
            "REALLOCATION_UNIT_MISMATCH",
            "components[" + index + "]",
            "all monetary legs must use the same currency and rate period",
          );
        }
        const sign = leg.direction === "increase" ? 1 : -1;
        signedNet += sign * leg.amount.amountMinor;
        (sign < 0 ? sourceKeys : destinationKeys).add(targetScopeKey(component));
      }

      const expectedNet = fundingSignedAmount(
        input.fundingPolicy,
        reference,
        errors,
      );
      if (Number.isFinite(expectedNet) && signedNet !== expectedNet) {
        add(
          errors,
          "REALLOCATION_NOT_CONSERVED",
          "components",
          "signed budget changes do not match the explicitly declared funding policy",
        );
      }
    }
  }

  if (allTransfer) {
    const legs = transferLegs.filter(
      (leg): leg is NonNullable<typeof leg> => leg !== undefined,
    );
    if (input.fundingPolicy.kind !== "pure_reallocation") {
      add(
        errors,
        "PERCENTAGE_TRANSFER_REQUIRES_PURE_POLICY",
        "fundingPolicy",
        "percentage-of-source transfer legs currently require pure_reallocation",
      );
    }

    const first = legs[0];
    if (first) {
      for (let index = 0; index < legs.length; index += 1) {
        const leg = legs[index]!;
        const component = ordered[index]!;
        if (leg.transferId !== first.transferId) {
          add(
            errors,
            "TRANSFER_ID_MISMATCH",
            "components[" + index + "].parameters.transferId",
            "all transfer legs must share one transferId",
          );
        }
        if (stable(leg.amount) !== stable(first.amount)) {
          add(
            errors,
            "TRANSFER_AMOUNT_MISMATCH",
            "components[" + index + "].parameters.amount",
            "all transfer legs must preserve the same transfer basis",
          );
        }
        (leg.role === "source" ? sourceKeys : destinationKeys).add(
          targetScopeKey(component),
        );
      }
    }
  }

  if (sourceKeys.size === 0) {
    add(errors, "REALLOCATION_MISSING_SOURCE", "components", "source leg is required");
  }
  if (destinationKeys.size === 0) {
    add(
      errors,
      "REALLOCATION_MISSING_DESTINATION",
      "components",
      "destination leg is required",
    );
  }

  for (const key of sourceKeys) {
    if (destinationKeys.has(key)) {
      add(
        errors,
        "REALLOCATION_IDENTICAL_SOURCE_DESTINATION",
        "components",
        "source and destination target+scope must be meaningfully distinct",
      );
    }
  }

  return errors.length === 0
    ? { ok: true, bundle: input, errors: [] }
    : { ok: false, errors };
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function paidMediaReallocationFingerprint(
  bundle: PaidMediaReallocationBundle,
): string {
  const projection = {
    fundingPolicy: bundle.fundingPolicy,
    components: bundle.compoundAction.componentActionIds.map((id) => {
      const component = bundle.components.find(
        (candidate) => candidate.actionId === id,
      );
      return component ? actionSemanticKey(component) : "missing:" + id;
    }),
  };
  return "fnv1a64:" + fnv1a64(stable(projection));
}


export function serializePaidMediaReallocation(
  bundle: PaidMediaReallocationBundle,
): string {
  const result = validatePaidMediaReallocation(bundle);
  if (!result.ok) {
    throw new Error(
      "Invalid paid-media reallocation: " +
        result.errors.map((issue) => issue.code).join(", "),
    );
  }
  return stable(bundle);
}
