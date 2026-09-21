import type {
  Action,
  ActionTarget,
  MonetaryRateValue,
  MonetaryValue,
  ReferenceValue,
  ScalarValue,
  TemporalPoint,
  ValueOperation,
} from "./types.js";

export type SimulatorIntervention =
  | {
      readonly kind: "set_money_rate";
      readonly target: ActionTarget;
      readonly field: "budget";
      readonly value: MonetaryRateValue;
      readonly effectiveStart: TemporalPoint;
    }
  | {
      readonly kind: "set_money";
      readonly target: ActionTarget;
      readonly field: "price";
      readonly value: MonetaryValue;
      readonly effectiveStart: TemporalPoint;
    }
  | {
      readonly kind: "set_boolean";
      readonly target: ActionTarget;
      readonly field: string;
      readonly value: boolean;
      readonly effectiveStart: TemporalPoint;
    };

/**
 * Reference state is intentionally operator-safe. Implementations must expose
 * only observable/reference values available at decision time, never latent
 * simulator truth, counterfactual outcomes or future state.
 */
export interface ActionReferenceState {
  readonly resolveReference: (
    action: Action,
    reference: ReferenceValue,
    expectedKind: ScalarValue["kind"],
  ) => ScalarValue;
}

export interface ActionTranslator {
  readonly actionType: string;
  readonly translate: (
    action: Action,
    referenceState: ActionReferenceState,
  ) => readonly SimulatorIntervention[];
}

function referenceValue(
  action: Action,
  reference: ReferenceValue,
  expectedKind: ScalarValue["kind"],
  referenceState: ActionReferenceState,
): ScalarValue {
  if (reference.kind === "explicit_baseline") {
    if (reference.value.kind !== expectedKind) {
      throw new TypeError("Explicit baseline unit kind does not match operation");
    }
    return reference.value;
  }
  return referenceState.resolveReference(action, reference, expectedKind);
}

function assertSameMoneyUnit(
  left: MonetaryValue,
  right: MonetaryValue,
): void {
  if (left.currency !== right.currency) {
    throw new TypeError("Money operation currency mismatch");
  }
}

function assertSameMoneyRateUnit(
  left: MonetaryRateValue,
  right: MonetaryRateValue,
): void {
  if (left.currency !== right.currency || left.per !== right.per) {
    throw new TypeError("Money-rate operation unit mismatch");
  }
}

function applyMoneyOperation(
  action: Action,
  operation: ValueOperation<MonetaryValue>,
  referenceState: ActionReferenceState,
): MonetaryValue {
  if (operation.kind === "SET") return operation.value;

  const baseline = referenceValue(
    action,
    operation.reference,
    "money",
    referenceState,
  );
  if (baseline.kind !== "money") {
    throw new TypeError("Money operation resolved a non-money baseline");
  }

  if (operation.kind === "DELTA") {
    assertSameMoneyUnit(baseline, operation.amount);
    const sign = operation.direction === "increase" ? 1 : -1;
    const amountMinor = baseline.amountMinor + sign * operation.amount.amountMinor;
    if (amountMinor < 0) {
      throw new RangeError("Money DELTA cannot resolve below zero");
    }
    return {
      kind: "money",
      amountMinor,
      currency: baseline.currency,
    };
  }

  const amountMinor = Math.round(baseline.amountMinor * operation.factor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("Money MULTIPLY resolved an invalid minor-unit amount");
  }
  return {
    kind: "money",
    amountMinor,
    currency: baseline.currency,
  };
}

function applyMoneyRateOperation(
  action: Action,
  operation: ValueOperation<MonetaryRateValue>,
  referenceState: ActionReferenceState,
): MonetaryRateValue {
  if (operation.kind === "SET") return operation.value;

  const baseline = referenceValue(
    action,
    operation.reference,
    "money_rate",
    referenceState,
  );
  if (baseline.kind !== "money_rate") {
    throw new TypeError("Money-rate operation resolved a non-money-rate baseline");
  }

  if (operation.kind === "DELTA") {
    assertSameMoneyRateUnit(baseline, operation.amount);
    const sign = operation.direction === "increase" ? 1 : -1;
    const amountMinor = baseline.amountMinor + sign * operation.amount.amountMinor;
    if (amountMinor < 0) {
      throw new RangeError("Money-rate DELTA cannot resolve below zero");
    }
    return {
      kind: "money_rate",
      amountMinor,
      currency: baseline.currency,
      per: baseline.per,
    };
  }

  const amountMinor = Math.round(baseline.amountMinor * operation.factor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("Money-rate MULTIPLY resolved an invalid minor-unit amount");
  }
  return {
    kind: "money_rate",
    amountMinor,
    currency: baseline.currency,
    per: baseline.per,
  };
}

const adjustBudgetTranslator: ActionTranslator = {
  actionType: "advertising.adjust_budget",
  translate(action, referenceState) {
    if (action.parameters.kind !== "budget_adjustment") {
      throw new TypeError("advertising.adjust_budget requires budget_adjustment parameters");
    }
    return [
      {
        kind: "set_money_rate",
        target: action.target,
        field: "budget",
        value: applyMoneyRateOperation(
          action,
          action.parameters.operation,
          referenceState,
        ),
        effectiveStart: action.timing.effectiveStart,
      },
    ];
  },
};

const adjustPriceTranslator: ActionTranslator = {
  actionType: "pricing.adjust_price",
  translate(action, referenceState) {
    if (action.parameters.kind !== "price_adjustment") {
      throw new TypeError("pricing.adjust_price requires price_adjustment parameters");
    }
    return [
      {
        kind: "set_money",
        target: action.target,
        field: "price",
        value: applyMoneyOperation(
          action,
          action.parameters.operation,
          referenceState,
        ),
        effectiveStart: action.timing.effectiveStart,
      },
    ];
  },
};

const pauseCampaignTranslator: ActionTranslator = {
  actionType: "advertising.pause_campaign",
  translate(action) {
    if (action.parameters.kind !== "toggle") {
      throw new TypeError("advertising.pause_campaign requires toggle parameters");
    }
    return [
      {
        kind: "set_boolean",
        target: action.target,
        field: action.parameters.setting,
        value: action.parameters.value,
        effectiveStart: action.timing.effectiveStart,
      },
    ];
  },
};

const noCausalInterventionTranslator = (
  actionType: string,
): ActionTranslator => ({
  actionType,
  translate() {
    return [];
  },
});

export const CORE_ACTION_TRANSLATORS: readonly ActionTranslator[] = [
  adjustBudgetTranslator,
  adjustPriceTranslator,
  pauseCampaignTranslator,
  noCausalInterventionTranslator("no_op.do_nothing"),
  noCausalInterventionTranslator("no_op.wait_observe"),
  noCausalInterventionTranslator("investigation.inspect"),
] as const;

export function translateActionToInterventions(
  action: Action,
  referenceState: ActionReferenceState,
  translators: readonly ActionTranslator[] = CORE_ACTION_TRANSLATORS,
): readonly SimulatorIntervention[] {
  const translator = translators.find(
    (candidate) => candidate.actionType === action.actionType,
  );
  if (!translator) {
    throw new Error(
      "No typed Action-to-Intervention translator registered for " +
        action.actionType,
    );
  }
  return translator.translate(action, referenceState);
}
