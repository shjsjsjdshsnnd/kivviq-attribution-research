import { generateCustomerPopulation } from "../customer_population/generator.js";
import {
  nonNegative,
} from "../core/units.js";
import { createVanityRoasTrapFixture } from "../advertising_economics/adversarial.js";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { PaidMarketingChannel } from "../advertising_economics/types.js";

export interface LowInventoryProductRoasFixture {
  readonly id: "low_inventory_product_roas";
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly productId: string;
  readonly channel: PaidMarketingChannel;
  readonly channelSpendMinor: number;
  readonly campaignSpendMinor: number;
  readonly proposedAdditionalSpendMinor: number;
}

export interface SelloutSubstitutionTrapFixture {
  readonly id: "sellout_substitution";
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly soldOutProductId: string;
  readonly substituteProductId: string;
}

function populationFor(
  world: GeneratedMerchantWorld,
  populationSeed: number,
  maxExplicitAgents = 160,
): LatentCustomerPopulation {
  let lastError: unknown;
  for (let offset = 0; offset < 24; offset += 1) {
    try {
      return generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: populationSeed + offset,
        populationConfig: {
          maxExplicitAgents,
          complexity: world.summary.complexity,
          maxCategoryPreferences: 4,
          maxProductPreferences: 8,
        },
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("unable to generate schema-valid Step 8 fixture population");
}

export function createLowInventoryProductRoasTrapFixture(): LowInventoryProductRoasFixture {
  const step5 = createVanityRoasTrapFixture();
  const world = structuredClone(
    step5.merchantWorld,
  ) as GeneratedMerchantWorld;

  const ranked = [...world.manifest.productDemandMechanisms]
    .sort(
      (left, right) =>
        Number(right.baseLatentDemandUnits) -
        Number(left.baseLatentDemandUnits),
    );
  const product = ranked[0]!;
  const inventory = (
    world.manifest.inventoryMechanisms as unknown as Array<{
      productId: string;
      initialAvailableUnits: unknown;
      initialReservedUnits: unknown;
      replenishmentUnits: unknown;
      allowBackorders: boolean;
      stockoutBehavior: string;
      replenishmentEverySeconds?: unknown;
    }>
  ).find(
    (candidate) =>
      candidate.productId === product.productId,
  );
  if (!inventory) {
    throw new RangeError(
      "low-inventory fixture product has no inventory mechanism",
    );
  }

  inventory.initialAvailableUnits = nonNegative(17);
  inventory.initialReservedUnits = nonNegative(0);
  inventory.replenishmentUnits = nonNegative(0);
  inventory.allowBackorders = false;
  inventory.stockoutBehavior = "lost_demand";
  delete inventory.replenishmentEverySeconds;

  validateGroundTruthManifest(world.manifest);

  return {
    id: "low_inventory_product_roas",
    merchantWorld: world,
    latentPopulation: populationFor(
      world,
      98001,
      180,
    ),
    productId: product.productId,
    channel: "meta",
    channelSpendMinor:
      step5.evaluation.spendMinorByChannel?.meta ?? 55_000,
    campaignSpendMinor: 25_000,
    proposedAdditionalSpendMinor: 500_000,
  };
}

export function createSelloutSubstitutionTrapFixture(): SelloutSubstitutionTrapFixture {
  const base = generateMerchantWorldRecord({
    seed: 88002,
    archetype: "specialty_retail",
    scale: "growth",
    complexity: "adversarial",
    catalogProfile: "moderate",
  });
  const world = structuredClone(
    base,
  ) as GeneratedMerchantWorld;

  const demand = (
    world.manifest.productDemandMechanisms as unknown as Array<{
      productId: string;
      categoryId: string;
      baseLatentDemandUnits: number;
      substitutionProductIds?: readonly string[];
      complementaryProductIds?: readonly string[];
    }>
  );
  const ranked = [...demand].sort(
    (left, right) =>
      Number(right.baseLatentDemandUnits) -
      Number(left.baseLatentDemandUnits),
  );
  if (ranked.length < 2) {
    throw new RangeError(
      "sellout substitution fixture requires two products",
    );
  }

  const source = ranked[0]!;
  const target = ranked[1]!;

  source.baseLatentDemandUnits =
    Math.max(
      Number(source.baseLatentDemandUnits),
      Number(target.baseLatentDemandUnits) * 4,
    );
  source.substitutionProductIds = [
    target.productId,
  ];

  const inventories =
    world.manifest.inventoryMechanisms as unknown as Array<{
      productId: string;
      initialAvailableUnits: unknown;
      initialReservedUnits: unknown;
      replenishmentUnits: unknown;
      allowBackorders: boolean;
      stockoutBehavior: string;
      substituteProductIds?: readonly string[];
    }>;

  const sourceInventory = inventories.find(
    (candidate) =>
      candidate.productId === source.productId,
  );
  const targetInventory = inventories.find(
    (candidate) =>
      candidate.productId === target.productId,
  );
  if (!sourceInventory || !targetInventory) {
    throw new RangeError(
      "sellout substitution fixture is missing inventory",
    );
  }

  sourceInventory.initialAvailableUnits =
    nonNegative(500);
  sourceInventory.initialReservedUnits =
    nonNegative(0);
  sourceInventory.replenishmentUnits =
    nonNegative(0);
  sourceInventory.allowBackorders = false;
  sourceInventory.stockoutBehavior = "substitute";
  sourceInventory.substituteProductIds = [
    target.productId,
  ];

  targetInventory.initialAvailableUnits =
    nonNegative(500);
  targetInventory.initialReservedUnits =
    nonNegative(0);
  targetInventory.allowBackorders = false;

  validateGroundTruthManifest(world.manifest);

  return {
    id: "sellout_substitution",
    merchantWorld: world,
    latentPopulation: populationFor(
      world,
      98002,
      220,
    ),
    soldOutProductId: source.productId,
    substituteProductId: target.productId,
  };
}
