import {
  validateIntervention,
  type Intervention,
} from "../ground_truth/interventions.js";
import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";

export interface SimulationInterventionState {
  readonly channelSpendScale: ReadonlyMap<MarketingChannel, number>;
  readonly priceOverrideMinor?: number;
  readonly promotionActive?: boolean;
  readonly inventoryOverrideUnits?: number;
}

function baselineSpendProxy(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
): number {
  const mechanism = world.manifest.channelIncrementality.find(
    (candidate) => candidate.channelId === channel,
  );
  const curve = mechanism?.responseCurveId
    ? world.manifest.responseCurves.find(
        (candidate) => candidate.id === mechanism.responseCurveId,
      )
    : undefined;

  if (!curve) {
    return Math.max(
      1,
      Math.round(
        (world.summary.annualRevenuePotentialMinor *
          world.summary.marketingSpendRate) /
          12 /
          Math.max(1, world.summary.activeChannels.length),
      ),
    );
  }

  if (curve.kind === "hill") {
    return Math.max(1, Number(curve.halfSaturationSpend));
  }
  if (curve.kind === "threshold") {
    return Math.max(1, Number(curve.thresholdSpend));
  }
  if (curve.kind === "linear") {
    return Math.max(1, Number(curve.maxSpend ?? 100_000));
  }
  const nonZero = curve.points.find((point) => Number(point.spend) > 0);
  return Math.max(1, Number(nonZero?.spend ?? 100_000));
}

function parseSpendVariable(variable: string): MarketingChannel | undefined {
  const match = /^marketing.([a-z_]+).spend$/.exec(variable);
  if (!match) return undefined;
  return match[1] as MarketingChannel;
}

export function buildSimulationInterventionState(
  world: GeneratedMerchantWorld,
  interventions: readonly Intervention[],
): SimulationInterventionState {
  const channelSpendScale = new Map<MarketingChannel, number>();

  for (const channel of world.summary.activeChannels) {
    channelSpendScale.set(channel, 1);
  }

  let priceOverrideMinor: number | undefined;
  let promotionActive: boolean | undefined;
  let inventoryOverrideUnits: number | undefined;

  for (const intervention of interventions) {
    validateIntervention(world.manifest.causalGraph, intervention);

    const spendChannel = parseSpendVariable(intervention.variable);
    if (spendChannel) {
      if (intervention.value.kind !== "number") {
        throw new RangeError("marketing spend intervention must be numeric");
      }
      const baseline = baselineSpendProxy(world, spendChannel);
      channelSpendScale.set(
        spendChannel,
        Math.max(0, intervention.value.value / baseline),
      );
      continue;
    }

    if (intervention.variable === "pricing.product_price") {
      if (intervention.value.kind !== "number") {
        throw new RangeError("price intervention must be numeric");
      }
      priceOverrideMinor = Math.max(1, Math.round(intervention.value.value));
      continue;
    }

    if (intervention.variable === "promotion.discount_active") {
      if (intervention.value.kind !== "boolean") {
        throw new RangeError("promotion intervention must be boolean");
      }
      promotionActive = intervention.value.value;
      continue;
    }

    if (intervention.variable === "inventory.available") {
      if (intervention.value.kind !== "number") {
        throw new RangeError("inventory intervention must be numeric");
      }
      inventoryOverrideUnits = Math.max(
        0,
        Math.floor(intervention.value.value),
      );
      continue;
    }

    throw new RangeError(
      `Step 4 does not yet execute intervention target ${intervention.variable}`,
    );
  }

  return {
    channelSpendScale,
    ...(priceOverrideMinor === undefined ? {} : { priceOverrideMinor }),
    ...(promotionActive === undefined ? {} : { promotionActive }),
    ...(inventoryOverrideUnits === undefined
      ? {}
      : { inventoryOverrideUnits }),
  };
}
