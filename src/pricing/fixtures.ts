import { currencyCode, utcTimestamp } from "../core/units.js";
import { reduceProductPrice10 as step1PriceFixture } from "../action_ontology/fixtures.js";
import {
  actionId,
  actionType,
  constraintId,
} from "../action_ontology/identity.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionParameters,
  type ActionScope,
  type ActionTarget,
  type MonetaryValue,
  type PricingRollbackContract,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";

const CAD = currencyCode("CAD");
const USD = currencyCode("USD");
const DECISION = utcTimestamp("2026-09-20T13:00:00Z");
const OCTOBER_1 = utcTimestamp("2026-10-01T04:00:00Z");
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function money(amountMinor: number, currency = CAD): MonetaryValue {
  return { kind: "money", amountMinor, currency };
}

function pricingAction(input: {
  readonly actionIdValue: string;
  readonly actionTypeValue?: "pricing.adjust_price" | "pricing.rollback_price";
  readonly description: string;
  readonly target: ActionTarget;
  readonly parameters: ActionParameters;
  readonly scope?: ActionScope;
  readonly timing?: Action["timing"];
  readonly duration?: Action["duration"];
  readonly termination?: Action["termination"];
  readonly constraints?: Action["constraints"];
  readonly preconditions?: Action["preconditions"];
  readonly pricingRollback?: PricingRollbackContract;
  readonly reversalOfActionId?: Action["reversalOfActionId"];
}): Action {
  const duration = input.duration ?? ({ kind: "persistent" } as const);
  const termination =
    input.termination ??
    (duration.kind === "temporary"
      ? ({
          kind: "fixed_duration",
          durationSeconds: duration.durationSeconds,
        } as const)
      : duration.kind === "instantaneous"
        ? ({
            kind: "fixed_end",
            at:
              input.timing?.effectiveStart.kind === "known"
                ? input.timing.effectiveStart.at
                : DECISION,
          } as const)
        : ({ kind: "persistent" } as const));

  return assertValidAction({
    ...step1PriceFixture,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue ?? "pricing.adjust_price"),
    actionCategory: "pricing",
    schemaVersion: "1.2.0",
    description: input.description,
    target: input.target,
    scope: input.scope ?? { dimensions: [] },
    parameters: input.parameters,
    timing:
      input.timing ??
      {
        decisionTime: DECISION,
        requestedStart: { kind: "known", at: DECISION },
        effectiveStart: { kind: "known", at: DECISION },
        implementationDelaySeconds: { kind: "known", seconds: 0 },
      },
    duration,
    termination,
    constraints: input.constraints ?? [],
    preconditions: input.preconditions ?? [],
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target: input.target,
        parameterKind: input.parameters.kind,
      },
      minimumDelaySeconds: 0,
      ...(input.pricingRollback
        ? { pricingRollback: input.pricingRollback }
        : {}),
    },
    ...(input.reversalOfActionId
      ? { reversalOfActionId: input.reversalOfActionId }
      : {}),
    intent: {
      statement: "Represent an explicit merchant pricing decision.",
    },
  });
}

function currentPriceReference() {
  return {
    kind: "current_at_decision" as const,
    decisionTime: DECISION,
  };
}

function membership(
  evaluateAt: "decision_time" | "translation_time" | "effective_time",
  bindingRef: string,
) {
  return { evaluateAt, bindingRef } as const;
}

export const setSkuA849Cad = pricingAction({
  actionIdValue: "action_price_sku_a_set_849_cad",
  description: "Set SKU A price to CAD 849.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "SET",
      value: money(84_900),
    },
  },
});

export const increaseSkuA50Cad = pricingAction({
  actionIdValue: "action_price_sku_a_increase_50_cad",
  description: "Increase SKU A price by CAD 50.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "DELTA",
      direction: "increase",
      amount: money(5_000),
      reference: {
        kind: "explicit_baseline",
        value: money(89_900),
      },
    },
  },
});

export const reduceSkuA10Percent = pricingAction({
  actionIdValue: "action_price_sku_a_reduce_10pct",
  description: "Reduce SKU A price by 10%.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.9,
      reference: currentPriceReference(),
    },
  },
});

export const increaseProductX5Percent = pricingAction({
  actionIdValue: "action_price_product_x_increase_5pct",
  description: "Increase Product X prices by 5%.",
  target: { kind: "product", productId: "product:X" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 1.05,
      reference: currentPriceReference(),
    },
    membership: membership(
      "decision_time",
      "membership:product-x:2026-09-20T13:00:00Z",
    ),
  },
});

export const reduceCategoryX10Percent = pricingAction({
  actionIdValue: "action_price_category_x_reduce_10pct",
  description: "Reduce Category X prices by 10%.",
  target: { kind: "category", categoryId: "category:X" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.9,
      reference: currentPriceReference(),
    },
    membership: membership(
      "decision_time",
      "membership:category-x:2026-09-20T13:00:00Z",
    ),
  },
});

export const reduceCollectionX15Percent = pricingAction({
  actionIdValue: "action_price_collection_x_reduce_15pct",
  description: "Reduce Collection X prices by 15%.",
  target: { kind: "collection", collectionId: "collection:X" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.85,
      reference: currentPriceReference(),
    },
    membership: membership(
      "decision_time",
      "membership:collection-x:2026-09-20T13:00:00Z",
    ),
  },
});

export const setSkuA949EffectiveOctober1 = pricingAction({
  actionIdValue: "action_price_sku_a_set_949_oct1",
  description: "Set SKU A price to CAD 949 effective October 1.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "SET",
      value: money(94_900),
    },
  },
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: OCTOBER_1 },
    effectiveStart: { kind: "known", at: OCTOBER_1 },
    implementationDelaySeconds: { kind: "known", seconds: 0 },
  },
});

export const temporarySkuA799SevenDays = pricingAction({
  actionIdValue: "action_price_sku_a_temp_799_7d",
  description: "Set SKU A to CAD 799 for seven days.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "SET",
      value: money(79_900),
    },
  },
  duration: { kind: "temporary", durationSeconds: SEVEN_DAYS },
  pricingRollback: {
    available: true,
    target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      source: {
        kind: "single_price",
        preActionPrice: {
          kind: "explicit_baseline",
          value: money(89_900),
        },
      },
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "known",
      value: money(0),
      sourceRef: "pricing:rollback:no-direct-cost",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId("action_price_sku_a_temp_799_7d"),
      expected: {
        kind: "single_price",
        price: money(79_900),
      },
    },
  },
});

export const temporaryCollectionX10PercentSevenDays = pricingAction({
  actionIdValue: "action_price_collection_x_temp_reduce_10pct_7d",
  description: "Reduce Collection X prices by 10% for seven days.",
  target: { kind: "collection", collectionId: "collection:X" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.9,
      reference: currentPriceReference(),
    },
    membership: membership(
      "decision_time",
      "membership:collection-x:2026-09-20T13:00:00Z",
    ),
  },
  duration: { kind: "temporary", durationSeconds: SEVEN_DAYS },
  pricingRollback: {
    available: true,
    target: { kind: "collection", collectionId: "collection:X" },
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      source: {
        kind: "membership_snapshot",
        bindingRef: "membership:collection-x:pre-action-prices",
      },
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "unknown",
      reason: "rollback execution cost is not known at Action-definition time",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId(
        "action_price_collection_x_temp_reduce_10pct_7d",
      ),
      expected: {
        kind: "membership_state",
        stateRef: "pricing-state:collection-x:after-temp-action",
      },
    },
  },
});

export const rollbackTemporaryCollectionX = pricingAction({
  actionIdValue: "action_price_rollback_collection_x_temp",
  actionTypeValue: "pricing.rollback_price",
  description:
    "Rollback Collection X temporary pricing only if the expanded membership pricing state is unchanged.",
  target: { kind: "collection", collectionId: "collection:X" },
  parameters: {
    kind: "price_rollback",
    originalActionId: temporaryCollectionX10PercentSevenDays.actionId,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      source: {
        kind: "membership_snapshot",
        bindingRef: "membership:collection-x:pre-action-prices",
      },
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporaryCollectionX10PercentSevenDays.actionId,
      expected: {
        kind: "membership_state",
        stateRef: "pricing-state:collection-x:after-temp-action",
      },
    },
  },
  duration: { kind: "instantaneous" },
  termination: { kind: "fixed_end", at: DECISION },
  reversalOfActionId: temporaryCollectionX10PercentSevenDays.actionId,
});

export const rollbackTemporarySkuAToPreActionPrice = pricingAction({
  actionIdValue: "action_price_rollback_sku_a_temp_799",
  actionTypeValue: "pricing.rollback_price",
  description:
    "Rollback the temporary SKU A price if its current state is still the state produced by the temporary Action.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_rollback",
    originalActionId: temporarySkuA799SevenDays.actionId,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      source: {
        kind: "single_price",
        preActionPrice: {
          kind: "explicit_baseline",
          value: money(89_900),
        },
      },
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporarySkuA799SevenDays.actionId,
      expected: {
        kind: "single_price",
        price: money(79_900),
      },
    },
  },
  duration: { kind: "instantaneous" },
  termination: { kind: "fixed_end", at: DECISION },
  reversalOfActionId: temporarySkuA799SevenDays.actionId,
});

export const rollbackTemporarySkuASetExplicit899 = pricingAction({
  actionIdValue: "action_price_rollback_sku_a_explicit_899",
  actionTypeValue: "pricing.rollback_price",
  description:
    "Rollback SKU A to an explicit CAD 899 value only if the original temporary Action still owns the current price state.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_rollback",
    originalActionId: temporarySkuA799SevenDays.actionId,
    strategy: {
      kind: "SET_EXPLICIT_VALUE",
      value: money(89_900),
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporarySkuA799SevenDays.actionId,
      expected: {
        kind: "single_price",
        price: money(79_900),
      },
    },
  },
  duration: { kind: "instantaneous" },
  termination: { kind: "fixed_end", at: DECISION },
  reversalOfActionId: temporarySkuA799SevenDays.actionId,
});

export const reduceSkuA10WithGrossMargin35Floor = pricingAction({
  actionIdValue: "action_price_sku_a_reduce_10_gross_margin_35",
  description:
    "Reduce SKU A by 10% only if gross margin rate remains at least 35%.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.9,
      reference: currentPriceReference(),
    },
  },
  constraints: [
    {
      constraintId: constraintId("sku_a_gross_margin_rate_floor"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.gross_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 3500 },
      },
    },
  ],
  preconditions: [
    {
      preconditionId: "sku_a_cogs_available",
      expression: {
        kind: "evidence_available",
        evidenceRef: "product_economics:cogs:sku:A",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

export const reduceSkuB10WithContributionMargin20Floor = pricingAction({
  actionIdValue: "action_price_sku_b_reduce_10_contribution_margin_20",
  description:
    "Reduce SKU B by 10% only if contribution margin rate remains at least 20%.",
  target: { kind: "sku", productId: "product:B", skuId: "sku:B" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "MULTIPLY",
      factor: 0.9,
      reference: currentPriceReference(),
    },
  },
  constraints: [
    {
      constraintId: constraintId("sku_b_contribution_margin_rate_floor"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.contribution_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 2000 },
      },
    },
  ],
  preconditions: [
    {
      preconditionId: "sku_b_cogs_fulfillment_available",
      expression: {
        kind: "evidence_available",
        evidenceRef: "product_economics:contribution_inputs:sku:B",
      },
      whenUnknown: "unknown_eligibility",
    },
  ],
});

export const setSkuA899Usd = pricingAction({
  actionIdValue: "action_price_sku_a_set_899_usd",
  description: "Set SKU A price to USD 899.",
  target: { kind: "sku", productId: "product:A", skuId: "sku:A" },
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "SET",
      value: money(89_900, USD),
    },
  },
});

export const invalidNegativePriceAction: unknown = {
  ...setSkuA849Cad,
  actionId: "action_price_invalid_negative",
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "SET",
      value: {
        kind: "money",
        amountMinor: -1,
        currency: "CAD",
      },
    },
  },
};

export const invalidMissingCurrencyPriceAction: unknown = {
  ...setSkuA849Cad,
  actionId: "action_price_invalid_missing_currency",
  parameters: {
    kind: "price_adjustment",
    operation: {
      kind: "SET",
      value: {
        kind: "money",
        amountMinor: 84_900,
      },
    },
  },
};
