import { describe, expect, it } from "vitest";
import {
  evaluatePricingRollbackReadiness,
} from "../../src/pricing/rollback.js";
import {
  rollbackTemporaryCollectionX,
  rollbackTemporarySkuASetExplicit899,
  rollbackTemporarySkuAToPreActionPrice,
} from "../../src/pricing/fixtures.js";

describe("Step 4 safe pricing rollback", () => {
  it("is READY when the current SKU price still matches the original Action output", () => {
    const result = evaluatePricingRollbackReadiness(
      rollbackTemporarySkuAToPreActionPrice,
      {
        currentPrice: {
          kind: "money",
          amountMinor: 79_900,
          currency: "CAD" as any,
        },
        currentPriceSourceRef: "state:sku-a:day-9",
      },
    );

    expect(result).toMatchObject({
      status: "READY",
      originalActionId: "action_price_sku_a_temp_799_7d",
      resolution: {
        kind: "single_price",
        rollbackPrice: {
          kind: "money",
          amountMinor: 89_900,
          currency: "CAD",
        },
      },
    });
  });

  it("distinguishes RESTORE_PRE_ACTION_VALUE from SET_EXPLICIT_VALUE rollback semantics", () => {
    const restored = evaluatePricingRollbackReadiness(
      rollbackTemporarySkuAToPreActionPrice,
      {
        currentPrice: {
          kind: "money",
          amountMinor: 79_900,
          currency: "CAD" as any,
        },
      },
    );
    const explicit = evaluatePricingRollbackReadiness(
      rollbackTemporarySkuASetExplicit899,
      {
        currentPrice: {
          kind: "money",
          amountMinor: 79_900,
          currency: "CAD" as any,
        },
      },
    );

    expect(restored.status).toBe("READY");
    expect(explicit.status).toBe("READY");
    expect(
      rollbackTemporarySkuAToPreActionPrice.parameters.kind ===
        "price_rollback"
        ? rollbackTemporarySkuAToPreActionPrice.parameters.strategy.kind
        : null,
    ).toBe("RESTORE_PRE_ACTION_VALUE");
    expect(
      rollbackTemporarySkuASetExplicit899.parameters.kind ===
        "price_rollback"
        ? rollbackTemporarySkuASetExplicit899.parameters.strategy.kind
        : null,
    ).toBe("SET_EXPLICIT_VALUE");
  });

  it("returns CONFLICT instead of overwriting a later legitimate price Action", () => {
    const result = evaluatePricingRollbackReadiness(
      rollbackTemporarySkuAToPreActionPrice,
      {
        currentPrice: {
          kind: "money",
          amountMinor: 84_900,
          currency: "CAD" as any,
        },
        currentPriceSourceRef: "state:sku-a:after-independent-action-b",
      },
    );

    expect(result).toMatchObject({
      status: "CONFLICT",
      code: "CURRENT_STATE_CHANGED_AFTER_ORIGINAL_ACTION",
    });
  });

  it("returns MISSING_CONTEXT when current price is unknown", () => {
    expect(
      evaluatePricingRollbackReadiness(
        rollbackTemporarySkuAToPreActionPrice,
        {},
      ),
    ).toMatchObject({
      status: "MISSING_CONTEXT",
      code: "MISSING_CURRENT_PRICE",
    });
  });

  it("supports membership-state rollback readiness without executing it", () => {
    const ready = evaluatePricingRollbackReadiness(
      rollbackTemporaryCollectionX,
      {
        currentMembershipStateRef:
          "pricing-state:collection-x:after-temp-action",
        preActionMembershipBindingRef:
          "membership:collection-x:pre-action-prices",
      },
    );
    expect(ready).toMatchObject({
      status: "READY",
      resolution: {
        kind: "membership_snapshot",
        bindingRef: "membership:collection-x:pre-action-prices",
      },
    });

    const conflict = evaluatePricingRollbackReadiness(
      rollbackTemporaryCollectionX,
      {
        currentMembershipStateRef:
          "pricing-state:collection-x:after-independent-change",
        preActionMembershipBindingRef:
          "membership:collection-x:pre-action-prices",
      },
    );
    expect(conflict.status).toBe("CONFLICT");
  });
});
