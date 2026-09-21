import { describe, expect, it } from "vitest";
import {
  generateMerchantWorldRecord,
} from "../../src/generation/generator.js";
import {
  createMarginDestructionTrapFixture,
} from "../../src/pricing_promotions/adversarial.js";
import {
  hydratePricingPromotionScenario,
} from "../../src/pricing_promotions/evaluator.js";
import {
  crossPriceDemandMultiplier,
  priceResponseTruth,
} from "../../src/pricing_promotions/response.js";
import type {
  PricingPromotionScenario,
} from "../../src/pricing_promotions/runtime-types.js";

describe("Step 10 price response semantics", () => {
  it("uses nonlinear constant-elasticity demand for both discounts and price increases", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario =
      hydratePricingPromotionScenario(
        fixture.evaluation,
      );
    const customer =
      fixture.evaluation.latentPopulation.customers[0]!;
    const state = scenario.priceStates.find(
      (candidate) =>
        candidate.productId === fixture.productAId,
    )!;
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );

    const tenOff = priceResponseTruth(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      fixture.productAId,
      state.regularPriceMinor,
      Math.round(state.regularPriceMinor * 0.9),
      timestamp,
    );
    const twentyOff = priceResponseTruth(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      fixture.productAId,
      state.regularPriceMinor,
      Math.round(state.regularPriceMinor * 0.8),
      timestamp,
    );
    const tenUp = priceResponseTruth(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      fixture.productAId,
      state.regularPriceMinor,
      Math.round(state.regularPriceMinor * 1.1),
      timestamp,
    );

    expect(
      tenOff.combinedDemandMultiplier,
    ).toBeGreaterThan(1);
    expect(
      twentyOff.combinedDemandMultiplier,
    ).toBeGreaterThan(
      tenOff.combinedDemandMultiplier,
    );
    expect(
      tenUp.combinedDemandMultiplier,
    ).toBeLessThan(1);

    const tenLift =
      tenOff.combinedDemandMultiplier - 1;
    const twentyLift =
      twentyOff.combinedDemandMultiplier - 1;
    expect(
      Math.abs(twentyLift - tenLift * 2),
    ).toBeGreaterThan(0.01);
  });

  it("gives different customers different responses to the same price", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario =
      hydratePricingPromotionScenario(
        fixture.evaluation,
      );
    const state = scenario.priceStates.find(
      (candidate) =>
        candidate.productId === fixture.productAId,
    )!;
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );
    const customerA =
      fixture.evaluation.latentPopulation.customers[0]!;
    const customerB =
      fixture.evaluation.latentPopulation.customers[1]!;

    const responseA = priceResponseTruth(
      fixture.evaluation.merchantWorld,
      scenario,
      customerA,
      fixture.productAId,
      state.regularPriceMinor,
      Math.round(state.regularPriceMinor * 0.9),
      timestamp,
    );
    const responseB = priceResponseTruth(
      fixture.evaluation.merchantWorld,
      scenario,
      customerB,
      fixture.productAId,
      state.regularPriceMinor,
      Math.round(state.regularPriceMinor * 0.9),
      timestamp,
    );

    expect(
      responseA.customerElasticityMultiplier,
    ).not.toBe(
      responseB.customerElasticityMultiplier,
    );
    expect(
      responseA.combinedDemandMultiplier,
    ).not.toBe(
      responseB.combinedDemandMultiplier,
    );
  });

  it("applies sparse declared cross-price effects only to linked targets", () => {
    const world = generateMerchantWorldRecord({
      seed: 211001,
      archetype: "specialty_retail",
      scale: "growth",
      complexity: "complex",
      catalogProfile: "moderate",
    });
    const cross = world.manifest.priceElasticities.find(
      (mechanism) =>
        mechanism.kind === "cross_price",
    );
    expect(cross).toBeDefined();
    if (!cross) return;

    const baselinePrice = 10_000;
    const sourceState = {
      productId: cross.sourceProductId,
      regularPriceMinor: baselinePrice,
      currentSellingPriceMinor: 11_000,
      discountAmountMinor: 0,
      discountPercentage: 0,
      effectivePriceMinor: 11_000,
      currency: "CAD" as const,
    };
    const scenario: PricingPromotionScenario = {
      version: "pricing-promotions-10.0.0",
      currency: "CAD",
      priceStates: [sourceState],
      promotions: [],
    };

    const multiplier = crossPriceDemandMultiplier(
      world,
      scenario,
      cross.targetProductId,
      Date.parse("2026-01-15T00:00:00.000Z"),
    );

    expect(Number.isFinite(multiplier)).toBe(true);
    expect(multiplier).toBeGreaterThan(0);
    if (
      cross.form === "constant" &&
      (cross.elasticity ?? 0) !== 0
    ) {
      expect(multiplier).not.toBe(1);
    }
  });
});
