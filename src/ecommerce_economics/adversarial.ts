import { generateCustomerPopulation } from "../customer_population/generator.js";
import { moneyMinor, positive } from "../core/units.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import { baselineProductPriceMinor } from "../simulation/commerce.js";
import {
  createVanityRoasTrapFixture,
} from "../advertising_economics/adversarial.js";
import type {
  EcommerceEvaluationRequest,
  ProductEconomicProfile,
} from "./types.js";
import {
  buildProductEconomicProfiles,
} from "./products.js";

export interface EcommerceAdversarialFixture {
  readonly id:
    | "discount_trap"
    | "revenue_vs_profit"
    | "best_seller_trap"
    | "high_aov_trap"
    | "low_inventory_advertising_trap"
    | "cac_vs_customer_value"
    | "short_vs_long_value"
    | "price_increase_profit"
    | "price_increase_collapse";
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly evaluation: EcommerceEvaluationRequest;
}

function population(
  world: GeneratedMerchantWorld,
  seed: number,
  maxExplicitAgents = 140,
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

function baseRequest(
  world: GeneratedMerchantWorld,
  populationSeed: number,
  simulationSeed: number,
  overrides: Partial<EcommerceEvaluationRequest> = {},
): EcommerceEvaluationRequest {
  return {
    merchantWorld: world,
    latentPopulation: population(world, populationSeed),
    simulationSeed,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-05-01T00:00:00.000Z",
    simulationConfig: {
      maxEvents: 220_000,
      maxSessionsPerCustomer: 20,
    },
    ...overrides,
  };
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

export function createDiscountTrapFixture(): EcommerceAdversarialFixture {
  const original = generateMerchantWorldRecord({
    seed: 120001,
    archetype: "fashion_apparel",
    scale: "growth",
    complexity: "complex",
    promotionProfile: "promotion_heavy",
    overrides: {
      forceZeroIncrementalityChannels: ["meta"],
    },
  });
  const world = structuredClone(original) as GeneratedMerchantWorld;

  const metaMechanism =
    (world.manifest.channelIncrementality as unknown as Array<{
      channelId: string;
      effect: { value: number };
      responseCurveId?: string;
    }>).find((item) => item.channelId === "meta");
  if (!metaMechanism?.responseCurveId) {
    throw new RangeError("discount trap requires Meta response curve");
  }
  const monthlyOrders =
    world.summary.expectedAnnualOrders / 12;
  metaMechanism.effect.value = monthlyOrders * 0.45;
  const metaCurveIndex =
    (world.manifest.responseCurves as unknown as Array<{
      id: string;
    }>).findIndex(
      (curve) => curve.id === metaMechanism.responseCurveId,
    );
  (world.manifest.responseCurves as unknown as Array<Record<string, unknown>>)[
    metaCurveIndex
  ] = {
    id: metaMechanism.responseCurveId,
    kind: "hill",
    inputUnit: "money_minor",
    outputUnit: "orders",
    maxIncrementalOutcome: positive(
      Math.max(1, monthlyOrders * 1.1),
    ),
    halfSaturationSpend: moneyMinor(90_000),
    hillCoefficient: positive(1.05),
  };
  const promotionVariable = "promotion.discount_active";
  if (
    !world.manifest.causalGraph.nodes.some(
      (node) => node.id === promotionVariable,
    )
  ) {
    (world.manifest.causalGraph.nodes as unknown as Array<Record<string, unknown>>).push({
      id: promotionVariable,
      domain: "marketing",
      temporalScope: "time_indexed",
      valueType: "boolean",
      unit: "boolean",
      intervenable: false,
      visibility: "latent",
    });
  }

  const promotionMetaInteractionId =
    "step7_meta_promotion_channel_response";
  (world.manifest.channelInteractions as unknown as Array<Record<string, unknown>>).push({
    id: promotionMetaInteractionId,
    channelIds: ["meta"],
    kind: "synergy",
    functionalForm: "multiplicative",
    effect: {
      scale: "relative",
      value: 8,
      unit: "dimensionless",
    },
  });
  (world.manifest.causalGraph.edges as unknown as Array<Record<string, unknown>>).push({
    parent: promotionVariable,
    child: "customer.brand_awareness",
    relationship: "interaction",
    mechanismId: promotionMetaInteractionId,
  });

  validateGroundTruthManifest(world.manifest);
  (world.summary as { expectedDiscountRate: number }).expectedDiscountRate =
    0.17;

  const profiles = buildProductEconomicProfiles(world);
  const productEconomicsOverrides = Object.fromEntries(
    profiles.map((profile) => [
      profile.productId,
      overrideFor(profile, {
        cogsPerUnitMinor: Math.round(
          profile.listPriceMinor * 0.58,
        ),
        grossMarginRate: 0.42,
        returnProbability: Math.max(
          0.08,
          profile.returnProbability,
        ),
      }),
    ]),
  );

  return {
    id: "discount_trap",
    merchantWorld: world,
    evaluation: baseRequest(
      world,
      130001,
      140001,
      {
        productEconomicsOverrides,
        interventions: [
          {
            variable: "promotion.discount_active",
            operation: "set",
            value: {
              kind: "boolean",
              value: true,
            },
          },
        ],
      },
    ),
  };
}

export function createRevenueVsProfitFixture(): EcommerceAdversarialFixture {
  const discount = createDiscountTrapFixture();
  return {
    ...discount,
    id: "revenue_vs_profit",
  };
}

function productTrapWorld(
  seed: number,
): {
  readonly world: GeneratedMerchantWorld;
  readonly overrides: Readonly<
    Record<string, Partial<ProductEconomicProfile>>
  >;
} {
  const world = generateMerchantWorldRecord({
    seed,
    archetype: "specialty_retail",
    scale: "growth",
    complexity: "complex",
    catalogProfile: "large",
  });
  const profiles = buildProductEconomicProfiles(world);
  const ranked = [...world.manifest.productDemandMechanisms].sort(
    (left, right) =>
      Number(right.baseLatentDemandUnits) -
      Number(left.baseLatentDemandUnits),
  );
  const a = profiles.find(
    (profile) => profile.productId === ranked[0]!.productId,
  )!;
  const b = profiles.find(
    (profile) => profile.productId === ranked[Math.min(1, ranked.length - 1)]!.productId,
  )!;

  const aPrice = Math.max(
    15_000,
    baselineProductPriceMinor(world, a.productId),
  );
  const bPrice = Math.max(
    6_000,
    Math.round(
      baselineProductPriceMinor(world, b.productId) * 0.8,
    ),
  );

  const overrides: Record<
    string,
    Partial<ProductEconomicProfile>
  > = {
    [a.productId]: overrideFor(a, {
      listPriceMinor: aPrice,
      cogsPerUnitMinor: Math.round(aPrice * 0.96),
      shippingCostPerUnitMinor: Math.round(aPrice * 0.2),
      fulfillmentCostPerUnitMinor: Math.round(aPrice * 0.08),
      returnProbability: 0.38,
      returnShippingCostMinor: Math.round(aPrice * 0.08),
      returnHandlingCostMinor: Math.round(aPrice * 0.035),
      restockingCostMinor: Math.round(aPrice * 0.025),
      nonRecoverableValueRate: 0.35,
    }),
    [b.productId]: overrideFor(b, {
      listPriceMinor: bPrice,
      cogsPerUnitMinor: Math.round(bPrice * 0.1),
      shippingCostPerUnitMinor: Math.round(bPrice * 0.005),
      fulfillmentCostPerUnitMinor: Math.round(bPrice * 0.01),
      returnProbability: 0.005,
      returnShippingCostMinor: 50,
      returnHandlingCostMinor: 30,
      restockingCostMinor: 20,
      nonRecoverableValueRate: 0.01,
    }),
  };

  return { world, overrides };
}

export function createBestSellerTrapFixture(): EcommerceAdversarialFixture {
  const { world, overrides } = productTrapWorld(120002);
  return {
    id: "best_seller_trap",
    merchantWorld: world,
    evaluation: baseRequest(
      world,
      130002,
      140002,
      { productEconomicsOverrides: overrides },
    ),
  };
}

export function createHighAovTrapFixture(): EcommerceAdversarialFixture {
  const world = generateMerchantWorldRecord({
    seed: 120003,
    archetype: "home_furnishings_decor",
    scale: "growth",
    complexity: "complex",
    catalogProfile: "large",
  });
  const profiles = buildProductEconomicProfiles(world);
  const byPrice = [...profiles].sort(
    (left, right) =>
      right.listPriceMinor - left.listPriceMinor,
  );
  const high = byPrice[0]!;
  const lower = byPrice[Math.min(8, byPrice.length - 1)]!;

  const overrides: Readonly<
    Record<string, Partial<ProductEconomicProfile>>
  > = {
    [high.productId]: overrideFor(high, {
      listPriceMinor: Math.max(high.listPriceMinor, 120_000),
      cogsPerUnitMinor: Math.round(
        Math.max(high.listPriceMinor, 120_000) * 0.84,
      ),
      grossMarginRate: 0.16,
      shippingCostPerUnitMinor: 18_000,
      fulfillmentCostPerUnitMinor: 7_500,
      returnProbability: 0.2,
      returnShippingCostMinor: 12_000,
      returnHandlingCostMinor: 3_500,
    }),
    [lower.productId]: overrideFor(lower, {
      listPriceMinor: Math.min(lower.listPriceMinor, 35_000),
      cogsPerUnitMinor: Math.round(
        Math.min(lower.listPriceMinor, 35_000) * 0.28,
      ),
      grossMarginRate: 0.72,
      shippingCostPerUnitMinor: 1_200,
      fulfillmentCostPerUnitMinor: 800,
      returnProbability: 0.025,
      returnShippingCostMinor: 500,
      returnHandlingCostMinor: 200,
    }),
  };

  return {
    id: "high_aov_trap",
    merchantWorld: world,
    evaluation: baseRequest(
      world,
      130003,
      140003,
      { productEconomicsOverrides: overrides },
    ),
  };
}

export function createLowInventoryAdvertisingTrapFixture(): EcommerceAdversarialFixture {
  const step5 = createVanityRoasTrapFixture();
  return {
    id: "low_inventory_advertising_trap",
    merchantWorld: step5.merchantWorld,
    evaluation: {
      merchantWorld: step5.merchantWorld,
      latentPopulation: step5.latentPopulation,
      simulationSeed: step5.evaluation.simulationSeed,
      periodStart: step5.evaluation.periodStart,
      periodEnd: step5.evaluation.periodEnd,
      ...(step5.evaluation.simulationConfig === undefined
        ? {}
        : { simulationConfig: step5.evaluation.simulationConfig }),
      interventions: [
        {
          variable: "inventory.available",
          operation: "set",
          value: {
            kind: "number",
            value: 1,
            unit: "units",
          },
        },
        ...Object.entries(
          step5.evaluation.spendMinorByChannel ?? {},
        ).map(([channel, spend]) => ({
          variable: `marketing.${channel}.spend`,
          operation: "set" as const,
          value: {
            kind: "number" as const,
            value: spend ?? 0,
            unit: "money_minor" as const,
          },
        })),
      ],
    },
  };
}

export function createCacVsCustomerValueFixture(): EcommerceAdversarialFixture {
  const world = generateMerchantWorldRecord({
    seed: 120004,
    archetype: "beauty_cosmetics",
    scale: "growth",
    complexity: "adversarial",
    marketingDependence: "balanced",
    purchaseFrequency: "repeat",
  });
  return {
    id: "cac_vs_customer_value",
    merchantWorld: world,
    evaluation: baseRequest(
      world,
      130004,
      140004,
    ),
  };
}

export function createShortVsLongValueFixture(): EcommerceAdversarialFixture {
  const fixture = createCacVsCustomerValueFixture();
  return {
    ...fixture,
    id: "short_vs_long_value",
  };
}


function withUniformPriceElasticity(
  source: GeneratedMerchantWorld,
  elasticity: number,
): GeneratedMerchantWorld {
  const world = structuredClone(source) as GeneratedMerchantWorld;
  for (const mechanism of world.manifest.priceElasticities as unknown as Array<{
    kind: "own_price" | "cross_price";
    form: "constant" | "piecewise";
    elasticity?: number;
  }>) {
    if (mechanism.kind === "own_price") {
      mechanism.form = "constant";
      mechanism.elasticity = elasticity;
    }
  }
  validateGroundTruthManifest(world.manifest);
  return world;
}

export function createPriceIncreaseProfitFixture(): EcommerceAdversarialFixture {
  const base = generateMerchantWorldRecord({
    seed: 120005,
    archetype: "luxury",
    scale: "growth",
    complexity: "normal",
    catalogProfile: "tiny_curated",
  });
  const world = withUniformPriceElasticity(base, -0.22);

  return {
    id: "price_increase_profit",
    merchantWorld: world,
    evaluation: baseRequest(
      world,
      130005,
      140005,
    ),
  };
}

export function createPriceIncreaseCollapseFixture(): EcommerceAdversarialFixture {
  const base = generateMerchantWorldRecord({
    seed: 120006,
    archetype: "commodity_value_retail",
    scale: "growth",
    complexity: "normal",
    catalogProfile: "tiny_curated",
  });
  const world = withUniformPriceElasticity(base, -3.2);

  return {
    id: "price_increase_collapse",
    merchantWorld: world,
    evaluation: baseRequest(
      world,
      130006,
      140006,
    ),
  };
}
