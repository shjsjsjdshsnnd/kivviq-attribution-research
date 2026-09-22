import { describe, expect, it } from "vitest";
import {
  currencyCode,
  utcTimestamp,
} from "../../src/core/units.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type TranslationContext,
} from "../../src/action_translation/types.js";
import {
  validateTranslationContext,
} from "../../src/action_translation/context.js";
import {
  translateBusinessAction,
} from "../../src/action_translation/translate.js";
import {
  collectionPromotionMissingMembershipBinding,
  modifyCollectionX15To20,
  startAutomaticCollectionX15FourDays,
  startBundleAB999Cad,
  startCollectionXFall15Coupon,
  startProductA100CadOff,
  startSkuAFixedPromotionalPrice749,
  stopCollectionXAutomatic15,
} from "../../src/promotion/fixtures.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-21T13:00:00Z");

const context: TranslationContext = {
  schemaVersion: TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock: DECISION,
  capabilities: ["promotion_discount"],
  entityMappings: [
    {
      actionTarget: { kind: "product", productId: "product:A" },
      simulatorTarget: {
        kind: "product",
        simulatorProductId: "sim:product:A",
      },
      sourceRef: "mapping:product-a",
    },
  ],
  referenceBindings: [],
  promotionMembershipBindings: [
    {
      promotionId: "promo_collection_x_auto_15",
      evaluateAt: "decision_time",
      bindingRef: "membership:promo:collection-x:2026-09-21T13:00:00Z",
      snapshotTime: DECISION,
      sourceRef: "catalog-snapshot:promo-collection-x:decision",
      members: [
        {
          businessTarget: {
            kind: "sku",
            productId: "product:C1",
            skuId: "sku:C1",
          },
          simulatorTarget: {
            kind: "sku",
            simulatorProductId: "sim:product:C1",
            simulatorSkuId: "sim:sku:C1",
          },
          sourceRef: "membership:sku:C1",
        },
        {
          businessTarget: {
            kind: "sku",
            productId: "product:C2",
            skuId: "sku:C2",
          },
          simulatorTarget: {
            kind: "sku",
            simulatorProductId: "sim:product:C2",
            simulatorSkuId: "sim:sku:C2",
          },
          sourceRef: "membership:sku:C2",
        },
      ],
    },
  ],
};

describe("Step 5 promotion translation", () => {
  it("translates a simple automatic fixed-amount product promotion without mutating regular price", () => {
    const result = translateBusinessAction(startProductA100CadOff, context);
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]).toMatchObject({
      interventionType: "promotion_discount",
      target: {
        kind: "product",
        simulatorProductId: "sim:product:A",
      },
      operation: {
        kind: "SET",
        value: {
          kind: "money",
          amountMinor: 10_000,
          currency: "CAD",
        },
      },
      provenance: {
        promotionId: "promo_product_a_100_cad",
      },
    });
    expect(result.interventions[0]!.interventionType).not.toBe("price");
  });

  it("expands automatic Collection X promotion from a frozen membership snapshot", () => {
    const result = translateBusinessAction(
      startAutomaticCollectionX15FourDays,
      context,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(2);
    expect(
      result.interventions.map((intervention) => intervention.operation),
    ).toEqual([
      {
        kind: "SET",
        value: { kind: "percentage", basisPoints: 1500 },
      },
      {
        kind: "SET",
        value: { kind: "percentage", basisPoints: 1500 },
      },
    ]);
    for (const intervention of result.interventions) {
      expect(intervention.interventionType).toBe("promotion_discount");
      expect(intervention.provenance).toMatchObject({
        promotionId: "promo_collection_x_auto_15",
        membershipBindingRef:
          "membership:promo:collection-x:2026-09-21T13:00:00Z",
        membershipSourceRef:
          "catalog-snapshot:promo-collection-x:decision",
        membershipBoundary: "decision_time",
        membershipSnapshotTime: DECISION,
      });
      expect(intervention.duration).toEqual({
        kind: "temporary",
        durationSeconds: 4 * 24 * 60 * 60,
      });
    }
  });

  it("uses the exact membership bindingRef for deterministic replay", () => {
    const replay: TranslationContext = {
      ...context,
      promotionMembershipBindings: [
        ...(context.promotionMembershipBindings ?? []),
        {
          promotionId: "promo_collection_x_auto_15",
          evaluateAt: "decision_time",
          bindingRef: "membership:promo:collection-x:later",
          snapshotTime: DECISION,
          sourceRef: "catalog-snapshot:later",
          members: [
            {
              businessTarget: {
                kind: "sku",
                productId: "product:L",
                skuId: "sku:L",
              },
              simulatorTarget: {
                kind: "sku",
                simulatorProductId: "sim:product:L",
                simulatorSkuId: "sim:sku:L",
              },
              sourceRef: "membership:later",
            },
          ],
        },
      ],
    };

    const result = translateBusinessAction(
      startAutomaticCollectionX15FourDays,
      replay,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;
    expect(
      result.interventions.map((intervention) => intervention.target),
    ).not.toContainEqual({
      kind: "sku",
      simulatorProductId: "sim:product:L",
      simulatorSkuId: "sim:sku:L",
    });
  });

  it("returns MISSING_CONTEXT when required collection membership snapshot is unavailable", () => {
    const missing: TranslationContext = {
      ...context,
      promotionMembershipBindings: [],
    };
    expect(
      translateBusinessAction(collectionPromotionMissingMembershipBinding, missing),
    ).toMatchObject({
      status: "MISSING_CONTEXT",
      code: "MISSING_PROMOTION_MEMBERSHIP",
    });
  });

  it("keeps coupons, bundles and fixed promotional price valid but explicitly unsimulatable", () => {
    for (const action of [
      startCollectionXFall15Coupon,
      startBundleAB999Cad,
      startSkuAFixedPromotionalPrice749,
    ]) {
      expect(translateBusinessAction(action, context)).toMatchObject({
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      });
    }
  });

  it("keeps STOP and MODIFY valid business Actions but unsupported by current simulator lifecycle capability", () => {
    expect(
      translateBusinessAction(stopCollectionXAutomatic15, context),
    ).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "PROMOTION_LIFECYCLE_UNSUPPORTED_BY_SIMULATOR",
    });
    expect(
      translateBusinessAction(modifyCollectionX15To20, context),
    ).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "PROMOTION_LIFECYCLE_UNSUPPORTED_BY_SIMULATOR",
    });
  });

  it("returns explicit unsupported capability when promotion mutation capability is absent", () => {
    const unsupported: TranslationContext = {
      ...context,
      capabilities: [],
    };
    expect(
      translateBusinessAction(startProductA100CadOff, unsupported),
    ).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "SIMULATOR_CAPABILITY_UNAVAILABLE",
    });
  });

  it("gates promotion membership bindings to TranslationContext 1.2", () => {
    const legacy = {
      ...context,
      schemaVersion: "1.1.0",
    };
    const result = validateTranslationContext(legacy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe(
        "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_2",
      );
    }
  });

  it("is deterministic for identical Action and promotion membership context", () => {
    const first = translateBusinessAction(
      startAutomaticCollectionX15FourDays,
      context,
    );
    const second = translateBusinessAction(
      startAutomaticCollectionX15FourDays,
      context,
    );
    expect(first).toEqual(second);
  });
});
