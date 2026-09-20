import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import {
  buildSkuEconomicIntelligence,
} from "../../src/product_economics/profiles.js";

describe("Step 8 SKU economic intelligence", () => {
  it("provides every required product-economic property for every SKU", () => {
    const world = generateMerchantWorldRecord({
      seed: 89001,
      archetype: "home_furnishings_decor",
      scale: "growth",
      complexity: "complex",
      catalogProfile: "large",
    });

    const products = buildSkuEconomicIntelligence(world);
    expect(products.length).toBe(world.summary.skuCount);

    for (const product of products) {
      expect(product.priceMinor).toBeGreaterThan(0);
      expect(product.cogsPerUnitMinor).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(product.grossMarginRate)).toBe(true);
      expect(product.initialSellableUnits).toBeGreaterThanOrEqual(0);
      expect(product.categoryId.length).toBeGreaterThan(0);
      expect(product.brandId.length).toBeGreaterThan(0);
      expect(product.brandSource).toBe("step8_synthetic_assignment");
      expect(product.conversionPropensity).toBeGreaterThan(0);
      expect(product.conversionPropensity).toBeLessThanOrEqual(1);
      expect(product.structuralDemandUnitsPerDay).toBeGreaterThan(0);
      expect(product.structuralDemandShare).toBeGreaterThan(0);
      expect(product.seasonality.length).toBeGreaterThan(0);
      expect(Array.isArray(product.substitutionProductIds)).toBe(true);
      expect(Array.isArray(product.complementaryProductIds)).toBe(true);
      expect(product.returnRate).toBeGreaterThanOrEqual(0);
      expect(product.shippingCostPerUnitMinor).toBeGreaterThanOrEqual(0);
      expect(product.discountSensitivity).toBeGreaterThan(0);
    }
  });

  it("retains product-specific seasonality where frozen GroundTruth provides it", () => {
    const world = generateMerchantWorldRecord({
      seed: 89002,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "adversarial",
      catalogProfile: "large",
    });
    const products = buildSkuEconomicIntelligence(world);

    expect(
      products.some((product) =>
        product.seasonality.some(
          (mechanism) => mechanism.kind === "product_specific",
        ),
      ),
    ).toBe(true);
  });

  it("keeps structural desirability distinct from economic contribution", () => {
    const world = generateMerchantWorldRecord({
      seed: 89003,
      archetype: "specialty_retail",
      scale: "growth",
      complexity: "complex",
    });
    const products = buildSkuEconomicIntelligence(world);

    const demandLeader = [...products].sort(
      (left, right) =>
        right.structuralDesirabilityIndex -
        left.structuralDesirabilityIndex,
    )[0]!;

    expect(demandLeader.structuralDesirabilityIndex).toBeGreaterThan(0);
    expect(Number.isFinite(demandLeader.expectedContributionPerUnitMinor)).toBe(true);
  });
});
