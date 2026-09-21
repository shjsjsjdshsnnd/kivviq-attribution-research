import { nonNegative } from "../core/units.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import {
  createLowInventoryProductRoasTrapFixture,
  createSelloutSubstitutionTrapFixture,
} from "../product_economics/adversarial.js";
import {
  createDiscountTrapFixture,
} from "../ecommerce_economics/adversarial.js";
import type {
  InventoryDynamicsEvaluationRequest,
} from "./types.js";

export interface StockoutObservedDemandTrapFixture {
  readonly id: "stockout_observed_demand";
  readonly evaluation: InventoryDynamicsEvaluationRequest;
  readonly stockoutSkuId: string;
  readonly substituteSkuId: string;
}

export interface InventoryAdvertisingScaleTrapFixture {
  readonly id: "inventory_advertising_scale";
  readonly evaluation: InventoryDynamicsEvaluationRequest;
  readonly productId: string;
  readonly channel: "meta";
  readonly baselineSpendMinor: number;
  readonly platformCampaignSpendMinor: number;
  readonly spendLevelsMinor: readonly number[];
}

export interface PromotionStockoutTrapFixture {
  readonly id: "promotion_stockout";
  readonly evaluation: InventoryDynamicsEvaluationRequest;
  readonly shortWindowDays: number;
}

function makeSupplyScarce(
  source: GeneratedMerchantWorld,
  options: {
    readonly targetProductId?: string;
    readonly targetUnits?: number;
    readonly defaultUnits: number;
    readonly leadTimeDays: number;
  },
): GeneratedMerchantWorld {
  const world =
    structuredClone(source) as GeneratedMerchantWorld;
  for (const inventory of world.manifest
    .inventoryMechanisms as unknown as Array<{
      productId: string;
      initialAvailableUnits: unknown;
      initialReservedUnits: unknown;
      replenishmentUnits: unknown;
      supplierLeadTimeSeconds: unknown;
      replenishmentEverySeconds?: unknown;
      allowBackorders: boolean;
      stockoutBehavior:
        | "lost_demand"
        | "substitute"
        | "backorder";
    }>) {
    const units =
      inventory.productId ===
        options.targetProductId &&
      options.targetUnits !== undefined
        ? options.targetUnits
        : options.defaultUnits;
    inventory.initialAvailableUnits =
      nonNegative(Math.max(0, units));
    inventory.initialReservedUnits =
      nonNegative(0);
    inventory.replenishmentUnits =
      nonNegative(0);
    inventory.supplierLeadTimeSeconds =
      options.leadTimeDays * 86_400;
    inventory.allowBackorders = false;
    if (inventory.stockoutBehavior === "backorder") {
      inventory.stockoutBehavior = "substitute";
    }
    delete inventory.replenishmentEverySeconds;
  }
  validateGroundTruthManifest(world.manifest);
  return world;
}

export function createStockoutObservedDemandTrapFixture(): StockoutObservedDemandTrapFixture {
  const source =
    createSelloutSubstitutionTrapFixture();
  const world =
    makeSupplyScarce(source.merchantWorld, {
      targetProductId: source.soldOutProductId,
      targetUnits: 1,
      defaultUnits: 120,
      leadTimeDays: 365,
    });

  return {
    id: "stockout_observed_demand",
    stockoutSkuId: source.soldOutProductId,
    substituteSkuId: source.substituteProductId,
    evaluation: {
      merchantWorld: world,
      latentPopulation: source.latentPopulation,
      simulationSeed: 199001,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-03-15T00:00:00.000Z",
      enableInventoryDynamics: true,
      simulationConfig: {
        maxEvents: 220_000,
        maxSessionsPerCustomer: 18,
      },
    },
  };
}

export function createInventoryAdvertisingScaleTrapFixture(): InventoryAdvertisingScaleTrapFixture {
  const source =
    createLowInventoryProductRoasTrapFixture();
  const world =
    makeSupplyScarce(source.merchantWorld, {
      targetProductId: source.productId,
      targetUnits: 17,
      defaultUnits: 2,
      leadTimeDays: 365,
    });

  const baselineSpendMinor =
    source.channelSpendMinor;
  return {
    id: "inventory_advertising_scale",
    productId: source.productId,
    channel: "meta",
    baselineSpendMinor,
    platformCampaignSpendMinor:
      source.campaignSpendMinor,
    spendLevelsMinor: [
      baselineSpendMinor,
      baselineSpendMinor + 25_000,
      baselineSpendMinor + 75_000,
      baselineSpendMinor + 150_000,
      baselineSpendMinor + 300_000,
      baselineSpendMinor + 500_000,
    ],
    evaluation: {
      merchantWorld: world,
      latentPopulation: source.latentPopulation,
      simulationSeed: 199002,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
      enableInventoryDynamics: true,
      simulationConfig: {
        maxEvents: 240_000,
        maxSessionsPerCustomer: 18,
      },
    },
  };
}

export function createPromotionStockoutTrapFixture(): PromotionStockoutTrapFixture {
  const source = createDiscountTrapFixture();
  const world =
    makeSupplyScarce(source.merchantWorld, {
      defaultUnits: 8,
      leadTimeDays: 365,
    });

  return {
    id: "promotion_stockout",
    shortWindowDays: 21,
    evaluation: {
      ...source.evaluation,
      merchantWorld: world,
      enableInventoryDynamics: true,
      simulationSeed: 199003,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-05-01T00:00:00.000Z",
      simulationConfig: {
        maxEvents: 240_000,
        maxSessionsPerCustomer: 20,
      },
    },
  };
}
