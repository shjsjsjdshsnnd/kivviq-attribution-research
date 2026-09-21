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
  translateBusinessAction,
} from "../../src/action_translation/translate.js";
import {
  increaseProductX5Percent,
  reduceCategoryX10Percent,
  reduceCollectionX15Percent,
  reduceSkuA10Percent,
  rollbackTemporarySkuAToPreActionPrice,
  setSkuA849Cad,
  setSkuA949EffectiveOctober1,
  temporarySkuA799SevenDays,
} from "../../src/pricing/fixtures.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-20T13:00:00Z");

const baseContext: TranslationContext = {
  schemaVersion: TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock: DECISION,
  capabilities: ["product_price"],
  entityMappings: [
    {
      actionTarget: {
        kind: "sku",
        productId: "product:A",
        skuId: "sku:A",
      },
      simulatorTarget: {
        kind: "sku",
        simulatorProductId: "sim:product:A",
        simulatorSkuId: "sim:sku:A",
      },
      sourceRef: "mapping:sku-a",
    },
  ],
  referenceBindings: [
    {
      actionId: reduceSkuA10Percent.actionId,
      reference: {
        kind: "current_at_decision",
        decisionTime: DECISION,
      },
      value: {
        kind: "money",
        amountMinor: 89_900,
        currency: CAD,
      },
      sourceRef: "observed:sku-a-price:decision",
    },
  ],
  pricingMembershipBindings: [
    {
      actionTarget: { kind: "product", productId: "product:X" },
      evaluateAt: "decision_time",
      bindingRef: "membership:product-x:2026-09-20T13:00:00Z",
      snapshotTime: DECISION,
      sourceRef: "catalog-snapshot:product-x:decision",
      members: [
        {
          skuTarget: {
            kind: "sku",
            productId: "product:X",
            skuId: "sku:X-1",
          },
          simulatorTarget: {
            kind: "sku",
            simulatorProductId: "sim:product:X",
            simulatorSkuId: "sim:sku:X-1",
          },
          priceAtBoundary: {
            kind: "money",
            amountMinor: 100_000,
            currency: CAD,
          },
          priceSourceRef: "price:sku:X-1:decision",
        },
        {
          skuTarget: {
            kind: "sku",
            productId: "product:X",
            skuId: "sku:X-2",
          },
          simulatorTarget: {
            kind: "sku",
            simulatorProductId: "sim:product:X",
            simulatorSkuId: "sim:sku:X-2",
          },
          priceAtBoundary: {
            kind: "money",
            amountMinor: 150_000,
            currency: CAD,
          },
          priceSourceRef: "price:sku:X-2:decision",
        },
      ],
    },
    {
      actionTarget: { kind: "category", categoryId: "category:X" },
      evaluateAt: "decision_time",
      bindingRef: "membership:category-x:2026-09-20T13:00:00Z",
      snapshotTime: DECISION,
      sourceRef: "catalog-snapshot:category-x:decision",
      members: [
        {
          skuTarget: {
            kind: "sku",
            productId: "product:C1",
            skuId: "sku:C1",
          },
          simulatorTarget: {
            kind: "sku",
            simulatorProductId: "sim:product:C1",
            simulatorSkuId: "sim:sku:C1",
          },
          priceAtBoundary: {
            kind: "money",
            amountMinor: 80_000,
            currency: CAD,
          },
          priceSourceRef: "price:sku:C1:decision",
        },
      ],
    },
    {
      actionTarget: { kind: "collection", collectionId: "collection:X" },
      evaluateAt: "decision_time",
      bindingRef: "membership:collection-x:2026-09-20T13:00:00Z",
      snapshotTime: DECISION,
      sourceRef: "catalog-snapshot:collection-x:decision",
      members: [
        {
          skuTarget: {
            kind: "sku",
            productId: "product:K1",
            skuId: "sku:K1",
          },
          simulatorTarget: {
            kind: "sku",
            simulatorProductId: "sim:product:K1",
            simulatorSkuId: "sim:sku:K1",
          },
          priceAtBoundary: {
            kind: "money",
            amountMinor: 60_000,
            currency: CAD,
          },
          priceSourceRef: "price:sku:K1:decision",
        },
      ],
    },
  ],
};

describe("Step 4 pricing translation", () => {
  it("translates SKU SET price one-to-one", () => {
    const result = translateBusinessAction(setSkuA849Cad, baseContext);
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]).toMatchObject({
      interventionType: "price",
      target: {
        kind: "sku",
        simulatorSkuId: "sim:sku:A",
      },
      operation: {
        kind: "SET",
        value: {
          kind: "money",
          amountMinor: 84_900,
          currency: "CAD",
        },
      },
    });
  });

  it("preserves SKU MULTIPLY semantics with a decision-time baseline", () => {
    const result = translateBusinessAction(
      reduceSkuA10Percent,
      baseContext,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions[0]!.operation).toMatchObject({
      kind: "MULTIPLY",
      factor: 0.9,
      baseline: {
        value: {
          kind: "money",
          amountMinor: 89_900,
          currency: "CAD",
        },
        sourceRef: "observed:sku-a-price:decision",
      },
    });
  });

  it("returns MISSING_CONTEXT instead of guessing a missing SKU baseline", () => {
    const missing: TranslationContext = {
      ...baseContext,
      referenceBindings: [],
    };
    expect(
      translateBusinessAction(reduceSkuA10Percent, missing),
    ).toMatchObject({
      status: "MISSING_CONTEXT",
      code: "MISSING_REFERENCE_BASELINE",
    });
  });

  it("expands one product-level Action into SKU interventions while preserving relative semantics", () => {
    const result = translateBusinessAction(
      increaseProductX5Percent,
      baseContext,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(2);
    expect(
      result.interventions.map((intervention) => intervention.operation.kind),
    ).toEqual(["MULTIPLY", "MULTIPLY"]);
    expect(
      result.interventions.map((intervention) =>
        intervention.operation.kind === "MULTIPLY"
          ? intervention.operation.baseline.value
          : null,
      ),
    ).toEqual([
      { kind: "money", amountMinor: 100_000, currency: CAD },
      { kind: "money", amountMinor: 150_000, currency: CAD },
    ]);
    for (const intervention of result.interventions) {
      expect(intervention.provenance).toMatchObject({
        originatingBusinessActionId: increaseProductX5Percent.actionId,
        membershipSourceRef: "catalog-snapshot:product-x:decision",
        membershipBindingRef:
          "membership:product-x:2026-09-20T13:00:00Z",
        membershipBoundary: "decision_time",
        membershipSnapshotTime: DECISION,
      });
    }
  });

  it("expands category and collection Actions only with deterministic membership bindings", () => {
    const category = translateBusinessAction(
      reduceCategoryX10Percent,
      baseContext,
    );
    const collection = translateBusinessAction(
      reduceCollectionX15Percent,
      baseContext,
    );

    expect(category.status).toBe("TRANSLATED");
    expect(collection.status).toBe("TRANSLATED");

    const missing: TranslationContext = {
      ...baseContext,
      pricingMembershipBindings:
        baseContext.pricingMembershipBindings?.filter(
          (binding) => binding.actionTarget.kind !== "category",
        ),
    };
    expect(
      translateBusinessAction(reduceCategoryX10Percent, missing),
    ).toMatchObject({
      status: "MISSING_CONTEXT",
      code: "MISSING_PRICING_MEMBERSHIP",
    });
  });

  it("uses the exact membership bindingRef for deterministic replay", () => {
    const replayContext: TranslationContext = {
      ...baseContext,
      pricingMembershipBindings: [
        ...(baseContext.pricingMembershipBindings ?? []),
        {
          actionTarget: { kind: "product", productId: "product:X" },
          evaluateAt: "decision_time",
          bindingRef: "membership:product-x:later",
          snapshotTime: DECISION,
          sourceRef: "catalog-snapshot:product-x:later",
          members: [
            {
              skuTarget: {
                kind: "sku",
                productId: "product:X",
                skuId: "sku:X-LATER",
              },
              simulatorTarget: {
                kind: "sku",
                simulatorProductId: "sim:product:X",
                simulatorSkuId: "sim:sku:X-LATER",
              },
              priceAtBoundary: {
                kind: "money",
                amountMinor: 999_999,
                currency: CAD,
              },
              priceSourceRef: "price:later",
            },
          ],
        },
      ],
    };

    const result = translateBusinessAction(
      increaseProductX5Percent,
      replayContext,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(
      result.interventions.map((intervention) => intervention.target),
    ).not.toContainEqual({
      kind: "sku",
      simulatorProductId: "sim:product:X",
      simulatorSkuId: "sim:sku:X-LATER",
    });
  });

  it("returns explicit unsupported simulator capability for expanded pricing when price mutation is unavailable", () => {
    const unsupported: TranslationContext = {
      ...baseContext,
      capabilities: [],
    };
    expect(
      translateBusinessAction(reduceCollectionX15Percent, unsupported),
    ).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "SIMULATOR_CAPABILITY_UNAVAILABLE",
    });
  });

  it("preserves future effective time and temporary duration", () => {
    const future = translateBusinessAction(
      setSkuA949EffectiveOctober1,
      baseContext,
    );
    expect(future.status).toBe("TRANSLATED");
    if (future.status === "TRANSLATED") {
      expect(future.interventions[0]!.effectiveTime).toBe(
        "2026-10-01T04:00:00Z",
      );
    }

    const temporary = translateBusinessAction(
      temporarySkuA799SevenDays,
      baseContext,
    );
    expect(temporary.status).toBe("TRANSLATED");
    if (temporary.status === "TRANSLATED") {
      expect(temporary.interventions[0]!.duration).toEqual({
        kind: "temporary",
        durationSeconds: 7 * 24 * 60 * 60,
      });
      expect(temporary.interventions[0]!.endCondition).toEqual({
        kind: "fixed_duration",
        durationSeconds: 7 * 24 * 60 * 60,
      });
    }
  });

  it("keeps rollback execution outside normal simulator translation", () => {
    expect(
      translateBusinessAction(
        rollbackTemporarySkuAToPreActionPrice,
        baseContext,
      ),
    ).toMatchObject({
      status: "UNSUPPORTED_ACTION_TYPE",
      code: "NO_REGISTERED_TRANSLATOR",
    });
  });

  it("is deterministic for identical pricing Action and membership context", () => {
    const first = translateBusinessAction(
      increaseProductX5Percent,
      baseContext,
    );
    const second = translateBusinessAction(
      increaseProductX5Percent,
      baseContext,
    );
    expect(first).toEqual(second);
  });
});
