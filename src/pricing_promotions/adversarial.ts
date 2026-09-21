import {
  generateCustomerPopulation,
} from "../customer_population/generator.js";
import {
  nonNegative,
} from "../core/units.js";
import type {
  GeneratedMerchantWorld,
} from "../generation/config.js";
import {
  generateMerchantWorldRecord,
} from "../generation/generator.js";
import {
  validateGroundTruthManifest,
} from "../ground_truth/manifest.js";
import {
  buildProductEconomicProfiles,
} from "../ecommerce_economics/products.js";
import type {
  ProductEconomicProfile,
} from "../ecommerce_economics/types.js";
import {
  PRICING_PROMOTIONS_VERSION,
  type PricingPromotionScenario,
} from "./runtime-types.js";
import type {
  PricingPromotionEvaluationRequest,
} from "./types.js";

function population(
  world: GeneratedMerchantWorld,
  seed: number,
  maxExplicitAgents = 120,
) {
  return generateCustomerPopulation({
    merchantWorld: world,
    populationSeed: seed,
    populationConfig: {
      maxExplicitAgents,
      complexity: world.summary.complexity,
    },
  });
}

function abundantInventory(
  source: GeneratedMerchantWorld,
): GeneratedMerchantWorld {
  const world =
    structuredClone(source) as GeneratedMerchantWorld;
  for (
    const inventory of world.manifest
      .inventoryMechanisms as unknown as Array<{
        initialAvailableUnits: unknown;
        initialReservedUnits: unknown;
        replenishmentUnits: unknown;
        allowBackorders: boolean;
        stockoutBehavior:
          | "lost_demand"
          | "substitute"
          | "backorder";
      }>
  ) {
    inventory.initialAvailableUnits =
      nonNegative(1_000_000);
    inventory.initialReservedUnits = nonNegative(0);
    inventory.replenishmentUnits = nonNegative(0);
    inventory.allowBackorders = false;
    if (inventory.stockoutBehavior === "backorder") {
      inventory.stockoutBehavior = "lost_demand";
    }
  }
  validateGroundTruthManifest(world.manifest);
  return world;
}

function setElasticity(
  world: GeneratedMerchantWorld,
  productId: string,
  elasticity: number,
): void {
  const mechanisms =
    world.manifest.priceElasticities as unknown as Array<{
      kind: "own_price" | "cross_price";
      sourceProductId: string;
      targetProductId: string;
      form: "constant" | "piecewise";
      elasticity?: number;
      points?: unknown;
    }>;
  const own = mechanisms.find(
    (mechanism) =>
      mechanism.kind === "own_price" &&
      mechanism.sourceProductId === productId &&
      mechanism.targetProductId === productId,
  );
  if (!own) {
    throw new RangeError(
      "Step 10 trap requires own-price elasticity for " +
        productId,
    );
  }
  own.form = "constant";
  own.elasticity = elasticity;
  delete own.points;
}

function zeroCrossPrice(
  world: GeneratedMerchantWorld,
): void {
  for (
    const mechanism of world.manifest
      .priceElasticities as unknown as Array<{
        kind: "own_price" | "cross_price";
        form: "constant" | "piecewise";
        elasticity?: number;
        points?: unknown;
      }>
  ) {
    if (mechanism.kind !== "cross_price") continue;
    mechanism.form = "constant";
    mechanism.elasticity = 0;
    delete mechanism.points;
  }
}

function overrideFor(
  profile: ProductEconomicProfile,
  values: Partial<ProductEconomicProfile>,
): Partial<ProductEconomicProfile> {
  return {
    ...values,
    productId: profile.productId,
    categoryId: profile.categoryId,
  };
}

function scenario(
  world: GeneratedMerchantWorld,
  start: string,
  end: string,
  depth: number,
): PricingPromotionScenario {
  return {
    version: PRICING_PROMOTIONS_VERSION,
    currency: world.manifest.marginEconomics.currency,
    priceStates: [],
    promotions:
      depth <= 0
        ? []
        : [
            {
              promotionId: "step10-trap-promotion",
              mechanic: "percentage_discount",
              scope: { kind: "sitewide" },
              start,
              end,
              percentageOff: depth,
              // Price is visible to everyone. Awareness zero deliberately
              // removes the extra promotion-message utility so the trap is
              // driven by price elasticity and unit economics.
              awarenessProbability: 0,
              stacking: "exclusive",
            },
          ],
  };
}

function baseRequest(
  world: GeneratedMerchantWorld,
  populationSeed: number,
  simulationSeed: number,
  scenarioValue: PricingPromotionScenario,
  overrides: Readonly<
    Record<string, Partial<ProductEconomicProfile>>
  >,
): PricingPromotionEvaluationRequest {
  return {
    merchantWorld: world,
    latentPopulation: population(
      world,
      populationSeed,
      130,
    ),
    simulationSeed,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-04-01T00:00:00.000Z",
    scenario: scenarioValue,
    productEconomicsOverrides: overrides,
    simulationConfig: {
      maxEvents: 220_000,
      maxSessionsPerCustomer: 18,
    },
    enableInventoryDynamics: true,
  };
}

export interface MarginDestructionTrapFixture {
  readonly id: "discount_margin_destruction";
  readonly productAId: string;
  readonly productBId: string;
  readonly evaluation: PricingPromotionEvaluationRequest;
}

export function createMarginDestructionTrapFixture(): MarginDestructionTrapFixture {
  const generated = generateMerchantWorldRecord({
    seed: 210001,
    archetype: "specialty_retail",
    scale: "growth",
    complexity: "complex",
    catalogProfile: "tiny_curated",
    promotionProfile: "light_promotion",
  });
  const world = abundantInventory(generated);
  const ranked = [
    ...world.manifest.productDemandMechanisms,
  ].sort(
    (left, right) =>
      Number(right.baseLatentDemandUnits) -
      Number(left.baseLatentDemandUnits),
  );
  const productAId = ranked[0]!.productId;
  const productBId = ranked[1]!.productId;

  setElasticity(world, productAId, -4.2);
  setElasticity(world, productBId, -0.32);
  zeroCrossPrice(world);
  validateGroundTruthManifest(world.manifest);

  const profiles = buildProductEconomicProfiles(world);
  const overrides: Record<
    string,
    Partial<ProductEconomicProfile>
  > = {};
  for (const profile of profiles) {
    if (profile.productId === productAId) {
      overrides[profile.productId] = overrideFor(
        profile,
        {
          cogsPerUnitMinor: Math.round(
            profile.listPriceMinor * 0.24,
          ),
          shippingCostPerUnitMinor: Math.round(
            profile.listPriceMinor * 0.025,
          ),
          fulfillmentCostPerUnitMinor: Math.round(
            profile.listPriceMinor * 0.012,
          ),
          returnProbability: 0.01,
        },
      );
    } else if (profile.productId === productBId) {
      overrides[profile.productId] = overrideFor(
        profile,
        {
          cogsPerUnitMinor: Math.round(
            profile.listPriceMinor * 0.72,
          ),
          shippingCostPerUnitMinor: Math.round(
            profile.listPriceMinor * 0.055,
          ),
          fulfillmentCostPerUnitMinor: Math.round(
            profile.listPriceMinor * 0.025,
          ),
          returnProbability: 0.01,
        },
      );
    }
  }

  const start = "2026-01-01T00:00:00.000Z";
  const end = "2026-04-01T00:00:00.000Z";
  return {
    id: "discount_margin_destruction",
    productAId,
    productBId,
    evaluation: baseRequest(
      world,
      210101,
      210201,
      scenario(world, start, end, 0.1),
      overrides,
    ),
  };
}

export interface RevenueProfitTrapFixture {
  readonly id: "revenue_winner_profit_loser";
  readonly evaluation: PricingPromotionEvaluationRequest;
}

export function createRevenueProfitTrapFixture(): RevenueProfitTrapFixture {
  const generated = generateMerchantWorldRecord({
    seed: 210002,
    archetype: "fashion_apparel",
    scale: "growth",
    complexity: "complex",
    catalogProfile: "tiny_curated",
    promotionProfile: "promotion_sensitive",
  });
  const world = abundantInventory(generated);
  zeroCrossPrice(world);
  for (const demand of world.manifest.productDemandMechanisms) {
    setElasticity(world, demand.productId, -2.2);
  }
  validateGroundTruthManifest(world.manifest);

  const profiles = buildProductEconomicProfiles(world);
  const overrides = Object.fromEntries(
    profiles.map((profile) => [
      profile.productId,
      overrideFor(profile, {
        cogsPerUnitMinor: Math.round(
          profile.listPriceMinor * 0.64,
        ),
        shippingCostPerUnitMinor: Math.round(
          profile.listPriceMinor * 0.035,
        ),
        fulfillmentCostPerUnitMinor: Math.round(
          profile.listPriceMinor * 0.018,
        ),
        returnProbability: 0.015,
      }),
    ]),
  );

  const start = "2026-01-01T00:00:00.000Z";
  const end = "2026-04-01T00:00:00.000Z";
  return {
    id: "revenue_winner_profit_loser",
    evaluation: baseRequest(
      world,
      210102,
      210202,
      scenario(world, start, end, 0),
      overrides,
    ),
  };
}

export interface PullForwardTrapFixture {
  readonly id: "promotion_pull_forward";
  readonly promotionEnd: string;
  readonly evaluation: PricingPromotionEvaluationRequest;
}

export function createPullForwardTrapFixture(): PullForwardTrapFixture {
  const generated = generateMerchantWorldRecord({
    seed: 210003,
    archetype: "replenishment_heavy",
    scale: "growth",
    complexity: "complex",
    purchaseFrequency: "replenishment",
    promotionProfile: "promotion_sensitive",
  });
  const world = abundantInventory(generated);
  for (const demand of world.manifest.productDemandMechanisms) {
    setElasticity(world, demand.productId, -2.0);
  }
  zeroCrossPrice(world);
  validateGroundTruthManifest(world.manifest);

  const start = "2026-01-01T00:00:00.000Z";
  const promotionEnd =
    "2026-01-22T00:00:00.000Z";
  const end = "2026-04-15T00:00:00.000Z";
  const baseScenario = scenario(
    world,
    start,
    promotionEnd,
    0.18,
  );
  const value: PricingPromotionScenario = {
    ...baseScenario,
    promotions: baseScenario.promotions.map(
      (promotion) => ({
        ...promotion,
        awarenessProbability: 1,
        stockpilingEligible: true,
      }),
    ),
  };

  return {
    id: "promotion_pull_forward",
    promotionEnd,
    evaluation: {
      ...baseRequest(
        world,
        210103,
        210203,
        value,
        {},
      ),
      periodEnd: end,
    },
  };
}
