import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
} from "../generation/config.js";
import type { PaidMarketingChannel } from "../advertising_economics/types.js";
import {
  buildPlatformChannelReport,
} from "../advertising_economics/platform.js";
import type {
  EcommerceEconomicReport,
} from "../ecommerce_economics/types.js";
import {
  buildProductEconomicProfiles,
} from "../ecommerce_economics/products.js";
import {
  chooseProduct,
} from "../simulation/commerce.js";
import {
  buildSimulationInterventionState,
} from "../simulation/interventions.js";
import { SharedRandomness } from "../simulation/kernel.js";
import {
  createRuntimeWorldState,
} from "../simulation/state.js";
import {
  buildSkuEconomicIntelligence,
} from "./profiles.js";
import {
  PRODUCT_ECONOMICS_VERSION,
  type InventoryScaleRisk,
  type ObservedProductPerformance,
  type ProductCampaignPerformance,
  type ProductChoiceShift,
  type ProductEconomicsReport,
  type ProductEconomicsRequest,
  type SelloutSubstitutionDiagnostic,
  type SkuEconomicIntelligence,
} from "./types.js";

function weights(
  population: LatentCustomerPopulation,
): ReadonlyMap<string, number> {
  return new Map(
    population.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
}

function meanProductPreference(
  population: LatentCustomerPopulation,
  productId: string,
): number {
  let weighted = 0;
  let total = 0;
  for (const customer of population.customers) {
    const affinity =
      customer.productPreferences.find(
        (preference) =>
          preference.productId === productId,
      )?.affinity ?? 0;
    weighted += affinity * customer.populationWeight;
    total += customer.populationWeight;
  }
  return total > 0 ? weighted / total : 0;
}

export function observedProductPerformance(
  report: EcommerceEconomicReport,
  population: LatentCustomerPopulation,
): readonly ObservedProductPerformance[] {
  const weightByCustomer = weights(population);
  const rows = new Map<
    string,
    {
      orders: number;
      units: number;
      revenue: number;
      grossProfit: number;
      contribution: number;
      views: number;
      adds: number;
    }
  >();

  const get = (productId: string) => {
    const current = rows.get(productId) ?? {
      orders: 0,
      units: 0,
      revenue: 0,
      grossProfit: 0,
      contribution: 0,
      views: 0,
      adds: 0,
    };
    rows.set(productId, current);
    return current;
  };

  for (const order of report.orders) {
    const weight =
      weightByCustomer.get(order.customerId) ?? 1;
    for (const line of order.lines) {
      const row = get(line.productId);
      row.orders += weight;
      row.units += line.quantity * weight;
      row.revenue +=
        line.netSalesBeforeReturnsMinor * weight;
      row.grossProfit +=
        line.grossProfitBeforeReturnsMinor * weight;

      const orderContributionRate =
        order.revenueAfterDiscountsMinor > 0
          ? order.contributionProfitBeforeAdvertisingMinor /
            order.revenueAfterDiscountsMinor
          : 0;
      row.contribution +=
        line.netSalesBeforeReturnsMinor *
        orderContributionRate *
        weight;
    }
  }

  for (const event of report.simulation.observableEvents) {
    if (!event.productId) continue;
    const row = get(event.productId);
    const weight =
      weightByCustomer.get(event.anonymousSubjectId) ?? 1;
    if (event.eventType === "product_view") {
      row.views += weight;
    } else if (event.eventType === "add_to_cart") {
      row.adds += weight;
    }
  }

  return [...rows.entries()]
    .map(([productId, row]) => ({
      productId,
      representedOrders: row.orders,
      representedUnits: row.units,
      netRevenueMinor: Math.round(row.revenue),
      grossProfitMinor: Math.round(row.grossProfit),
      contributionProfitBeforeAdvertisingMinor:
        Math.round(row.contribution),
      productViews: row.views,
      addsToCart: row.adds,
      observedViewToPurchaseRate:
        row.views > 0 ? row.orders / row.views : null,
    }))
    .sort((left, right) =>
      left.productId.localeCompare(right.productId),
    );
}

export function buildProductEconomicsReport(
  request: ProductEconomicsRequest,
): ProductEconomicsReport {
  const profiles =
    request.productProfiles ??
    request.ecommerceReport?.productProfiles ??
    buildProductEconomicProfiles(request.merchantWorld);

  const products = buildSkuEconomicIntelligence(
    request.merchantWorld,
    profiles,
  );

  const observed =
    request.ecommerceReport === undefined
      ? []
      : observedProductPerformance(
          request.ecommerceReport,
          request.latentPopulation,
        );

  return {
    version: PRODUCT_ECONOMICS_VERSION,
    merchantWorldId:
      request.merchantWorld.manifest.worldId,
    products,
    observed,
  };
}

export function productCampaignPerformance(
  report: EcommerceEconomicReport,
  population: LatentCustomerPopulation,
  productId: string,
  channel: PaidMarketingChannel,
  campaignSpendMinor: number,
): ProductCampaignPerformance {
  if (
    !Number.isFinite(campaignSpendMinor) ||
    campaignSpendMinor < 0
  ) {
    throw new RangeError(
      "campaign spend must be finite and non-negative",
    );
  }

  const platform = buildPlatformChannelReport(
    report.simulation,
    population,
    channel,
    campaignSpendMinor,
  );
  const orderById = new Map(
    report.orders.map(
      (order) => [order.orderId, order] as const,
    ),
  );
  const weightByCustomer = weights(population);

  let claimedRevenue = 0;
  let claimedOrders = 0;

  for (const claim of platform.claims) {
    const order = orderById.get(claim.orderId);
    if (!order) continue;
    const productRevenue = order.lines
      .filter((line) => line.productId === productId)
      .reduce(
        (sum, line) =>
          sum + line.netSalesBeforeReturnsMinor,
        0,
      );
    if (productRevenue <= 0) continue;

    const weight =
      weightByCustomer.get(order.customerId) ?? 1;
    claimedRevenue += productRevenue * weight;
    claimedOrders += weight;
  }

  return {
    productId,
    channel,
    campaignSpendMinor,
    platformClaimedProductRevenueMinor:
      Math.round(claimedRevenue),
    platformProductRoas:
      campaignSpendMinor > 0
        ? claimedRevenue / campaignSpendMinor
        : null,
    claimedOrdersContainingProduct:
      claimedOrders,
  };
}

export function evaluateInventoryScaleRisk(
  product: SkuEconomicIntelligence,
  campaign: ProductCampaignPerformance,
  proposedAdditionalSpendMinor: number,
  remainingUnits = product.initialSellableUnits,
): InventoryScaleRisk {
  if (
    !Number.isFinite(proposedAdditionalSpendMinor) ||
    proposedAdditionalSpendMinor < 0
  ) {
    throw new RangeError(
      "additional spend must be finite and non-negative",
    );
  }

  const units = Math.max(
    0,
    Math.floor(remainingUnits),
  );
  const stockCoverageDays =
    product.structuralDemandUnitsPerDay > 0
      ? units / product.structuralDemandUnitsPerDay
      : null;
  const optimisticContributionPerUnit = Math.max(
    0,
    product.expectedContributionPerUnitMinor,
  );
  const optimisticRemainingInventoryContributionMinor =
    Math.round(
      units * optimisticContributionPerUnit,
    );
  const upperBound =
    optimisticRemainingInventoryContributionMinor -
    proposedAdditionalSpendMinor;

  return {
    productId: product.productId,
    channel: campaign.channel,
    remainingUnits: units,
    stockCoverageDays,
    platformProductRoas:
      campaign.platformProductRoas,
    expectedContributionPerUnitMinor:
      product.expectedContributionPerUnitMinor,
    optimisticRemainingInventoryContributionMinor,
    proposedAdditionalSpendMinor,
    optimisticMarginalContributionUpperBoundMinor:
      upperBound,
    scalingEconomicallyImpossibleAtThisSpendBlock:
      upperBound < 0,
  };
}

function weightedChoiceExperiment(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
  soldOutProductId: string,
  simulationSeed: number,
  timestampMs: number,
  constrained: boolean,
  opportunitiesPerCustomer: number,
): ReadonlyMap<string, number> {
  const runtime = createRuntimeWorldState(
    world,
    population,
    timestampMs,
  );
  if (constrained) {
    runtime.inventory.set(soldOutProductId, 0);
  }

  const intervention =
    buildSimulationInterventionState(world, []);
  const randomness = new SharedRandomness(
    simulationSeed,
    "step8-product-choice",
  );
  const selected = new Map<string, number>();

  for (const customer of runtime.customers.values()) {
    for (
      let ordinal = 0;
      ordinal < opportunitiesPerCustomer;
      ordinal += 1
    ) {
      const offer = chooseProduct(
        runtime,
        customer,
        timestampMs,
        intervention,
        randomness,
        customer.customerId +
          ":choice:" +
          String(ordinal),
        {
          enableProductRelationships: true,
          enableEnhancedBasketEconomics: true,
          executeInventoryLifecycle: true,
        },
      );
      if (!offer) continue;
      selected.set(
        offer.productId,
        (selected.get(offer.productId) ?? 0) +
          customer.populationWeight,
      );
    }
  }

  return selected;
}

function choiceShift(
  product: SkuEconomicIntelligence,
  population: LatentCustomerPopulation,
  baseline: ReadonlyMap<string, number>,
  constrained: ReadonlyMap<string, number>,
): ProductChoiceShift {
  const preference =
    meanProductPreference(
      population,
      product.productId,
    );
  const before =
    baseline.get(product.productId) ?? 0;
  const after =
    constrained.get(product.productId) ?? 0;

  return {
    productId: product.productId,
    baselineWeightedSelections: before,
    constrainedWeightedSelections: after,
    selectionDelta: after - before,
    structuralDemandUnitsPerDayBefore:
      product.structuralDemandUnitsPerDay,
    structuralDemandUnitsPerDayAfter:
      product.structuralDemandUnitsPerDay,
    structuralDemandDelta: 0,
    meanLatentPreferenceBefore: preference,
    meanLatentPreferenceAfter: preference,
    latentPreferenceDelta: 0,
  };
}

export function evaluateSelloutSubstitution(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
  soldOutProductId: string,
  substituteProductId: string,
  options: {
    readonly simulationSeed?: number;
    readonly timestamp?: string;
    readonly opportunitiesPerCustomer?: number;
  } = {},
): SelloutSubstitutionDiagnostic {
  const products = buildSkuEconomicIntelligence(world);
  const soldOutProduct = products.find(
    (product) =>
      product.productId === soldOutProductId,
  );
  const substitute = products.find(
    (product) =>
      product.productId === substituteProductId,
  );

  if (!soldOutProduct || !substitute) {
    throw new RangeError(
      "sellout substitution products must exist in the world",
    );
  }

  const timestampMs = Date.parse(
    options.timestamp ??
      "2026-01-15T12:00:00.000Z",
  );
  if (!Number.isFinite(timestampMs)) {
    throw new RangeError(
      "sellout substitution timestamp must be valid",
    );
  }

  const simulationSeed =
    options.simulationSeed ?? 88001;
  const opportunitiesPerCustomer =
    Math.max(
      1,
      Math.floor(
        options.opportunitiesPerCustomer ?? 8,
      ),
    );

  const baseline = weightedChoiceExperiment(
    world,
    population,
    soldOutProductId,
    simulationSeed,
    timestampMs,
    false,
    opportunitiesPerCustomer,
  );
  const constrained = weightedChoiceExperiment(
    world,
    population,
    soldOutProductId,
    simulationSeed,
    timestampMs,
    true,
    opportunitiesPerCustomer,
  );

  const soldOutShift = choiceShift(
    soldOutProduct,
    population,
    baseline,
    constrained,
  );
  const substituteShift = choiceShift(
    substitute,
    population,
    baseline,
    constrained,
  );
  const knownSubstitutionRelationship =
    soldOutProduct.substitutionProductIds.includes(
      substituteProductId,
    );

  return {
    soldOutProductId,
    substituteProductId,
    knownSubstitutionRelationship,
    soldOutProduct: soldOutShift,
    substituteProduct: substituteShift,
    observedSubstituteLiftWithNoStructuralDemandChange:
      knownSubstitutionRelationship &&
      substituteShift.selectionDelta > 0 &&
      substituteShift.structuralDemandDelta === 0,
    observedSubstituteLiftWithNoLatentPreferenceChange:
      knownSubstitutionRelationship &&
      substituteShift.selectionDelta > 0 &&
      substituteShift.latentPreferenceDelta === 0,
  };
}
