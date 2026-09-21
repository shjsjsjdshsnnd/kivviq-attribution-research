import type { Intervention } from "../ground_truth/interventions.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import {
  evaluateEcommerceEconomics,
} from "../ecommerce_economics/evaluator.js";
import {
  buildSkuEconomicIntelligence,
} from "../product_economics/profiles.js";
import type {
  SkuEconomicIntelligence,
} from "../product_economics/types.js";
import type {
  InventoryDynamicsEvaluationRequest,
  InventoryDynamicsReport,
  InventoryHealthRow,
  InventoryResponseCurve,
  InventoryStockoutProbability,
  LostSalesCounterfactual,
  PromotionStockoutCounterfactual,
  ReplenishmentCounterfactual,
  ScarceInventoryOpportunityCost,
} from "./types.js";
import {
  INVENTORY_DYNAMICS_VERSION,
} from "./types.js";

const DAY_MS = 86_400_000;

function appendIntervention(
  base: readonly Intervention[] | undefined,
  addition: Intervention,
): readonly Intervention[] {
  return [...(base ?? []), addition];
}

function spendIntervention(
  channel: MarketingChannel,
  spendMinor: number,
): Intervention {
  return {
    variable: `marketing.${channel}.spend`,
    operation: "set",
    value: {
      kind: "number",
      value: Math.max(0, Math.round(spendMinor)),
      unit: "money_minor",
    },
  };
}

function unconstrainedInventoryIntervention(): Intervention {
  return {
    variable: "inventory.available",
    operation: "set",
    value: {
      kind: "number",
      value: 1_000_000_000,
      unit: "units",
    },
  };
}

function promotionIntervention(
  active: boolean,
): Intervention {
  return {
    variable: "promotion.discount_active",
    operation: "set",
    value: { kind: "boolean", value: active },
  };
}

function horizonDays(
  start: string,
  end: string,
): number {
  return Math.max(
    1 / 24,
    (Date.parse(end) - Date.parse(start)) / DAY_MS,
  );
}

function sumDemand(
  report: ReturnType<
    typeof evaluateEcommerceEconomics
  >,
  productId: string,
  mode:
    | "latent"
    | "fulfilled"
    | "substituted"
    | "delayed"
    | "backordered"
    | "lost"
    | "merchant_exit",
): number {
  let total = 0;
  const inventoryTruth =
    report.simulation.godMode.inventory;
  if (!inventoryTruth) {
    throw new RangeError(
      "Step 9 evaluation requires inventory god mode",
    );
  }

  for (const demand of inventoryTruth.demandTruth) {
    const weightedUnits =
      demand.requestedUnits * demand.representedWeight;

    if (mode === "latent") {
      if (demand.requestedSkuId === productId) {
        total += weightedUnits;
      }
      continue;
    }

    if (mode === "fulfilled") {
      if (
        demand.fulfilledSkuId === productId &&
        demand.commerceOutcome === "purchased" &&
        demand.inventoryDisposition !== "backordered"
      ) {
        total += weightedUnits;
      }
      continue;
    }

    if (
      demand.requestedSkuId !== productId
    ) {
      continue;
    }

    if (
      mode === "substituted" &&
      demand.inventoryDisposition === "substituted"
    ) {
      total += weightedUnits;
    } else if (
      mode === "delayed" &&
      demand.inventoryDisposition === "delayed"
    ) {
      total += weightedUnits;
    } else if (
      mode === "backordered" &&
      demand.inventoryDisposition === "backordered"
    ) {
      total += weightedUnits;
    } else if (
      mode === "lost" &&
      demand.inventoryDisposition === "permanently_lost"
    ) {
      total += weightedUnits;
    } else if (
      mode === "merchant_exit" &&
      demand.inventoryDisposition === "merchant_exit"
    ) {
      total += weightedUnits;
    }
  }

  return total;
}

function rowFor(
  request: InventoryDynamicsEvaluationRequest,
  report: ReturnType<
    typeof evaluateEcommerceEconomics
  >,
  product: SkuEconomicIntelligence,
): InventoryHealthRow {
  const truth =
    report.simulation.godMode.inventory;
  if (!truth) {
    throw new RangeError(
      "Step 9 evaluation requires inventory god mode",
    );
  }
  const position = truth.positions.find(
    (candidate) =>
      candidate.skuId === product.productId,
  );
  const reconciliation = truth.reconciliation.find(
    (candidate) =>
      candidate.skuId === product.productId,
  );

  if (!position || !reconciliation) {
    throw new RangeError(
      "missing Step 9 inventory truth for " +
        product.productId,
    );
  }

  const periodDays = horizonDays(
    request.periodStart,
    request.periodEnd,
  );
  const latentDemandUnits = sumDemand(
    report,
    product.productId,
    "latent",
  );
  const fulfilledDemandUnits = sumDemand(
    report,
    product.productId,
    "fulfilled",
  );
  const substitutedDemandUnits = sumDemand(
    report,
    product.productId,
    "substituted",
  );
  const delayedDemandUnits = sumDemand(
    report,
    product.productId,
    "delayed",
  );
  const backorderedDemandUnits = sumDemand(
    report,
    product.productId,
    "backordered",
  );
  const permanentlyLostDemandUnits = sumDemand(
    report,
    product.productId,
    "lost",
  );
  const merchantExitDemandUnits = sumDemand(
    report,
    product.productId,
    "merchant_exit",
  );

  const baselineDaily =
    product.structuralDemandUnitsPerDay;
  const observedDaily =
    fulfilledDemandUnits / periodDays;
  const forecastDaily =
    baselineDaily * 0.7 +
    observedDaily * 0.3;

  const cover = (
    demandUnitsPerDay: number,
  ): number | null =>
    demandUnitsPerDay > 0
      ? position.availableToSellUnits /
        demandUnitsPerDay
      : null;

  const daysOfCover = [
    {
      demandBasis:
        "baseline_unconstrained_latent" as const,
      demandUnitsPerDay: baselineDaily,
      daysOfCover: cover(baselineDaily),
    },
    {
      demandBasis: "observed_fulfilled" as const,
      demandUnitsPerDay: observedDaily,
      daysOfCover: cover(observedDaily),
    },
    {
      demandBasis: "forecast_blend" as const,
      demandUnitsPerDay: forecastDaily,
      daysOfCover: cover(forecastDaily),
    },
  ];

  const baselineCover =
    daysOfCover[0]!.daysOfCover;
  const lowStock =
    position.availableToSellUnits <=
      position.safetyStockUnits ||
    (baselineCover !== null &&
      baselineCover <=
        Math.max(
          1,
          product.supplierLeadTimeSeconds /
            86_400,
        ));
  const excessStock =
    baselineCover !== null &&
    baselineCover >
      Math.max(
        60,
        (product.supplierLeadTimeSeconds /
          86_400) *
          3,
      );

  const periodEndMs = Date.parse(
    request.periodEnd,
  );
  const oldestInventoryAgeDays = Math.max(
    0,
    (periodEndMs -
      Date.parse(
        position.oldestInventoryReceivedAt,
      )) /
      DAY_MS,
  );

  const averageOnHand =
    (reconciliation.openingOnHandUnits +
      position.onHandUnits) /
    2;
  const carryingCostMinor = Math.max(
    0,
    Math.round(
      averageOnHand *
        product.cogsPerUnitMinor *
        position.carryingCostRatePerCogsValuePerDay *
        periodDays,
    ),
  );

  const obsolescenceFraction =
    position.obsolescenceRatePerDay <= 0
      ? 0
      : 1 -
        Math.exp(
          -position.obsolescenceRatePerDay *
            oldestInventoryAgeDays,
        );
  const obsolescenceEconomicLossMinor =
    Math.max(
      0,
      Math.round(
        position.onHandUnits *
          product.cogsPerUnitMinor *
          obsolescenceFraction,
      ),
    );

  const inventoryBookValueMinor =
    position.onHandUnits *
    product.cogsPerUnitMinor;
  const expectedRecoverableContributionMinor =
    Math.max(
      0,
      Math.round(
        position.availableToSellUnits *
          Math.max(
            0,
            product.expectedContributionPerUnitMinor,
          ) *
          (1 - obsolescenceFraction),
      ),
    );

  return {
    skuId: position.skuId,
    productId: product.productId,
    categoryId: product.categoryId,
    openingInventoryUnits:
      reconciliation.openingOnHandUnits,
    closingOnHandUnits: position.onHandUnits,
    closingAvailableToSellUnits:
      position.availableToSellUnits,
    reservedUnits: position.reservedUnits,
    committedUnits: position.committedUnits,
    damagedUnits: position.damagedUnits,
    inboundUnits: position.inboundUnits,
    backorderedUnits: position.backorderedUnits,
    safetyStockUnits: position.safetyStockUnits,
    reorderPointUnits: position.reorderPointUnits,
    reorderState: position.reorderState,
    ...(position.expectedArrivalAt === undefined
      ? {}
      : {
          expectedArrivalAt:
            position.expectedArrivalAt,
        }),
    ...(position.realizedArrivalAt === undefined
      ? {}
      : {
          realizedArrivalAt:
            position.realizedArrivalAt,
        }),
    latentDemandUnits,
    fulfilledDemandUnits,
    substitutedDemandUnits,
    delayedDemandUnits,
    backorderedDemandUnits,
    permanentlyLostDemandUnits,
    merchantExitDemandUnits,
    daysOfCover,
    lowStock,
    excessStock,
    experiencedStockout:
      truth.ledger.some(
        (movement) =>
          movement.skuId === product.productId &&
          movement.movementType ===
            "stockout_started",
      ),
    oldestInventoryAgeDays,
    carryingCostMinor,
    obsolescenceEconomicLossMinor,
    inventoryBookValueMinor,
    expectedRecoverableContributionMinor,
  };
}

function returnDispositions(
  report: ReturnType<
    typeof evaluateEcommerceEconomics
  >,
): InventoryDynamicsReport["returnDispositions"] {
  const profiles = new Map(
    report.productProfiles.map(
      (profile) =>
        [profile.productId, profile] as const,
    ),
  );

  return report.returns.flatMap((returned) =>
    returned.lines.map((line) => {
      const profile =
        profiles.get(line.productId);
      const damagedRate =
        profile?.nonRecoverableValueRate ?? 0;
      const damagedUnits = Math.min(
        line.quantity,
        Math.round(
          line.quantity * damagedRate,
        ),
      );
      const sellableRestockUnits =
        line.quantity - damagedUnits;
      const restockDelayDays =
        line.quantity <= 0
          ? 0
          : profile?.oversized === true
            ? 4
            : 2;

      return {
        returnId: returned.returnId,
        skuId: line.productId,
        occurredAt: returned.occurredAt,
        returnedUnits: line.quantity,
        sellableRestockUnits,
        damagedUnits,
        restockDelayDays,
      };
    }),
  );
}

function collectionHealth(
  rows: readonly InventoryHealthRow[],
): InventoryDynamicsReport["collectionHealth"] {
  const grouped = new Map<
    string,
    InventoryHealthRow[]
  >();
  for (const row of rows) {
    const list = grouped.get(row.categoryId) ?? [];
    list.push(row);
    grouped.set(row.categoryId, list);
  }

  return [...grouped.entries()]
    .map(([collectionId, items]) => ({
      collectionId,
      skuCount: items.length,
      availableUnits: items.reduce(
        (sum, row) =>
          sum + row.closingAvailableToSellUnits,
        0,
      ),
      inboundUnits: items.reduce(
        (sum, row) => sum + row.inboundUnits,
        0,
      ),
      backorderedUnits: items.reduce(
        (sum, row) => sum + row.backorderedUnits,
        0,
      ),
      lowStockSkuCount: items.filter(
        (row) => row.lowStock,
      ).length,
      excessStockSkuCount: items.filter(
        (row) => row.excessStock,
      ).length,
      latentDemandUnits: items.reduce(
        (sum, row) => sum + row.latentDemandUnits,
        0,
      ),
      fulfilledDemandUnits: items.reduce(
        (sum, row) =>
          sum + row.fulfilledDemandUnits,
        0,
      ),
      lostDemandUnits: items.reduce(
        (sum, row) =>
          sum +
          row.permanentlyLostDemandUnits +
          row.merchantExitDemandUnits,
        0,
      ),
      expectedRecoverableContributionMinor:
        items.reduce(
          (sum, row) =>
            sum +
            row.expectedRecoverableContributionMinor,
          0,
        ),
    }))
    .sort((left, right) =>
      left.collectionId.localeCompare(
        right.collectionId,
      ),
    );
}

export function evaluateInventoryDynamics(
  request: InventoryDynamicsEvaluationRequest,
): InventoryDynamicsReport {
  const ecommerce = evaluateEcommerceEconomics({
    ...request,
    enableInventoryDynamics: true,
  });
  const products = buildSkuEconomicIntelligence(
    request.merchantWorld,
    ecommerce.productProfiles,
  );
  const rows = products
    .map((product) =>
      rowFor(request, ecommerce, product),
    )
    .sort((left, right) =>
      left.skuId.localeCompare(right.skuId),
    );

  const inventoryTruth =
    ecommerce.simulation.godMode.inventory;
  if (!inventoryTruth) {
    throw new RangeError(
      "Step 9 evaluation requires inventory god mode",
    );
  }

  const inventoryCarryingCostMinor =
    rows.reduce(
      (sum, row) =>
        sum + row.carryingCostMinor,
      0,
    );
  const obsolescenceEconomicLossMinor =
    rows.reduce(
      (sum, row) =>
        sum +
        row.obsolescenceEconomicLossMinor,
      0,
    );

  return {
    version: INVENTORY_DYNAMICS_VERSION,
    merchantWorldId:
      request.merchantWorld.manifest.worldId,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    rows,
    collectionHealth: collectionHealth(rows),
    returnDispositions:
      returnDispositions(ecommerce),
    ledger: inventoryTruth.ledger,
    demandTruth: inventoryTruth.demandTruth,
    reconciliation: inventoryTruth.reconciliation,
    representedRevenueMinor:
      ecommerce.waterfall.netRevenueMinor,
    baseContributionProfitMinor:
      ecommerce.waterfall.contributionProfitMinor,
    inventoryCarryingCostMinor,
    contributionProfitAfterInventoryCarryingMinor:
      ecommerce.waterfall.contributionProfitMinor -
      inventoryCarryingCostMinor,
    obsolescenceEconomicLossMinor,
    godModeOnly: true,
  };
}

export function inventoryConstrainedResponseCurve(
  request: InventoryDynamicsEvaluationRequest,
  channel: MarketingChannel,
  spendLevelsMinor: readonly number[],
): InventoryResponseCurve {
  const points = [...spendLevelsMinor]
    .map((value) =>
      Math.max(0, Math.round(value)),
    )
    .sort((left, right) => left - right)
    .map((spendMinor) => {
      const interventions = appendIntervention(
        request.interventions,
        spendIntervention(
          channel,
          spendMinor,
        ),
      );
      const constrained =
        evaluateInventoryDynamics({
          ...request,
          interventions,
        });
      const unconstrained =
        evaluateInventoryDynamics({
          ...request,
          interventions: appendIntervention(
            interventions,
            unconstrainedInventoryIntervention(),
          ),
        });

      return {
        spendMinor,
        unconstrainedContributionProfitMinor:
          unconstrained.baseContributionProfitMinor,
        inventoryConstrainedContributionProfitMinor:
          constrained.baseContributionProfitMinor,
        unconstrainedRevenueMinor:
          unconstrained.representedRevenueMinor,
        inventoryConstrainedRevenueMinor:
          constrained.representedRevenueMinor,
        contributionConstraintCostMinor:
          unconstrained.baseContributionProfitMinor -
          constrained.baseContributionProfitMinor,
      };
    });

  return { channel, points };
}

export function evaluateLostSalesCounterfactual(
  request: InventoryDynamicsEvaluationRequest,
): LostSalesCounterfactual {
  const actual =
    evaluateInventoryDynamics(request);
  const unconstrained =
    evaluateInventoryDynamics({
      ...request,
      interventions: appendIntervention(
        request.interventions,
        unconstrainedInventoryIntervention(),
      ),
    });

  const latentLostUnits = actual.rows.reduce(
    (sum, row) =>
      sum +
      row.permanentlyLostDemandUnits +
      row.merchantExitDemandUnits,
    0,
  );

  return {
    actual,
    unconstrained,
    latentLostUnits,
    lostRevenueMinor:
      unconstrained.representedRevenueMinor -
      actual.representedRevenueMinor,
    lostContributionMinor:
      unconstrained.baseContributionProfitMinor -
      actual.baseContributionProfitMinor,
    substitutedUnits: actual.rows.reduce(
      (sum, row) =>
        sum + row.substitutedDemandUnits,
      0,
    ),
    delayedUnits: actual.rows.reduce(
      (sum, row) =>
        sum + row.delayedDemandUnits,
      0,
    ),
    backorderedUnits: actual.rows.reduce(
      (sum, row) =>
        sum + row.backorderedDemandUnits,
      0,
    ),
  };
}

export function estimateTrueStockoutProbability(
  request: InventoryDynamicsEvaluationRequest,
  skuId: string,
  simulationSeeds: readonly number[],
): InventoryStockoutProbability {
  if (simulationSeeds.length === 0) {
    throw new RangeError(
      "stockout probability requires at least one simulation seed",
    );
  }

  let stockoutCount = 0;
  for (const simulationSeed of simulationSeeds) {
    const report = evaluateInventoryDynamics({
      ...request,
      simulationSeed,
    });
    const row = report.rows.find(
      (candidate) => candidate.skuId === skuId,
    );
    if (!row) {
      throw new RangeError(
        "unknown inventory SKU: " + skuId,
      );
    }
    if (row.experiencedStockout) {
      stockoutCount += 1;
    }
  }

  return {
    skuId,
    simulationCount: simulationSeeds.length,
    stockoutCount,
    trueSimulatedStockoutProbability:
      stockoutCount / simulationSeeds.length,
  };
}

function withLeadTimeDays(
  world: GeneratedMerchantWorld,
  skuId: string,
  leadTimeDays: number,
): GeneratedMerchantWorld {
  const clone =
    structuredClone(world) as GeneratedMerchantWorld;
  const mechanism =
    clone.manifest.inventoryMechanisms.find(
      (candidate) =>
        candidate.productId === skuId,
    );
  if (!mechanism) {
    throw new RangeError(
      "unknown replenishment SKU: " + skuId,
    );
  }

  (
    mechanism as unknown as {
      supplierLeadTimeSeconds: number;
    }
  ).supplierLeadTimeSeconds =
    Math.max(0, leadTimeDays) * 86_400;
  return clone;
}

export function evaluateReplenishmentDelayCounterfactual(
  request: InventoryDynamicsEvaluationRequest,
  skuId: string,
  expectedLeadTimeDays: number,
  delayedLeadTimeDays: number,
): ReplenishmentCounterfactual {
  const onTime = evaluateInventoryDynamics({
    ...request,
    merchantWorld: withLeadTimeDays(
      request.merchantWorld,
      skuId,
      expectedLeadTimeDays,
    ),
  });
  const delayed = evaluateInventoryDynamics({
    ...request,
    merchantWorld: withLeadTimeDays(
      request.merchantWorld,
      skuId,
      delayedLeadTimeDays,
    ),
  });

  const lost = (
    report: InventoryDynamicsReport,
  ): number => {
    const row = report.rows.find(
      (candidate) => candidate.skuId === skuId,
    );
    return row
      ? row.permanentlyLostDemandUnits +
          row.merchantExitDemandUnits
      : 0;
  };

  return {
    skuId,
    expectedLeadTimeDays,
    delayedLeadTimeDays,
    onTimeContributionProfitMinor:
      onTime
        .contributionProfitAfterInventoryCarryingMinor,
    delayedContributionProfitMinor:
      delayed
        .contributionProfitAfterInventoryCarryingMinor,
    delayContributionCostMinor:
      onTime
        .contributionProfitAfterInventoryCarryingMinor -
      delayed
        .contributionProfitAfterInventoryCarryingMinor,
    onTimeLostUnits: lost(onTime),
    delayedLostUnits: lost(delayed),
  };
}

function withPeriodEnd(
  request: InventoryDynamicsEvaluationRequest,
  daysFromStart: number,
): InventoryDynamicsEvaluationRequest {
  const end = new Date(
    Date.parse(request.periodStart) +
      Math.max(0, daysFromStart) * DAY_MS,
  ).toISOString();
  return {
    ...request,
    periodEnd:
      Date.parse(end) <
      Date.parse(request.periodEnd)
        ? end
        : request.periodEnd,
  };
}

export function evaluatePromotionStockoutCounterfactual(
  request: InventoryDynamicsEvaluationRequest,
  shortWindowDays = 14,
): PromotionStockoutCounterfactual {
  const promotedInterventions =
    appendIntervention(
      request.interventions,
      promotionIntervention(true),
    );
  const fullPriceInterventions =
    appendIntervention(
      request.interventions,
      promotionIntervention(false),
    );

  const promotedShort =
    evaluateInventoryDynamics({
      ...withPeriodEnd(
        request,
        shortWindowDays,
      ),
      interventions: promotedInterventions,
    });
  const fullPriceShort =
    evaluateInventoryDynamics({
      ...withPeriodEnd(
        request,
        shortWindowDays,
      ),
      interventions: fullPriceInterventions,
    });
  const promotedFull =
    evaluateInventoryDynamics({
      ...request,
      interventions: promotedInterventions,
    });
  const fullPriceFull =
    evaluateInventoryDynamics({
      ...request,
      interventions: fullPriceInterventions,
    });

  return {
    shortWindowDays,
    promotedShortWindowRevenueMinor:
      promotedShort.representedRevenueMinor,
    fullPriceShortWindowRevenueMinor:
      fullPriceShort.representedRevenueMinor,
    shortWindowRevenueLiftMinor:
      promotedShort.representedRevenueMinor -
      fullPriceShort.representedRevenueMinor,
    promotedFullHorizonContributionMinor:
      promotedFull
        .contributionProfitAfterInventoryCarryingMinor,
    fullPriceFullHorizonContributionMinor:
      fullPriceFull
        .contributionProfitAfterInventoryCarryingMinor,
    fullHorizonContributionDeltaMinor:
      promotedFull
        .contributionProfitAfterInventoryCarryingMinor -
      fullPriceFull
        .contributionProfitAfterInventoryCarryingMinor,
  };
}

export function evaluateScarceInventoryOpportunityCost(
  request: InventoryDynamicsEvaluationRequest,
  skuId: string,
  intervention: Intervention,
): ScarceInventoryOpportunityCost {
  const factual = evaluateInventoryDynamics({
    ...request,
    interventions: appendIntervention(
      request.interventions,
      intervention,
    ),
  });
  const baseline =
    evaluateInventoryDynamics(request);

  const factualProduct =
    factual.rows.find(
      (row) => row.skuId === skuId,
    );
  if (!factualProduct) {
    throw new RangeError(
      "unknown scarce-inventory SKU: " + skuId,
    );
  }

  const accountingContribution =
    factual.baseContributionProfitMinor -
    factual.inventoryCarryingCostMinor;
  const counterfactualContribution =
    baseline.baseContributionProfitMinor -
    baseline.inventoryCarryingCostMinor;

  return {
    skuId,
    accountingContributionFromInterventionMinor:
      accountingContribution,
    counterfactualContributionWithoutInterventionMinor:
      counterfactualContribution,
    counterfactualOpportunityCostMinor:
      counterfactualContribution -
      accountingContribution,
  };
}
