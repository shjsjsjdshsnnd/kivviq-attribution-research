import { generateCustomerPopulation } from "../customer_population/generator.js";
import { moneyMinor, positive } from "../core/units.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import type {
  AdvertisingEvaluationRequest,
  PaidMarketingChannel,
} from "./types.js";

function replaceOrderResponseCurve(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
  options: {
    readonly effectOrders: number;
    readonly maxIncrementalOrders: number;
    readonly halfSaturationSpendMinor: number;
    readonly hillCoefficient: number;
  },
): GeneratedMerchantWorld {
  const clone = structuredClone(world) as unknown as {
    manifest: {
      channelIncrementality: Array<{
        channelId: string;
        effect: { value: number };
        responseCurveId?: string;
      }>;
      responseCurves: Array<Record<string, unknown>>;
    };
  } & GeneratedMerchantWorld;

  const mechanism =
    clone.manifest.channelIncrementality.find(
      (candidate) => candidate.channelId === channel,
    );
  if (!mechanism?.responseCurveId) {
    throw new RangeError(
      `channel ${channel} is unavailable in adversarial fixture`,
    );
  }

  mechanism.effect.value = options.effectOrders;

  const index = clone.manifest.responseCurves.findIndex(
    (curve) => curve["id"] === mechanism.responseCurveId,
  );
  if (index < 0) {
    throw new RangeError(
      `missing response curve for ${channel}`,
    );
  }

  clone.manifest.responseCurves[index] = {
    id: mechanism.responseCurveId,
    kind: "hill",
    inputUnit: "money_minor",
    outputUnit: "orders",
    maxIncrementalOutcome: positive(
      Math.max(0.001, options.maxIncrementalOrders),
    ),
    halfSaturationSpend: moneyMinor(
      Math.max(1, Math.round(options.halfSaturationSpendMinor)),
    ),
    hillCoefficient: positive(
      Math.max(0.2, options.hillCoefficient),
    ),
  };

  validateGroundTruthManifest(clone.manifest);
  return clone;
}

function buildPopulation(
  world: GeneratedMerchantWorld,
  seed: number,
  maxExplicitAgents = 120,
): LatentCustomerPopulation {
  return generateCustomerPopulation({
    merchantWorld: world,
    populationSeed: seed,
    populationConfig: {
      maxExplicitAgents,
      complexity: "adversarial",
    },
  });
}

export interface AdvertisingAdversarialFixture {
  readonly id: "vanity_roas_trap" | "retargeting_trap";
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly evaluation: AdvertisingEvaluationRequest;
  readonly expectedTrapChannel: PaidMarketingChannel;
}

export function createVanityRoasTrapFixture(): AdvertisingAdversarialFixture {
  let world = generateMerchantWorldRecord({
    seed: 85001,
    archetype: "fashion_apparel",
    scale: "growth",
    complexity: "adversarial",
    marketingDependence: "paid_media_heavy",
    overrides: {
      forceZeroIncrementalityChannels: [
        "meta",
        "google_search",
        "pinterest",
      ],
    },
  });

  const monthlyOrders =
    world.summary.expectedAnnualOrders / 12;

  world = replaceOrderResponseCurve(world, "meta", {
    effectOrders: monthlyOrders * 0.025,
    maxIncrementalOrders: monthlyOrders * 0.12,
    halfSaturationSpendMinor: 45_000,
    hillCoefficient: 1.7,
  });
  world = replaceOrderResponseCurve(world, "google_search", {
    effectOrders: monthlyOrders * 0.6,
    maxIncrementalOrders: monthlyOrders * 1.2,
    halfSaturationSpendMinor: 350_000,
    hillCoefficient: 1.05,
  });
  world = replaceOrderResponseCurve(world, "pinterest", {
    effectOrders: monthlyOrders * 0.4,
    maxIncrementalOrders: monthlyOrders * 0.9,
    halfSaturationSpendMinor: 300_000,
    hillCoefficient: 1.1,
  });

  const population = buildPopulation(world, 95101, 130);

  return {
    id: "vanity_roas_trap",
    merchantWorld: world,
    latentPopulation: population,
    expectedTrapChannel: "meta",
    evaluation: {
      merchantWorld: world,
      latentPopulation: population,
      simulationSeed: 105001,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-05-01T00:00:00.000Z",
      spendMinorByChannel: {
        meta: 55_000,
        google_search: 420_000,
        pinterest: 340_000,
      },
      marginalBlockMinor: 150_000,
      simulationConfig: {
        maxEvents: 180_000,
        maxSessionsPerCustomer: 18,
      },
    },
  };
}

export function createRetargetingTrapFixture(): AdvertisingAdversarialFixture {
  let world = generateMerchantWorldRecord({
    seed: 85002,
    archetype: "beauty_cosmetics",
    scale: "growth",
    complexity: "adversarial",
    marketingDependence: "retention_heavy",
    purchaseFrequency: "repeat",
    overrides: {
      forceZeroIncrementalityChannels: [
        "meta",
        "google_search",
      ],
    },
  });

  const monthlyOrders =
    world.summary.expectedAnnualOrders / 12;

  world = replaceOrderResponseCurve(world, "meta", {
    effectOrders: monthlyOrders * 0.015,
    maxIncrementalOrders: monthlyOrders * 0.08,
    halfSaturationSpendMinor: 38_000,
    hillCoefficient: 1.8,
  });
  world = replaceOrderResponseCurve(world, "google_search", {
    effectOrders: monthlyOrders * 0.22,
    maxIncrementalOrders: monthlyOrders * 0.55,
    halfSaturationSpendMinor: 240_000,
    hillCoefficient: 1.05,
  });

  const population = buildPopulation(world, 95002, 130);

  return {
    id: "retargeting_trap",
    merchantWorld: world,
    latentPopulation: population,
    expectedTrapChannel: "meta",
    evaluation: {
      merchantWorld: world,
      latentPopulation: population,
      simulationSeed: 105002,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-05-01T00:00:00.000Z",
      spendMinorByChannel: {
        meta: 45_000,
        google_search: 260_000,
      },
      marginalBlockMinor: 20_000,
      simulationConfig: {
        maxEvents: 180_000,
        maxSessionsPerCustomer: 18,
      },
    },
  };
}
