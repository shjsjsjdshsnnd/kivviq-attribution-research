import {
  parseGroundTruthManifest,
  type GroundTruthManifest,
} from "../ground_truth/manifest.js";
import { generateCatalog, type GeneratedCatalog } from "./catalog.js";
import { generateChannelMechanisms } from "./channels.js";
import {
  GENERATOR_VERSION,
  type AppliedOverride,
  type GeneratedMerchantWorld,
  type MerchantGenerationConfig,
  type MerchantGenerationProvenance,
  type MerchantResearchSummary,
} from "./config.js";
import {
  generateLatentBusinessProfile,
  type LatentBusinessProfile,
} from "./profile.js";
import { configSeed, SeededRandom } from "./rng.js";
import { generateSeasonality } from "./seasonality.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function normalizeWeights(values: readonly number[]): readonly number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function appliedOverrides(config: MerchantGenerationConfig): readonly AppliedOverride[] {
  const overrides = config.overrides;
  if (!overrides) return [];

  const entries: AppliedOverride[] = [];
  if (overrides.forceZeroIncrementalityChannels) {
    entries.push({
      field: "forceZeroIncrementalityChannels",
      value: [...overrides.forceZeroIncrementalityChannels],
    });
  }
  if (overrides.mobileTrafficShare !== undefined) {
    entries.push({
      field: "mobileTrafficShare",
      value: overrides.mobileTrafficShare,
    });
  }
  if (overrides.seasonalityProfile !== undefined) {
    entries.push({
      field: "seasonalityProfile",
      value: overrides.seasonalityProfile,
    });
  }
  if (overrides.aovProfile !== undefined) {
    entries.push({
      field: "aovProfile",
      value: overrides.aovProfile,
    });
  }
  if (overrides.promotionProfile !== undefined) {
    entries.push({
      field: "promotionProfile",
      value: overrides.promotionProfile,
    });
  }
  if (overrides.marketingDependence !== undefined) {
    entries.push({
      field: "marketingDependence",
      value: overrides.marketingDependence,
    });
  }
  if (overrides.catalogProfile !== undefined) {
    entries.push({
      field: "catalogProfile",
      value: overrides.catalogProfile,
    });
  }
  return entries;
}

function customerSegmentShares(
  profile: LatentBusinessProfile,
): readonly Record<string, unknown>[] {
  let returning = clamp(profile.repeatProbability * 0.55, 0.08, 0.5);
  let highIntent = clamp(
    profile.baselineConversionRate * 4 + profile.brandStrength * 0.12,
    0.08,
    0.3,
  );
  if (returning + highIntent > 0.75) {
    const scale = 0.75 / (returning + highIntent);
    returning *= scale;
    highIntent *= scale;
  }
  const prospect = 1 - returning - highIntent;

  return [
    { segmentId: "prospect", probability: prospect },
    { segmentId: "high_intent", probability: highIntent },
    { segmentId: "returning", probability: returning },
  ];
}

function baselineDemand(
  profile: LatentBusinessProfile,
): readonly Record<string, unknown>[] {
  const dailyBaselineOrders =
    (profile.expectedAnnualOrders * profile.organicDemandShare) / 365;
  const componentWeights = normalizeWeights([
    0.18 + profile.brandStrength * 0.75,
    0.22 + (1 - profile.brandStrength) * 0.35,
    0.12 + profile.repeatProbability * 0.75,
    0.18 + profile.organicStrength * 0.65,
  ]);
  const components = [
    "brand",
    "category",
    "existing_customer",
    "organic",
  ] as const;

  return components.map((component, index) => ({
    id: `${profile.merchantId}_baseline_${component}`,
    component,
    outcome: "orders",
    cadence: "day",
    baseRate: Math.max(0, dailyBaselineOrders * componentWeights[index]!),
    paidMarketingIncluded: false,
    timeVarying: true,
  }));
}

function conversionMechanisms(
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  const purchase = clamp(profile.baselineConversionRate, 0.002, 0.12);
  const pdp = clamp(0.35 + purchase * 4 + rng.normal(0, 0.06), 0.18, 0.88);
  const cart = clamp(0.05 + purchase * 2.1 + rng.normal(0, 0.025), 0.025, 0.28);
  const checkout = clamp(0.28 + purchase * 5 + rng.normal(0, 0.06), 0.18, 0.82);

  return [
    {
      id: `${profile.merchantId}_conversion_product_view`,
      outcome: "product_view",
      baseProbability: pdp,
      modifiers: [],
    },
    {
      id: `${profile.merchantId}_conversion_add_to_cart`,
      outcome: "add_to_cart",
      baseProbability: cart,
      modifiers: [
        {
          condition: "device",
          selector: { devices: ["mobile"] },
          multiplier: clamp(1 + (profile.mobileTrafficShare - 0.65) * 0.15, 0.82, 1.12),
        },
      ],
    },
    {
      id: `${profile.merchantId}_conversion_checkout`,
      outcome: "checkout",
      baseProbability: checkout,
      modifiers: [],
    },
    {
      id: `${profile.merchantId}_conversion_purchase`,
      outcome: "purchase",
      baseProbability: purchase,
      modifiers: [
        {
          condition: "intent",
          selector: { segmentIds: ["high_intent"] },
          multiplier: rng.uniform(1.4, 2.8),
        },
        {
          condition: "previous_purchase",
          selector: { segmentIds: ["returning"] },
          multiplier: rng.uniform(1.08, 1.75),
        },
      ],
    },
  ];
}

function funnelMechanisms(
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  const weakPdp =
    profile.complexity === "adversarial" && rng.bool(0.28);
  const cartFriction =
    profile.complexity !== "simple" && rng.bool(0.24);
  const checkoutFriction =
    profile.complexity === "adversarial" && rng.bool(0.3);

  return [
    {
      id: `${profile.merchantId}_funnel_session_collection`,
      from: "session",
      to: "collection",
      baseProbability: clamp(rng.uniform(0.35, 0.72), 0, 1),
      allowsReentry: true,
      allowsMultipleSessions: true,
    },
    {
      id: `${profile.merchantId}_funnel_session_pdp`,
      from: "session",
      to: "pdp",
      baseProbability: clamp(
        rng.uniform(0.2, 0.52) * (weakPdp ? 0.62 : 1),
        0,
        1,
      ),
      allowsReentry: true,
      allowsMultipleSessions: true,
    },
    {
      id: `${profile.merchantId}_funnel_collection_pdp`,
      from: "collection",
      to: "pdp",
      baseProbability: clamp(
        rng.uniform(0.36, 0.78) * (weakPdp ? 0.68 : 1),
        0,
        1,
      ),
      allowsReentry: true,
      allowsMultipleSessions: true,
    },
    {
      id: `${profile.merchantId}_funnel_pdp_cart`,
      from: "pdp",
      to: "add_to_cart",
      baseProbability: clamp(
        rng.uniform(0.055, 0.19) * (cartFriction ? 0.65 : 1),
        0,
        1,
      ),
      allowsReentry: true,
      allowsMultipleSessions: true,
    },
    {
      id: `${profile.merchantId}_funnel_cart_checkout`,
      from: "add_to_cart",
      to: "checkout",
      baseProbability: clamp(
        rng.uniform(0.34, 0.74) * (cartFriction ? 0.76 : 1),
        0,
        1,
      ),
      allowsReentry: true,
      allowsMultipleSessions: true,
    },
    {
      id: `${profile.merchantId}_funnel_checkout_purchase`,
      from: "checkout",
      to: "purchase",
      baseProbability: clamp(
        rng.uniform(0.48, 0.86) * (checkoutFriction ? 0.62 : 1),
        0,
        1,
      ),
      allowsReentry: true,
      allowsMultipleSessions: true,
    },
  ];
}

function seasonalityMechanisms(
  profile: LatentBusinessProfile,
  catalog: GeneratedCatalog,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  const generated = generateSeasonality(profile, rng);
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  const mechanisms: Record<string, unknown>[] = [
    {
      id: `${profile.merchantId}_seasonality_month`,
      kind: "month",
      multipliers: months.map((key, index) => ({
        key,
        multiplier: generated.monthly[index]!,
      })),
    },
    {
      id: `${profile.merchantId}_seasonality_weekday`,
      kind: "weekday",
      multipliers: weekdays.map((key, index) => ({
        key,
        multiplier: generated.weekday[index]!,
      })),
    },
  ];

  if (
    (profile.complexity === "complex" ||
      profile.complexity === "adversarial") &&
    catalog.products.length > 2
  ) {
    for (const product of catalog.products.slice(0, 3)) {
      mechanisms.push({
        id: `${product.productId}_seasonality`,
        kind: "product_specific",
        selector: { productIds: [product.productId] },
        multipliers: months.map((key, index) => ({
          key,
          multiplier: Math.max(
            0.2,
            generated.monthly[index]! * rng.uniform(0.82, 1.18),
          ),
        })),
      });
    }
  }

  return mechanisms;
}

function productDemandMechanisms(
  catalog: GeneratedCatalog,
): readonly Record<string, unknown>[] {
  return catalog.products.map((product, index) => ({
    id: `${product.productId}_demand`,
    productId: product.productId,
    categoryId: product.categoryId,
    baseLatentDemandUnits: product.dailyLatentDemandUnits,
    cadence: "day",
    ...(product.substituteProductIds === undefined
      ? {}
      : { substitutionProductIds: product.substituteProductIds }),
    ...(index > 0 && index % 7 === 0
      ? { complementaryProductIds: [catalog.products[index - 1]!.productId] }
      : {}),
    timeVarying: true,
  }));
}

function inventoryMechanisms(
  catalog: GeneratedCatalog,
): readonly Record<string, unknown>[] {
  return catalog.products.map((product) => ({
    id: `${product.productId}_inventory`,
    productId: product.productId,
    initialAvailableUnits: product.initialAvailableUnits,
    initialReservedUnits: product.initialReservedUnits,
    replenishmentUnits: product.replenishmentUnits,
    ...(product.replenishmentEverySeconds === undefined
      ? {}
      : { replenishmentEverySeconds: product.replenishmentEverySeconds }),
    supplierLeadTimeSeconds: product.supplierLeadTimeSeconds,
    allowBackorders: product.allowBackorders,
    stockoutBehavior: product.stockoutBehavior,
    ...(product.substituteProductIds === undefined
      ? {}
      : { substituteProductIds: product.substituteProductIds }),
  }));
}

function priceElasticities(
  profile: LatentBusinessProfile,
  catalog: GeneratedCatalog,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  const elasticities: Record<string, unknown>[] = catalog.products.map(
    (product) => ({
      id: `${product.productId}_own_price_elasticity`,
      kind: "own_price",
      sourceProductId: product.productId,
      targetProductId: product.productId,
      relationship: "self",
      form: "constant",
      elasticity: product.priceElasticity,
    }),
  );

  const crossCount =
    profile.complexity === "simple"
      ? 0
      : profile.complexity === "normal"
        ? Math.min(2, catalog.products.length - 1)
        : Math.min(6, catalog.products.length - 1);

  for (let index = 0; index < crossCount; index += 1) {
    const source = catalog.products[index]!;
    const target = catalog.products[index + 1]!;
    const substitute = index % 3 !== 2;
    elasticities.push({
      id: `${source.productId}_to_${target.productId}_cross_price`,
      kind: "cross_price",
      sourceProductId: source.productId,
      targetProductId: target.productId,
      relationship: substitute ? "substitute" : "complement",
      form: "constant",
      elasticity: substitute
        ? rng.uniform(0.08, 0.65)
        : -rng.uniform(0.04, 0.35),
    });
  }

  return elasticities;
}

function promotionElasticities(
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  const conversionPointLift = clamp(
    profile.baselineConversionRate *
      rng.uniform(0.12, 0.8) *
      profile.promotionElasticityMultiplier,
    0.001,
    0.18,
  );
  const repeatLift = clamp(
    profile.repeatProbability *
      rng.uniform(-0.08, 0.12) *
      Math.min(1.5, profile.promotionElasticityMultiplier),
    -0.2,
    0.2,
  );

  return [
    {
      id: `${profile.merchantId}_promotion_sitewide`,
      promotionType: "sitewide",
      effects: [
        {
          outcome: "conversion_probability",
          effect: {
            scale: "probability_point",
            value: conversionPointLift,
            unit: "probability",
          },
        },
        {
          outcome: "margin",
          effect: {
            scale: "relative",
            value: -clamp(
              profile.expectedDiscountRate * rng.uniform(0.7, 1.3),
              0,
              0.45,
            ),
            unit: "dimensionless",
          },
        },
        {
          outcome: "repeat_probability",
          effect: {
            scale: "probability_point",
            value: repeatLift,
            unit: "probability",
          },
        },
      ],
    },
  ];
}

function lifecycleMechanisms(
  profile: LatentBusinessProfile,
): {
  readonly clvMechanisms: readonly Record<string, unknown>[];
  readonly repeatPurchaseMechanisms: readonly Record<string, unknown>[];
} {
  const cycles = clamp(
    365 / Math.max(7, profile.expectedPurchaseIntervalDays),
    0.2,
    16,
  );
  const expectedFuturePurchases =
    profile.repeatProbability * cycles;
  const expectedGrossMarginMinor = Math.max(
    0,
    Math.round(
      expectedFuturePurchases *
        profile.expectedAovMinor *
        profile.grossMarginRate,
    ),
  );
  const expectedDiscountsMinor = Math.max(
    0,
    Math.round(
      expectedFuturePurchases *
        profile.expectedAovMinor *
        profile.expectedDiscountRate,
    ),
  );
  const expectedReturnsMinor = Math.max(
    0,
    Math.round(
      expectedFuturePurchases *
        profile.expectedAovMinor *
        profile.expectedReturnRate,
    ),
  );
  const expectedFulfillmentCostsMinor = Math.max(
    0,
    Math.round(
      expectedFuturePurchases *
        profile.expectedAovMinor *
        (profile.fulfillmentRate + profile.shippingSubsidyRate),
    ),
  );
  const expectedAcquisitionCostsMinor = Math.max(
    0,
    Math.round(
      profile.expectedAovMinor *
        profile.marketingSpendRate /
        Math.max(0.05, 1 - profile.repeatProbability * 0.5),
    ),
  );

  return {
    clvMechanisms: [
      {
        id: `${profile.merchantId}_clv_default`,
        horizonDays: 365,
        expectedFuturePurchases,
        expectedGrossMarginMinor,
        expectedDiscountsMinor,
        expectedReturnsMinor,
        expectedFulfillmentCostsMinor,
        expectedAcquisitionCostsMinor,
        retentionProbability: profile.repeatProbability,
        annualDiscountRate: 0.08,
        valueKind: "expected_future_value",
      },
    ],
    repeatPurchaseMechanisms: [
      {
        id: `${profile.merchantId}_repeat_purchase`,
        baseRepeatProbability: profile.repeatProbability,
        dependsOn: [
          "previous_purchases",
          "product",
          "acquisition_source",
          "elapsed_time",
          "lifecycle_state",
        ],
        modifiers: [
          {
            selector: { segmentIds: ["returning"] },
            multiplier: clamp(1 + profile.repeatProbability * 0.55, 1, 1.55),
          },
        ],
      },
    ],
  };
}

function deviceEffects(
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  const mobileConversionEffect = clamp(
    rng.normal(
      profile.mobileTrafficShare > 0.7 ? -0.08 : -0.14,
      0.09,
    ),
    -0.35,
    0.22,
  );
  const mobileAovEffect = clamp(rng.normal(-0.06, 0.07), -0.25, 0.12);

  return [
    {
      id: `${profile.merchantId}_mobile_conversion_effect`,
      device: "mobile",
      outcome: "conversion_probability",
      effect: {
        scale: "relative",
        value: mobileConversionEffect,
        unit: "dimensionless",
      },
      populationAdjusted: true,
    },
    {
      id: `${profile.merchantId}_mobile_aov_effect`,
      device: "mobile",
      outcome: "aov",
      effect: {
        scale: "relative",
        value: mobileAovEffect,
        unit: "dimensionless",
      },
      populationAdjusted: true,
    },
    {
      id: `${profile.merchantId}_desktop_conversion_effect`,
      device: "desktop",
      outcome: "conversion_probability",
      effect: {
        scale: "relative",
        value: clamp(-mobileConversionEffect * rng.uniform(0.35, 0.8), -0.2, 0.25),
        unit: "dimensionless",
      },
      populationAdjusted: true,
    },
  ];
}

function externalShocks(
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): readonly Record<string, unknown>[] {
  if (profile.complexity === "simple") return [];
  if (profile.complexity === "normal" && !rng.bool(0.25)) return [];

  const kind = rng.pick([
    "competitor_promotion",
    "economic_demand",
    "weather",
    "platform_change",
    "supplier_disruption",
    "shipping_disruption",
    "market_trend",
  ] as const);

  return [
    {
      id: `${profile.merchantId}_shock_01`,
      kind,
      start: `2026-${String(rng.integer(1, 12)).padStart(2, "0")}-15T00:00:00Z`,
      durationSeconds: rng.integer(1, 21) * 86_400,
      affectedVariables: [
        kind === "supplier_disruption" || kind === "shipping_disruption"
          ? "inventory.available"
          : "demand.product_units",
      ],
      mechanism: {
        functionalForm: rng.pick([
          "additive",
          "multiplicative",
          "nonlinear",
        ] as const),
        effect: {
          scale: "relative",
          value:
            kind === "market_trend"
              ? rng.uniform(-0.18, 0.25)
              : rng.uniform(-0.28, -0.04),
          unit: "dimensionless",
        },
      },
    },
  ];
}

function causalGraph(
  profile: LatentBusinessProfile,
  catalog: GeneratedCatalog,
  channels: ReturnType<typeof generateChannelMechanisms>,
  conversions: readonly Record<string, unknown>[],
  promotions: readonly Record<string, unknown>[],
  price: readonly Record<string, unknown>[],
  productDemand: readonly Record<string, unknown>[],
  inventory: readonly Record<string, unknown>[],
): {
  readonly nodes: readonly Record<string, unknown>[];
  readonly edges: readonly Record<string, unknown>[];
  readonly interventionDefinitions: readonly Record<string, unknown>[];
} {
  const nodes: Record<string, unknown>[] = [
    {
      id: "customer.latent_intent",
      domain: "customer",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "probability",
      intervenable: false,
      visibility: "latent",
    },
    {
      id: "customer.brand_awareness",
      domain: "customer",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "probability",
      intervenable: false,
      visibility: "latent",
    },
    {
      id: "pricing.product_price",
      domain: "pricing",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "money_minor",
      intervenable: true,
      visibility: "merchant_observation",
    },
    {
      id: "promotion.discount_active",
      domain: "promotion",
      temporalScope: "time_indexed",
      valueType: "boolean",
      unit: "boolean",
      intervenable: true,
      visibility: "merchant_observation",
    },
    {
      id: "inventory.available",
      domain: "inventory",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "units",
      intervenable: true,
      visibility: "merchant_observation",
    },
    {
      id: "demand.product_units",
      domain: "demand",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "units",
      intervenable: false,
      visibility: "latent",
    },
    {
      id: "funnel.purchase_probability",
      domain: "funnel",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "probability",
      intervenable: false,
      visibility: "latent",
    },
    {
      id: "commerce.orders",
      domain: "commerce",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "orders",
      intervenable: false,
      visibility: "perfect_observation",
    },
    {
      id: "commerce.revenue",
      domain: "commerce",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "money_minor",
      intervenable: false,
      visibility: "perfect_observation",
    },
    {
      id: "economics.contribution_profit",
      domain: "economics",
      temporalScope: "time_indexed",
      valueType: "number",
      unit: "money_minor",
      intervenable: false,
      visibility: "latent",
    },
  ];

  const edges: Record<string, unknown>[] = [];
  const interventionDefinitions: Record<string, unknown>[] = [
    {
      variable: "pricing.product_price",
      allowedOperation: "set",
      description: "Set synthetic product price in minor currency units.",
    },
    {
      variable: "promotion.discount_active",
      allowedOperation: "set",
      description: "Enable or disable the modeled promotion.",
    },
    {
      variable: "inventory.available",
      allowedOperation: "set",
      description: "Set available inventory for an inventory counterfactual.",
    },
  ];

  for (const channel of profile.activeChannels) {
    const spendNode = `marketing.${channel}.spend`;
    const exposureNode = `marketing.${channel}.exposure`;
    const mechanismId = channels.channelMechanismIds[channel]!;
    nodes.push(
      {
        id: spendNode,
        domain: "marketing",
        temporalScope: "time_indexed",
        valueType: "number",
        unit: "money_minor",
        intervenable: true,
        visibility: "merchant_observation",
      },
      {
        id: exposureNode,
        domain: "marketing",
        temporalScope: "time_indexed",
        valueType: "number",
        unit: "impressions",
        intervenable: false,
        visibility: "perfect_observation",
      },
    );
    edges.push(
      {
        parent: spendNode,
        child: exposureNode,
        relationship: "direct",
        mechanismId,
      },
      {
        parent: exposureNode,
        child: "customer.brand_awareness",
        relationship: "direct",
        mechanismId,
        lagSeconds: 86_400,
      },
    );
    interventionDefinitions.push({
      variable: spendNode,
      allowedOperation: "set",
      description: `Set modeled ${channel} spend.`,
    });
  }

  const purchaseConversion = conversions.find(
    (item) => item["outcome"] === "purchase",
  )!;
  const purchaseConversionId = String(purchaseConversion["id"]);
  const promotionId = String(promotions[0]!["id"]);
  const priceId = String(price[0]!["id"]);
  const productDemandId = String(productDemand[0]!["id"]);
  const inventoryId = String(inventory[0]!["id"]);

  edges.push(
    {
      parent: "customer.brand_awareness",
      child: "funnel.purchase_probability",
      relationship: "mediated",
      mechanismId: purchaseConversionId,
    },
    {
      parent: "customer.latent_intent",
      child: "funnel.purchase_probability",
      relationship: "direct",
      mechanismId: purchaseConversionId,
    },
    {
      parent: "pricing.product_price",
      child: "demand.product_units",
      relationship: "direct",
      mechanismId: priceId,
    },
    {
      parent: "promotion.discount_active",
      child: "funnel.purchase_probability",
      relationship: "direct",
      mechanismId: promotionId,
    },
    {
      parent: "demand.product_units",
      child: "commerce.orders",
      relationship: "direct",
      mechanismId: productDemandId,
    },
    {
      parent: "funnel.purchase_probability",
      child: "commerce.orders",
      relationship: "direct",
      mechanismId: purchaseConversionId,
    },
    {
      parent: "inventory.available",
      child: "commerce.orders",
      relationship: "constraint",
      mechanismId: inventoryId,
    },
    {
      parent: "commerce.orders",
      child: "commerce.revenue",
      relationship: "direct",
      mechanismId: "contribution_profit_v1",
    },
    {
      parent: "commerce.revenue",
      child: "economics.contribution_profit",
      relationship: "direct",
      mechanismId: "contribution_profit_v1",
    },
  );

  for (const interaction of channels.channelInteractions) {
    const ids = interaction["channelIds"] as readonly string[];
    const firstExposure = `marketing.${ids[0]}.exposure`;
    const kind = String(interaction["kind"]);
    edges.push({
      parent: firstExposure,
      child:
        kind === "mediation"
          ? "customer.brand_awareness"
          : "funnel.purchase_probability",
      relationship:
        kind === "mediation"
          ? "mediated"
          : kind === "cannibalization" || kind === "synergy"
            ? "interaction"
            : "direct",
      mechanismId: String(interaction["id"]),
      ...(kind === "delayed"
        ? { lagSeconds: Number(interaction["delaySeconds"]) }
        : {}),
    });
  }

  void catalog;

  return {
    nodes,
    edges,
    interventionDefinitions,
  };
}

function buildRawManifest(
  config: MerchantGenerationConfig,
  profile: LatentBusinessProfile,
  catalog: GeneratedCatalog,
  rng: SeededRandom,
): Record<string, unknown> {
  const channels = generateChannelMechanisms(
    config,
    profile,
    rng.fork("channels"),
  );
  const conversions = conversionMechanisms(
    profile,
    rng.fork("conversion"),
  );
  const funnels = funnelMechanisms(profile, rng.fork("funnel"));
  const productDemand = productDemandMechanisms(catalog);
  const inventory = inventoryMechanisms(catalog);
  const price = priceElasticities(profile, catalog, rng.fork("price"));
  const promotions = promotionElasticities(profile, rng.fork("promotion"));
  const lifecycle = lifecycleMechanisms(profile);
  const seasonality = seasonalityMechanisms(
    profile,
    catalog,
    rng.fork("seasonality"),
  );
  const devices = deviceEffects(profile, rng.fork("devices"));
  const graph = causalGraph(
    profile,
    catalog,
    channels,
    conversions,
    promotions,
    price,
    productDemand,
    inventory,
  );

  const baseline = baselineDemand(profile);

  return {
    schemaVersion: "1.0.0",
    simulatorVersion: GENERATOR_VERSION,
    worldId: profile.merchantId,
    seed: config.seed,
    merchant: {
      currency: config.currency ?? "CAD",
      marketSize: Math.max(
        1,
        Math.round(
          profile.customerPopulation *
            rng.uniform(2.2, 8.5),
        ),
      ),
      timezone: config.timezone ?? "UTC",
      baselineBrandAwareness: clamp(profile.brandStrength, 0, 1),
      baselineBrandPreference: clamp(
        profile.brandStrength * rng.uniform(0.32, 0.82),
        0,
        1,
      ),
    },
    customers: {
      populationSize: profile.customerPopulation,
      segmentShares: customerSegmentShares(profile),
      latentIntentDistribution: {
        kind: "beta",
        alpha: rng.uniform(1.2, 4.5),
        beta: rng.uniform(2.2, 8.5),
      },
      existingCustomerShare: clamp(profile.repeatProbability * 0.62, 0.03, 0.75),
    },
    baselineDemand: baseline,
    channelIncrementality: channels.channelIncrementality,
    responseCurves: channels.responseCurves,
    cacMechanisms: channels.cacMechanisms,
    conversionMechanisms: conversions,
    priceElasticities: price,
    promotionElasticities: promotions,
    clvMechanisms: lifecycle.clvMechanisms,
    repeatPurchaseMechanisms: lifecycle.repeatPurchaseMechanisms,
    productDemandMechanisms: productDemand,
    inventoryMechanisms: inventory,
    seasonality,
    deviceEffects: devices,
    funnelMechanisms: funnels,
    channelInteractions: channels.channelInteractions,
    saturationMechanisms: channels.saturationMechanisms,
    organicDemand: {
      id: `${profile.merchantId}_organic_counterfactual`,
      counterfactualDefinition:
        "demand_without_modeled_paid_intervention",
      baselineDemandMechanismIds: baseline.map((item) =>
        String(item["id"]),
      ),
    },
    marginEconomics: {
      currency: config.currency ?? "CAD",
      accountingIdentity: "contribution_profit_v1",
      includeVariableOperatingCosts: true,
    },
    externalShocks: externalShocks(profile, rng.fork("shocks")),
    causalGraph: {
      nodes: graph.nodes,
      edges: graph.edges,
    },
    interventionDefinitions: graph.interventionDefinitions,
  };
}

function provenance(
  config: MerchantGenerationConfig,
): MerchantGenerationProvenance {
  return {
    generatorVersion: GENERATOR_VERSION,
    groundTruthSchemaVersion: "1.0.0",
    seed: config.seed,
    archetype: config.archetype,
    scale: config.scale,
    difficulty: config.complexity,
    generationConfig: config,
    appliedOverrides: appliedOverrides(config),
  };
}

function summary(
  config: MerchantGenerationConfig,
  profile: LatentBusinessProfile,
  catalog: GeneratedCatalog,
): MerchantResearchSummary {
  return {
    merchantId: profile.merchantId,
    archetype: config.archetype,
    scale: config.scale,
    complexity: config.complexity,
    businessModel: profile.purchaseFrequency,
    aovProfile: profile.aovProfile,
    expectedAovMinor: profile.expectedAovMinor,
    expectedAnnualOrders: profile.expectedAnnualOrders,
    annualRevenuePotentialMinor: profile.annualRevenuePotentialMinor,
    skuCount: catalog.products.length,
    grossMarginRate: profile.grossMarginRate,
    repeatProbability: profile.repeatProbability,
    expectedPurchaseIntervalDays: profile.expectedPurchaseIntervalDays,
    mobileTrafficShare: profile.mobileTrafficShare,
    activeChannels: profile.activeChannels,
    paidDependence: profile.paidDependence,
    organicDemandShare: profile.organicDemandShare,
    promotionProfile: profile.promotionProfile,
    catalogProfile: profile.catalogProfile,
    inventoryProfile: profile.inventoryProfile,
    customerEconomics: profile.customerEconomics,
    seasonalityProfile: profile.seasonalityProfile,
    seasonalityStrength: profile.seasonalityStrength,
    productConcentrationTop5: catalog.top5DemandShare,
    expectedDiscountRate: profile.expectedDiscountRate,
    expectedReturnRate: profile.expectedReturnRate,
    expectedUnitsPerOrder: profile.expectedUnitsPerOrder,
    expectedContributionMarginRate:
      profile.expectedContributionMarginRate,
  };
}

export function generateMerchantWorldRecord(
  config: MerchantGenerationConfig,
): GeneratedMerchantWorld {
  const rng = new SeededRandom(
    configSeed(config.seed, GENERATOR_VERSION, config),
  );
  const profile = generateLatentBusinessProfile(
    config,
    rng.fork("business-profile"),
  );
  const catalog = generateCatalog(
    config,
    profile,
    rng.fork("catalog"),
  );

  const rawManifest = buildRawManifest(
    config,
    profile,
    catalog,
    rng.fork("manifest"),
  );

  // The frozen Step 1 parser is the final generation gate. A world that does
  // not satisfy the accepted GroundTruth schema never leaves this function.
  const manifest = parseGroundTruthManifest(rawManifest);

  return Object.freeze({
    manifest,
    provenance: Object.freeze(provenance(config)),
    summary: Object.freeze(summary(config, profile, catalog)),
  });
}

export function generateMerchantWorld(
  config: MerchantGenerationConfig,
): GroundTruthManifest {
  return generateMerchantWorldRecord(config).manifest;
}
