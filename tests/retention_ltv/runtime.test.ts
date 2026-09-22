import {
  describe,
  expect,
  it,
} from "vitest";
import {
  generateCustomerPopulation,
} from "../../src/customer_population/generator.js";
import {
  generateMerchantWorldRecord,
} from "../../src/generation/generator.js";
import {
  defaultRetentionLtvScenario,
  productRetentionChoiceMultiplier,
  repeatPurchaseHazardMultiplier,
  validateRetentionLtvScenario,
  type RetentionCustomerContext,
} from "../../src/retention_ltv/runtime.js";

function context(
  world: ReturnType<
    typeof generateMerchantWorldRecord
  >,
): RetentionCustomerContext {
  const population =
    generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 311101,
      populationConfig: {
        maxExplicitAgents: 40,
        complexity: "complex",
      },
    });
  const source = population.customers[0]!;
  return {
    source,
    purchaseCount: 1,
    lifecycle: "active_customer",
    brandAffinity: source.brandAffinity,
    need: source.currentPurchaseNeed,
    repeatHazardQualityMultiplier: 1,
    promotionDependenceShift: 0,
    trueChurnState: "active",
    ownedProductQuantities: new Map(),
    categoryFamiliarity: new Map(),
  };
}

describe("Step 11 retention runtime", () => {
  it("uses customer and treatment state in repeat hazard rather than one merchant-wide repeat percentage", () => {
    const world =
      generateMerchantWorldRecord({
        seed: 311001,
        archetype: "beauty_cosmetics",
        scale: "growth",
        complexity: "complex",
        purchaseFrequency: "repeat",
        customerEconomics:
          "retention_driven",
      });
    const scenario =
      defaultRetentionLtvScenario(world);
    const base = context(world);

    const weak =
      repeatPurchaseHazardMultiplier(
        world,
        scenario,
        {
          ...base,
          brandAffinity: 0.2,
          repeatHazardQualityMultiplier:
            0.45,
          lifecycle: "lapsing",
        },
      );
    const strong =
      repeatPurchaseHazardMultiplier(
        world,
        scenario,
        {
          ...base,
          brandAffinity: 0.9,
          repeatHazardQualityMultiplier:
            2.1,
          lifecycle: "loyal_customer",
        },
      );

    expect(strong).toBeGreaterThan(weak);
    expect(strong).not.toBe(1);
  });

  it("suppresses same-product repeat for durable goods while allowing ownership to create complement demand", () => {
    const world =
      generateMerchantWorldRecord({
        seed: 311002,
        archetype: "furniture",
        scale: "growth",
        complexity: "complex",
        purchaseFrequency: "one_off",
        catalogProfile: "tiny_curated",
      });
    const owned =
      world.manifest.productDemandMechanisms.find(
        (mechanism) =>
          (mechanism
            .complementaryProductIds
            ?.length ?? 0) > 0,
      );
    expect(owned).toBeDefined();
    const complement =
      owned!.complementaryProductIds![0]!;
    const base = context(world);
    const withOwnership = {
      ...base,
      purchaseCount: 1,
      ownedProductQuantities: new Map([
        [owned!.productId, 1],
      ]),
      categoryFamiliarity: new Map([
        [owned!.categoryId, 1],
      ]),
    };

    const sameProduct =
      productRetentionChoiceMultiplier(
        world,
        withOwnership,
        owned!.productId,
      );
    const complementary =
      productRetentionChoiceMultiplier(
        world,
        withOwnership,
        complement,
      );

    expect(sameProduct).toBeLessThan(1);
    expect(complementary).toBeGreaterThan(
      sameProduct,
    );
  });

  it("keeps permanent churn optional outside explicitly configured models", () => {
    const world =
      generateMerchantWorldRecord({
        seed: 311003,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "normal",
        purchaseFrequency: "repeat",
      });
    const scenario =
      defaultRetentionLtvScenario(world);

    expect(
      scenario
        .permanentChurnAfterExpectedIntervals,
    ).toBeNull();
    expect(() =>
      validateRetentionLtvScenario(
        scenario,
      ),
    ).not.toThrow();
  });
});
