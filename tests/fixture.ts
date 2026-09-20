import { parseGroundTruthManifest } from "../src/ground_truth/manifest.js";

export function validManifest() {
  return parseGroundTruthManifest({
    schemaVersion: "1.0.0",
    simulatorVersion: "contract-test",
    worldId: "test-world",
    seed: 7,
    merchant: {
      currency: "CAD",
      marketSize: 1000,
      timezone: "UTC",
      baselineBrandAwareness: 0.1,
      baselineBrandPreference: 0.05,
    },
    customers: {
      populationSize: 100,
      segmentShares: [{ segmentId: "all", probability: 1 }],
      latentIntentDistribution: { kind: "beta", alpha: 2, beta: 5 },
      existingCustomerShare: 0.2,
    },
    baselineDemand: [
      {
        id: "baseline",
        component: "organic",
        outcome: "orders",
        cadence: "day",
        baseRate: 10,
        paidMarketingIncluded: false,
        timeVarying: true,
      },
    ],
    channelIncrementality: [
      {
        id: "paid-effect",
        channelId: "paid",
        outcomeVariable: "commerce.orders",
        effect: { scale: "absolute", value: 2, unit: "orders" },
        responseCurveId: "paid-curve",
        timeDependent: false,
      },
    ],
    responseCurves: [
      {
        id: "paid-curve",
        kind: "linear",
        inputUnit: "money_minor",
        outputUnit: "orders",
        slopePerMoneyMinor: 0.0001,
      },
    ],
    cacMechanisms: [],
    conversionMechanisms: [
      {
        id: "purchase",
        outcome: "purchase",
        baseProbability: 0.02,
        modifiers: [],
      },
    ],
    priceElasticities: [],
    promotionElasticities: [],
    clvMechanisms: [],
    repeatPurchaseMechanisms: [],
    productDemandMechanisms: [],
    inventoryMechanisms: [
      {
        id: "stock",
        productId: "sku",
        initialAvailableUnits: 10,
        initialReservedUnits: 1,
        replenishmentUnits: 0,
        supplierLeadTimeSeconds: 0,
        allowBackorders: false,
        stockoutBehavior: "lost_demand",
      },
    ],
    seasonality: [],
    deviceEffects: [],
    funnelMechanisms: [],
    channelInteractions: [],
    saturationMechanisms: [],
    organicDemand: {
      id: "organic",
      counterfactualDefinition: "demand_without_modeled_paid_intervention",
      baselineDemandMechanismIds: ["baseline"],
    },
    marginEconomics: {
      currency: "CAD",
      accountingIdentity: "contribution_profit_v1",
      includeVariableOperatingCosts: true,
    },
    externalShocks: [],
    causalGraph: {
      nodes: [
        {
          id: "marketing.spend",
          domain: "marketing",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "money_minor",
          intervenable: true,
          visibility: "merchant_observation",
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
      ],
      edges: [
        {
          parent: "marketing.spend",
          child: "commerce.orders",
          relationship: "direct",
          mechanismId: "paid-effect",
        },
      ],
    },
    interventionDefinitions: [
      {
        variable: "marketing.spend",
        allowedOperation: "set",
        description: "Set synthetic paid spend.",
      },
    ],
  });
}
