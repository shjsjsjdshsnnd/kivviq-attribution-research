import {
  serializeGroundTruthManifest,
} from "../ground_truth/manifest.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import {
  configSeed,
  SeededRandom,
} from "../generation/rng.js";
import {
  calibrateBoundedMean,
  calibratePositiveMean,
  calibrateProbabilityMean,
  calibratePurchaseWeightedAov,
  calibrationMetric,
  clamp,
  PopulationCalibrationError,
  purchaseWeightedMean,
  sigmoid,
  weightedMean,
} from "./calibration.js";
import {
  buildPreferenceCatalogIndex,
  generateSparsePreferences,
} from "./preferences.js";
import {
  CUSTOMER_POPULATION_GENERATOR_VERSION,
  type CalibrationMetric,
  type ChannelLatentTrait,
  type CustomerPopulationConfig,
  type CustomerPopulationRequest,
  type DerivedCustomerSegment,
  type DevicePreference,
  type LatentCustomer,
  type LatentCustomerPopulation,
  type LatentFactorState,
  type LatentLifecycle,
  type NaturalSelectionPropensities,
  type PopulationCalibrationReport,
} from "./types.js";
import { validateLatentCustomerPopulation } from "./validation.js";

interface CandidateCustomer {
  readonly customerId: string;
  readonly populationWeight: number;
  readonly factors: LatentFactorState;
  purchaseIntent: number;
  currentPurchaseNeed: number;
  priceSensitivityMultiplier: number;
  promotionSensitivityMultiplier: number;
  brandAffinity: number;
  repeatPropensity: number;
  expectedPurchaseIntervalDays: number;
  mobileProbability: number;
  organicDiscoveryProbability: number;
  expectedFuturePurchases: number;
  expectedOrderValueMinor: number;
  acquisitionCostMultiplier: number;
  expectedLifetimeValueMinor: number;
  annualPurchaseHazard: number;
  naturalSelection: NaturalSelectionPropensities;
  channelEffectMultipliers: Map<MarketingChannel, number>;
  channelUseProbabilities: Map<MarketingChannel, number>;
}

const DEFAULT_AGENT_LIMIT: Readonly<Record<
  GeneratedMerchantWorld["summary"]["complexity"],
  number
>> = {
  simple: 800,
  normal: 1_500,
  complex: 2_500,
  adversarial: 4_000,
};

const HETEROGENEITY: Readonly<Record<
  GeneratedMerchantWorld["summary"]["complexity"],
  number
>> = {
  simple: 0.55,
  normal: 1,
  complex: 1.3,
  adversarial: 1.65,
};

const SELECTION_STRENGTH: Readonly<Record<
  GeneratedMerchantWorld["summary"]["complexity"],
  number
>> = {
  simple: 0.45,
  normal: 0.8,
  complex: 1.1,
  adversarial: 1.45,
};

const OUTLIER_PROBABILITY: Readonly<Record<
  GeneratedMerchantWorld["summary"]["complexity"],
  number
>> = {
  simple: 0.006,
  normal: 0.02,
  complex: 0.055,
  adversarial: 0.1,
};

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function merchantFingerprint(world: GeneratedMerchantWorld): string {
  return [
    world.manifest.schemaVersion,
    world.manifest.simulatorVersion,
    world.manifest.worldId,
    world.manifest.seed,
    fingerprint(serializeGroundTruthManifest(world.manifest)),
  ].join(":");
}

function validateRequest(request: CustomerPopulationRequest): void {
  if (
    !Number.isSafeInteger(request.populationSeed) ||
    request.populationSeed < 0
  ) {
    throw new RangeError(
      "populationSeed must be a non-negative safe integer",
    );
  }

  const config = request.populationConfig;
  if (
    config?.maxExplicitAgents !== undefined &&
    (!Number.isInteger(config.maxExplicitAgents) ||
      config.maxExplicitAgents < 10 ||
      config.maxExplicitAgents > 50_000)
  ) {
    throw new RangeError(
      "maxExplicitAgents must be an integer within [10,50000]",
    );
  }
  if (
    config?.maxCategoryPreferences !== undefined &&
    (!Number.isInteger(config.maxCategoryPreferences) ||
      config.maxCategoryPreferences < 1 ||
      config.maxCategoryPreferences > 12)
  ) {
    throw new RangeError(
      "maxCategoryPreferences must be an integer within [1,12]",
    );
  }
  if (
    config?.maxProductPreferences !== undefined &&
    (!Number.isInteger(config.maxProductPreferences) ||
      config.maxProductPreferences < 1 ||
      config.maxProductPreferences > 24)
  ) {
    throw new RangeError(
      "maxProductPreferences must be an integer within [1,24]",
    );
  }
  if (
    config?.calibrationTolerance !== undefined &&
    (!Number.isFinite(config.calibrationTolerance) ||
      config.calibrationTolerance <= 0 ||
      config.calibrationTolerance > 0.01)
  ) {
    throw new RangeError(
      "calibrationTolerance must be finite and within (0,0.01]",
    );
  }
}

function resolvedComplexity(
  world: GeneratedMerchantWorld,
  config: CustomerPopulationConfig | undefined,
): GeneratedMerchantWorld["summary"]["complexity"] {
  if (!config?.complexity || config.complexity === "inherit") {
    return world.summary.complexity;
  }
  return config.complexity;
}

function factorState(
  world: GeneratedMerchantWorld,
  complexity: GeneratedMerchantWorld["summary"]["complexity"],
  rng: SeededRandom,
): LatentFactorState {
  const h = HETEROGENEITY[complexity];

  let dealOrientation = rng.normal(0, h);
  let brandAttachment =
    0.68 * rng.normal(0, h) - 0.22 * dealOrientation;
  let loyaltyTendency =
    0.52 * brandAttachment + 0.72 * rng.normal(0, h);
  let purchaseUrgency = rng.normal(0, h);
  let categoryInvolvement = rng.normal(0, h);
  let marketingReceptivity =
    0.18 * dealOrientation + rng.normal(0, h);
  let digitalBehavior = rng.normal(0, h);
  let explorationTendency =
    0.28 * categoryInvolvement + 0.76 * rng.normal(0, h);

  if (
    world.summary.businessModel === "replenishment" ||
    world.summary.businessModel === "subscription"
  ) {
    loyaltyTendency += 0.35;
    purchaseUrgency += 0.18;
  }
  if (
    world.summary.promotionProfile === "promotion_heavy" ||
    world.summary.promotionProfile === "clearance_heavy"
  ) {
    dealOrientation += 0.35;
  }
  if (world.summary.promotionProfile === "full_price_dominant") {
    dealOrientation -= 0.3;
  }
  if (world.summary.archetype === "luxury") {
    brandAttachment += 0.25;
    dealOrientation -= 0.28;
  }

  if (rng.bool(OUTLIER_PROBABILITY[complexity])) {
    const outlier = rng.pick([
      "extreme_loyalty",
      "bargain_hunter",
      "advertising_resistant",
      "high_value",
      "mobile_only",
      "promotion_averse",
    ] as const);
    if (outlier === "extreme_loyalty") {
      brandAttachment += 2.5;
      loyaltyTendency += 2.6;
    } else if (outlier === "bargain_hunter") {
      dealOrientation += 2.8;
      brandAttachment -= 0.55;
    } else if (outlier === "advertising_resistant") {
      marketingReceptivity -= 3;
    } else if (outlier === "high_value") {
      categoryInvolvement += 2.2;
      loyaltyTendency += 1.5;
    } else if (outlier === "mobile_only") {
      digitalBehavior += 3.2;
    } else if (outlier === "promotion_averse") {
      dealOrientation -= 2.7;
      brandAttachment += 1.3;
    }
  }

  return {
    purchaseUrgency,
    brandAttachment,
    dealOrientation,
    categoryInvolvement,
    marketingReceptivity,
    loyaltyTendency,
    digitalBehavior,
    explorationTendency,
  };
}

function initialCandidate(
  world: GeneratedMerchantWorld,
  complexity: GeneratedMerchantWorld["summary"]["complexity"],
  customerId: string,
  populationWeight: number,
  rng: SeededRandom,
): CandidateCustomer {
  const factors = factorState(world, complexity, rng);
  const needShift =
    world.summary.businessModel === "replenishment" ||
    world.summary.businessModel === "subscription"
      ? 0.38
      : world.summary.businessModel === "one_off"
        ? -0.18
        : 0;

  const currentPurchaseNeed = sigmoid(
    factors.purchaseUrgency * 0.95 +
      factors.categoryInvolvement * 0.24 +
      needShift +
      rng.normal(0, 0.5 * HETEROGENEITY[complexity]),
  );

  const purchaseIntent = sigmoid(
    (currentPurchaseNeed - 0.5) * 2.15 +
      factors.brandAttachment * 0.26 +
      factors.categoryInvolvement * 0.24 +
      rng.normal(0, 0.46 * HETEROGENEITY[complexity]),
  );

  const brandAffinity = sigmoid(
    factors.brandAttachment * 0.9 +
      factors.loyaltyTendency * 0.2 +
      rng.normal(0, 0.3 * HETEROGENEITY[complexity]),
  );

  const aovSensitivityShift =
    world.summary.aovProfile === "extreme"
      ? -0.2
      : world.summary.aovProfile === "very_low"
        ? 0.18
        : 0;

  const priceSensitivityMultiplier = clamp(
    Math.exp(
      factors.dealOrientation * 0.3 -
        factors.brandAttachment * 0.18 +
        aovSensitivityShift +
        rng.normal(0, 0.18 * HETEROGENEITY[complexity]),
    ),
    0.12,
    5,
  );

  let promotionSensitivityMultiplier =
    1 +
    factors.dealOrientation * 0.42 -
    factors.brandAttachment * 0.16 +
    rng.normal(0, 0.28 * HETEROGENEITY[complexity]);

  if (world.summary.promotionProfile === "promotion_heavy") {
    promotionSensitivityMultiplier += 0.22;
  }
  if (
    world.summary.archetype === "luxury" &&
    factors.brandAttachment > 1
  ) {
    promotionSensitivityMultiplier -= 0.38;
  }

  const repeatPropensity = sigmoid(
    factors.loyaltyTendency * 0.68 +
      factors.brandAttachment * 0.26 +
      (world.summary.businessModel === "replenishment" ? 0.45 : 0) +
      (world.summary.businessModel === "subscription" ? 0.75 : 0) +
      rng.normal(0, 0.34 * HETEROGENEITY[complexity]),
  );

  const expectedPurchaseIntervalDays = Math.max(
    1,
    world.summary.expectedPurchaseIntervalDays *
      Math.exp(
        -factors.loyaltyTendency * 0.14 -
          (currentPurchaseNeed - 0.5) * 0.18 +
          rng.normal(0, 0.22 * HETEROGENEITY[complexity]),
      ),
  );

  const mobileProbability = sigmoid(
    factors.digitalBehavior * 0.48 +
      factors.dealOrientation * 0.08 +
      rng.normal(0, 0.34 * HETEROGENEITY[complexity]),
  );

  const organicDiscoveryProbability = sigmoid(
    factors.brandAttachment * 0.42 +
      factors.categoryInvolvement * 0.26 +
      rng.normal(0, 0.4 * HETEROGENEITY[complexity]),
  );

  const expectedOrderValueMinor = Math.max(
    1,
    world.summary.expectedAovMinor *
      Math.exp(
        factors.categoryInvolvement * 0.12 -
          factors.dealOrientation * 0.08 +
          rng.normal(0, 0.16 * HETEROGENEITY[complexity]),
      ),
  );

  const acquisitionCostMultiplier = Math.max(
    0.05,
    Math.exp(
      factors.marketingReceptivity * 0.12 -
        factors.brandAttachment * 0.08 +
        rng.normal(0, 0.12 * HETEROGENEITY[complexity]),
    ),
  );

  return {
    customerId,
    populationWeight,
    factors,
    purchaseIntent,
    currentPurchaseNeed,
    priceSensitivityMultiplier,
    promotionSensitivityMultiplier,
    brandAffinity,
    repeatPropensity,
    expectedPurchaseIntervalDays,
    mobileProbability,
    organicDiscoveryProbability,
    expectedFuturePurchases: 0,
    expectedOrderValueMinor,
    acquisitionCostMultiplier,
    expectedLifetimeValueMinor: 0,
    annualPurchaseHazard: 0,
    naturalSelection: {
      searchUseProbability: 0,
      organicDiscoveryProbability,
      brandedDirectProbability: 0,
      emailSubscriptionProbability: 0,
      promotionWaitingProbability: 0,
      retargetingEligibilityProbability: 0,
    },
    channelEffectMultipliers: new Map(),
    channelUseProbabilities: new Map(),
  };
}

function applyPrimaryCalibration(
  world: GeneratedMerchantWorld,
  candidates: CandidateCustomer[],
  tolerance: number,
): void {
  const manifest = world.manifest;
  const weights = candidates.map((candidate) => candidate.populationWeight);
  const intentTarget =
    Number(manifest.customers.latentIntentDistribution.alpha) /
    (Number(manifest.customers.latentIntentDistribution.alpha) +
      Number(manifest.customers.latentIntentDistribution.beta));

  const calibratedIntent = calibrateProbabilityMean(
    candidates.map((candidate) => candidate.purchaseIntent),
    weights,
    intentTarget,
    tolerance,
  );
  const calibratedBrand = calibrateProbabilityMean(
    candidates.map((candidate) => candidate.brandAffinity),
    weights,
    Number(manifest.merchant.baselineBrandPreference),
    tolerance,
  );
  const calibratedRepeat = calibrateProbabilityMean(
    candidates.map((candidate) => candidate.repeatPropensity),
    weights,
    world.summary.repeatProbability,
    tolerance,
  );
  const calibratedMobile = calibrateProbabilityMean(
    candidates.map((candidate) => candidate.mobileProbability),
    weights,
    world.summary.mobileTrafficShare,
    tolerance,
  );
  const calibratedOrganic = calibrateProbabilityMean(
    candidates.map((candidate) => candidate.organicDiscoveryProbability),
    weights,
    world.summary.organicDemandShare,
    tolerance,
  );
  const calibratedInterval = calibratePositiveMean(
    candidates.map((candidate) => candidate.expectedPurchaseIntervalDays),
    weights,
    world.summary.expectedPurchaseIntervalDays,
  );
  const calibratedPrice = calibrateBoundedMean(
    candidates.map((candidate) => candidate.priceSensitivityMultiplier),
    weights,
    1,
    0.08,
    5,
    tolerance,
  );
  const calibratedPromotion = calibrateBoundedMean(
    candidates.map((candidate) => candidate.promotionSensitivityMultiplier),
    weights,
    1,
    -1.5,
    4.5,
    tolerance,
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    candidate.purchaseIntent = calibratedIntent[index]!;
    candidate.brandAffinity = calibratedBrand[index]!;
    candidate.repeatPropensity = calibratedRepeat[index]!;
    candidate.mobileProbability = calibratedMobile[index]!;
    candidate.organicDiscoveryProbability = calibratedOrganic[index]!;
    candidate.expectedPurchaseIntervalDays = calibratedInterval[index]!;
    candidate.priceSensitivityMultiplier = calibratedPrice[index]!;
    candidate.promotionSensitivityMultiplier = calibratedPromotion[index]!;
  }
}

function naturalSelectionFor(
  candidate: CandidateCustomer,
  world: GeneratedMerchantWorld,
  complexity: GeneratedMerchantWorld["summary"]["complexity"],
  rng: SeededRandom,
): NaturalSelectionPropensities {
  const strength = SELECTION_STRENGTH[complexity];
  const f = candidate.factors;

  const searchUseProbability = sigmoid(
    -1.05 +
      strength *
        (candidate.purchaseIntent * 1.75 +
          candidate.currentPurchaseNeed * 1.15 +
          f.digitalBehavior * 0.28 +
          f.categoryInvolvement * 0.2) +
      rng.normal(0, 0.24),
  );

  const brandedDirectProbability = sigmoid(
    -1.25 +
      candidate.brandAffinity * 2.3 +
      f.loyaltyTendency * 0.28 +
      rng.normal(0, 0.25),
  );

  const emailSubscriptionProbability = sigmoid(
    -1.45 +
      candidate.brandAffinity * 2.0 +
      candidate.repeatPropensity * 1.35 +
      f.digitalBehavior * 0.15 +
      rng.normal(0, 0.28),
  );

  const promotionWaitingProbability = sigmoid(
    -1.15 +
      candidate.priceSensitivityMultiplier * 0.45 +
      candidate.promotionSensitivityMultiplier * 0.42 -
      candidate.currentPurchaseNeed * 0.85 +
      f.dealOrientation * 0.32 +
      rng.normal(0, 0.3),
  );

  const retargetingEligibilityProbability = sigmoid(
    -1.4 +
      candidate.purchaseIntent * 1.65 +
      candidate.currentPurchaseNeed * 1.1 +
      f.explorationTendency * 0.18 +
      rng.normal(0, 0.26),
  );

  void world;

  return {
    searchUseProbability,
    organicDiscoveryProbability:
      candidate.organicDiscoveryProbability,
    brandedDirectProbability,
    emailSubscriptionProbability,
    promotionWaitingProbability,
    retargetingEligibilityProbability,
  };
}

function rawChannelEffectMultiplier(
  channel: MarketingChannel,
  candidate: CandidateCustomer,
  world: GeneratedMerchantWorld,
  complexity: GeneratedMerchantWorld["summary"]["complexity"],
  rng: SeededRandom,
): number {
  const f = candidate.factors;
  const heterogeneity = HETEROGENEITY[complexity];

  let value =
    1 +
    f.marketingReceptivity * 0.28 +
    rng.normal(0, 0.28 * heterogeneity);

  if (channel === "meta") {
    value +=
      f.explorationTendency * 0.18 +
      f.digitalBehavior * 0.15;
  } else if (
    channel === "google_search" ||
    channel === "google_shopping"
  ) {
    // High intent creates natural search selection but can reduce the
    // incremental causal response because these customers were already likely
    // to search/buy.
    value +=
      f.digitalBehavior * 0.12 -
      (candidate.purchaseIntent - 0.5) *
        SELECTION_STRENGTH[complexity] *
        0.48;
  } else if (channel === "email" || channel === "sms") {
    value +=
      f.marketingReceptivity * 0.16 -
      (candidate.brandAffinity - 0.5) * 0.28;
  } else if (channel === "pinterest") {
    value +=
      f.categoryInvolvement * 0.2 +
      f.explorationTendency * 0.18;
  } else if (channel === "affiliate") {
    value +=
      f.dealOrientation * 0.17 +
      f.explorationTendency * 0.12;
  }

  if (
    complexity === "adversarial" &&
    rng.bool(0.045)
  ) {
    value = -Math.abs(rng.normal(0.35, 0.24));
  }

  if (
    world.summary.archetype === "luxury" &&
    (channel === "sms" || channel === "affiliate") &&
    candidate.brandAffinity > 0.7
  ) {
    value -= 0.25;
  }

  return value;
}

function naturalChannelUseProbability(
  channel: MarketingChannel,
  candidate: CandidateCustomer,
  rng: SeededRandom,
): number {
  const n = candidate.naturalSelection;
  const f = candidate.factors;

  if (channel === "google_search") {
    return n.searchUseProbability;
  }
  if (channel === "google_shopping") {
    return sigmoid(
      -0.35 +
        n.searchUseProbability * 2 +
        f.dealOrientation * 0.2 +
        f.categoryInvolvement * 0.16 +
        rng.normal(0, 0.22),
    );
  }
  if (channel === "email") {
    return n.emailSubscriptionProbability;
  }
  if (channel === "sms") {
    return sigmoid(
      -0.7 +
        n.emailSubscriptionProbability * 1.75 +
        f.dealOrientation * 0.18 +
        rng.normal(0, 0.24),
    );
  }
  if (channel === "meta") {
    return sigmoid(
      -0.45 +
        f.digitalBehavior * 0.38 +
        f.explorationTendency * 0.28 +
        f.marketingReceptivity * 0.18 +
        rng.normal(0, 0.3),
    );
  }
  if (channel === "pinterest") {
    return sigmoid(
      -0.95 +
        f.digitalBehavior * 0.3 +
        f.categoryInvolvement * 0.38 +
        f.explorationTendency * 0.4 +
        rng.normal(0, 0.3),
    );
  }
  return sigmoid(
    -1.05 +
      f.dealOrientation * 0.35 +
      f.explorationTendency * 0.35 +
      rng.normal(0, 0.3),
  );
}

function calibrateChannels(
  world: GeneratedMerchantWorld,
  candidates: CandidateCustomer[],
  complexity: GeneratedMerchantWorld["summary"]["complexity"],
  tolerance: number,
  rng: SeededRandom,
): void {
  const weights = candidates.map((candidate) => candidate.populationWeight);
  const mechanismByChannel = new Map(
    world.manifest.channelIncrementality.map(
      (mechanism) => [mechanism.channelId, mechanism] as const,
    ),
  );

  for (const channel of world.summary.activeChannels) {
    const mechanism = mechanismByChannel.get(channel);
    if (!mechanism) {
      throw new PopulationCalibrationError(
        `active channel ${channel} has no merchant incrementality mechanism`,
      );
    }

    const raw = candidates.map((candidate, index) =>
      rawChannelEffectMultiplier(
        channel,
        candidate,
        world,
        complexity,
        rng.fork(`channel-effect:${channel}:${index}`),
      ),
    );

    const min = complexity === "simple" ? 0.15 : -1.5;
    const calibrated = calibrateBoundedMean(
      raw,
      weights,
      1,
      min,
      4.5,
      tolerance,
    );

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      candidate.channelEffectMultipliers.set(
        channel,
        calibrated[index]!,
      );
      candidate.channelUseProbabilities.set(
        channel,
        naturalChannelUseProbability(
          channel,
          candidate,
          rng.fork(`channel-use:${channel}:${index}`),
        ),
      );
    }
  }
}

function calibrateLifetimeEconomics(
  world: GeneratedMerchantWorld,
  candidates: CandidateCustomer[],
): {
  readonly targetFuturePurchases: number;
  readonly targetClvMinor: number;
} {
  const clv = world.manifest.clvMechanisms[0];
  if (!clv) {
    throw new PopulationCalibrationError(
      "merchant world must contain a CLV mechanism",
    );
  }

  const weights = candidates.map((candidate) => candidate.populationWeight);
  const horizonYears = Number(clv.horizonDays) / 365;
  const targetFuturePurchases = Number(clv.expectedFuturePurchases);

  const rawFuturePurchases = candidates.map((candidate) =>
    Math.max(
      1e-9,
      candidate.repeatPropensity *
        (365 / Math.max(1, candidate.expectedPurchaseIntervalDays)) *
        (0.68 + 0.32 * sigmoid(candidate.factors.loyaltyTendency)),
    ),
  );

  const calibratedFuturePurchases = calibratePositiveMean(
    rawFuturePurchases,
    weights,
    targetFuturePurchases,
  );

  const calibratedAov = calibratePurchaseWeightedAov(
    candidates.map((candidate) => candidate.expectedOrderValueMinor),
    calibratedFuturePurchases,
    weights,
    world.summary.expectedAovMinor,
  );

  const calibratedAcquisitionMultiplier = calibratePositiveMean(
    candidates.map((candidate) => candidate.acquisitionCostMultiplier),
    weights,
    1,
  );

  const nonAcquisitionValue =
    Number(clv.expectedGrossMarginMinor) -
    Number(clv.expectedDiscountsMinor) -
    Number(clv.expectedReturnsMinor) -
    Number(clv.expectedFulfillmentCostsMinor);
  const acquisitionCost = Number(
    clv.expectedAcquisitionCostsMinor ?? 0,
  );
  const targetClvMinor = nonAcquisitionValue - acquisitionCost;
  const denominator = Math.max(
    1e-9,
    targetFuturePurchases * world.summary.expectedAovMinor,
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    candidate.expectedFuturePurchases =
      calibratedFuturePurchases[index]!;
    candidate.expectedOrderValueMinor = calibratedAov[index]!;
    candidate.acquisitionCostMultiplier =
      calibratedAcquisitionMultiplier[index]!;
    candidate.annualPurchaseHazard =
      horizonYears > 0
        ? candidate.expectedFuturePurchases / horizonYears
        : 0;

    const economicExposure =
      (candidate.expectedFuturePurchases *
        candidate.expectedOrderValueMinor) /
      denominator;

    candidate.expectedLifetimeValueMinor =
      economicExposure * nonAcquisitionValue -
      candidate.acquisitionCostMultiplier * acquisitionCost;
  }

  return { targetFuturePurchases, targetClvMinor };
}

function devicePreference(
  candidate: CandidateCustomer,
  complexity: GeneratedMerchantWorld["summary"]["complexity"],
  rng: SeededRandom,
): DevicePreference {
  const rawTablet =
    complexity === "simple"
      ? rng.uniform(0.005, 0.025)
      : rng.uniform(0.008, 0.065);
  const tabletProbability = Math.min(
    1 - candidate.mobileProbability,
    rawTablet *
      (1 - candidate.mobileProbability) *
      (0.85 + 0.15 * sigmoid(candidate.factors.digitalBehavior)),
  );
  const desktopProbability = Math.max(
    0,
    1 - candidate.mobileProbability - tabletProbability,
  );

  return {
    mobileProbability: candidate.mobileProbability,
    desktopProbability,
    tabletProbability,
  };
}

function lifecycleStates(
  world: GeneratedMerchantWorld,
  candidates: CandidateCustomer[],
): Map<string, LatentLifecycle> {
  const targetExisting = Number(
    world.manifest.customers.existingCustomerShare,
  );
  const existingCount = Math.round(candidates.length * targetExisting);
  const ranked = [...candidates].sort((left, right) => {
    const leftScore =
      left.repeatPropensity +
      left.brandAffinity +
      sigmoid(left.factors.loyaltyTendency) * 0.35;
    const rightScore =
      right.repeatPropensity +
      right.brandAffinity +
      sigmoid(right.factors.loyaltyTendency) * 0.35;
    return rightScore - leftScore ||
      left.customerId.localeCompare(right.customerId);
  });

  const existing = new Set(
    ranked.slice(0, existingCount).map((candidate) => candidate.customerId),
  );

  const states = new Map<string, LatentLifecycle>();
  for (const candidate of candidates) {
    if (!existing.has(candidate.customerId)) {
      states.set(candidate.customerId, {
        state: "prospect",
        preSimulationHistory: "none",
      });
      continue;
    }

    if (
      world.summary.businessModel === "subscription" &&
      candidate.repeatPropensity > world.summary.repeatProbability
    ) {
      states.set(candidate.customerId, {
        state: "abstract_subscriber",
        preSimulationHistory: "abstract_subscriber",
      });
    } else if (
      candidate.repeatPropensity >
      world.summary.repeatProbability * 1.15
    ) {
      states.set(candidate.customerId, {
        state: "abstract_active_repeat",
        preSimulationHistory: "abstract_existing_customer",
      });
    } else if (candidate.brandAffinity > 0.55) {
      states.set(candidate.customerId, {
        state: "abstract_recent_buyer",
        preSimulationHistory: "abstract_existing_customer",
      });
    } else if (candidate.repeatPropensity < 0.22) {
      states.set(candidate.customerId, {
        state: "abstract_dormant",
        preSimulationHistory: "abstract_existing_customer",
      });
    } else {
      states.set(candidate.customerId, {
        state: "abstract_lapsing",
        preSimulationHistory: "abstract_existing_customer",
      });
    }
  }
  return states;
}

function derivedSegments(
  candidate: CandidateCustomer,
  lifecycle: LatentLifecycle,
  targetClv: number,
  categoryAffinity: number,
): readonly DerivedCustomerSegment[] {
  const segments: DerivedCustomerSegment[] = [];
  if (lifecycle.state === "prospect") segments.push("new_or_prospect");
  else segments.push("returning_oriented");

  if (
    candidate.expectedLifetimeValueMinor >
    targetClv + Math.max(500, Math.abs(targetClv) * 0.45)
  ) {
    segments.push("high_value");
  }
  if (
    candidate.priceSensitivityMultiplier > 1.25 ||
    candidate.promotionSensitivityMultiplier > 1.35
  ) {
    segments.push("discount_sensitive");
  }
  if (candidate.brandAffinity > 0.68) segments.push("brand_loyal");
  if (categoryAffinity > 0.76) segments.push("category_enthusiast");
  if (
    candidate.factors.explorationTendency > 0.8 &&
    candidate.repeatPropensity < 0.45
  ) {
    segments.push("gift_oriented");
  }
  if (
    candidate.expectedPurchaseIntervalDays < 70 &&
    candidate.repeatPropensity > 0.5
  ) {
    segments.push("replenishment_oriented");
  }
  if (candidate.purchaseIntent < 0.2) segments.push("low_intent_browser");

  const channelValues = [...candidate.channelEffectMultipliers.values()];
  if (
    channelValues.length > 0 &&
    channelValues.reduce((sum, value) => sum + value, 0) /
      channelValues.length <
      0.35
  ) {
    segments.push("advertising_resistant");
  }
  if (candidate.mobileProbability > 0.78) segments.push("mobile_dominant");
  return segments;
}

function buildCalibrationReport(
  world: GeneratedMerchantWorld,
  candidates: CandidateCustomer[],
  targetFuturePurchases: number,
  targetClv: number,
  tolerance: number,
): PopulationCalibrationReport {
  const weights = candidates.map((candidate) => candidate.populationWeight);
  const intentTarget =
    Number(world.manifest.customers.latentIntentDistribution.alpha) /
    (Number(world.manifest.customers.latentIntentDistribution.alpha) +
      Number(world.manifest.customers.latentIntentDistribution.beta));

  const metrics: CalibrationMetric[] = [
    calibrationMetric(
      "purchase_intent_mean",
      intentTarget,
      weightedMean(
        candidates.map((candidate) => candidate.purchaseIntent),
        weights,
      ),
      tolerance,
    ),
    calibrationMetric(
      "brand_affinity_mean",
      Number(world.manifest.merchant.baselineBrandPreference),
      weightedMean(
        candidates.map((candidate) => candidate.brandAffinity),
        weights,
      ),
      tolerance,
    ),
    calibrationMetric(
      "repeat_propensity_mean",
      world.summary.repeatProbability,
      weightedMean(
        candidates.map((candidate) => candidate.repeatPropensity),
        weights,
      ),
      tolerance,
    ),
    calibrationMetric(
      "mobile_share",
      world.summary.mobileTrafficShare,
      weightedMean(
        candidates.map((candidate) => candidate.mobileProbability),
        weights,
      ),
      tolerance,
    ),
    calibrationMetric(
      "organic_propensity_mean",
      world.summary.organicDemandShare,
      weightedMean(
        candidates.map(
          (candidate) => candidate.organicDiscoveryProbability,
        ),
        weights,
      ),
      tolerance,
    ),
    calibrationMetric(
      "purchase_interval_mean",
      world.summary.expectedPurchaseIntervalDays,
      weightedMean(
        candidates.map(
          (candidate) => candidate.expectedPurchaseIntervalDays,
        ),
        weights,
      ),
      Math.max(tolerance, 1e-5),
    ),
    calibrationMetric(
      "future_purchases_mean",
      targetFuturePurchases,
      weightedMean(
        candidates.map(
          (candidate) => candidate.expectedFuturePurchases,
        ),
        weights,
      ),
      Math.max(tolerance, 1e-6),
    ),
    calibrationMetric(
      "purchase_weighted_aov",
      world.summary.expectedAovMinor,
      purchaseWeightedMean(
        candidates.map(
          (candidate) => candidate.expectedOrderValueMinor,
        ),
        candidates.map(
          (candidate) => candidate.expectedFuturePurchases,
        ),
        weights,
      ),
      Math.max(0.05, world.summary.expectedAovMinor * 1e-8),
    ),
    calibrationMetric(
      "expected_clv_mean",
      targetClv,
      weightedMean(
        candidates.map(
          (candidate) => candidate.expectedLifetimeValueMinor,
        ),
        weights,
      ),
      Math.max(0.05, Math.abs(targetClv) * 1e-8),
    ),
    calibrationMetric(
      "price_sensitivity_multiplier_mean",
      1,
      weightedMean(
        candidates.map(
          (candidate) => candidate.priceSensitivityMultiplier,
        ),
        weights,
      ),
      tolerance,
    ),
    calibrationMetric(
      "promotion_sensitivity_multiplier_mean",
      1,
      weightedMean(
        candidates.map(
          (candidate) => candidate.promotionSensitivityMultiplier,
        ),
        weights,
      ),
      tolerance,
    ),
  ];

  for (const channel of world.summary.activeChannels) {
    metrics.push(
      calibrationMetric(
        `channel_effect_multiplier_mean:${channel}`,
        1,
        weightedMean(
          candidates.map((candidate) => {
            const value =
              candidate.channelEffectMultipliers.get(channel);
            if (value === undefined) {
              throw new PopulationCalibrationError(
                `customer missing calibrated channel ${channel}`,
              );
            }
            return value;
          }),
          weights,
        ),
        tolerance,
      ),
    );
  }

  return {
    converged: metrics.every((metric) => metric.converged),
    metrics,
  };
}

function customerPopulationSeed(
  request: CustomerPopulationRequest,
): string {
  const world = request.merchantWorld;
  return configSeed(
    request.populationSeed,
    CUSTOMER_POPULATION_GENERATOR_VERSION,
    {
      merchantWorldId: world.manifest.worldId,
      merchantWorldSeed: world.manifest.seed,
      merchantGeneratorVersion: world.provenance.generatorVersion,
      merchantFingerprint: merchantFingerprint(world),
      populationConfig: request.populationConfig ?? {},
    },
  );
}

export function generateCustomerPopulation(
  request: CustomerPopulationRequest,
): LatentCustomerPopulation {
  validateRequest(request);

  const world = request.merchantWorld;
  const manifestBefore = serializeGroundTruthManifest(world.manifest);
  const complexity = resolvedComplexity(
    world,
    request.populationConfig,
  );
  const tolerance =
    request.populationConfig?.calibrationTolerance ?? 1e-6;

  const representedCustomerCount = Math.max(
    1,
    Math.round(Number(world.manifest.customers.populationSize)),
  );
  const agentLimit =
    request.populationConfig?.maxExplicitAgents ??
    DEFAULT_AGENT_LIMIT[complexity];
  const explicitAgentCount = Math.min(
    representedCustomerCount,
    agentLimit,
  );
  const populationWeight =
    representedCustomerCount / explicitAgentCount;

  const rng = new SeededRandom(customerPopulationSeed(request));
  const candidates = Array.from(
    { length: explicitAgentCount },
    (_, index) =>
      initialCandidate(
        world,
        complexity,
        `customer_${String(index + 1).padStart(9, "0")}`,
        populationWeight,
        rng.fork(`candidate:${index}`),
      ),
  );
  const weights = candidates.map((candidate) => candidate.populationWeight);

  applyPrimaryCalibration(world, candidates, tolerance);

  const naturalSelectionRng = rng.fork("natural-selection");
  for (let index = 0; index < candidates.length; index += 1) {
    candidates[index]!.naturalSelection = naturalSelectionFor(
      candidates[index]!,
      world,
      complexity,
      naturalSelectionRng.fork(String(index)),
    );
  }

  calibrateChannels(
    world,
    candidates,
    complexity,
    tolerance,
    rng.fork("channels"),
  );

  const lifetimeTargets = calibrateLifetimeEconomics(
    world,
    candidates,
  );

  const catalogIndex = buildPreferenceCatalogIndex(world.manifest);
  const maxCategoryPreferences =
    request.populationConfig?.maxCategoryPreferences ?? 4;
  const maxProductPreferences =
    request.populationConfig?.maxProductPreferences ?? 6;
  const lifecycleByCustomer = lifecycleStates(world, candidates);

  const customers: LatentCustomer[] = candidates.map(
    (candidate, index) => {
      const preferences = generateSparsePreferences(
        catalogIndex,
        candidate.factors,
        rng.fork(`preferences:${index}`),
        maxCategoryPreferences,
        maxProductPreferences,
      );

      const mechanismByChannel = new Map(
        world.manifest.channelIncrementality.map(
          (mechanism) => [mechanism.channelId, mechanism] as const,
        ),
      );

      const channelTraits: ChannelLatentTrait[] =
        world.summary.activeChannels.map((channel) => {
          const mechanism = mechanismByChannel.get(channel);
          const causalEffectMultiplier =
            candidate.channelEffectMultipliers.get(channel);
          const naturalUseProbability =
            candidate.channelUseProbabilities.get(channel);
          if (
            !mechanism ||
            causalEffectMultiplier === undefined ||
            naturalUseProbability === undefined
          ) {
            throw new PopulationCalibrationError(
              `incomplete channel trait for ${channel}`,
            );
          }
          return {
            channelId: channel,
            merchantMechanismId: mechanism.id,
            causalEffectMultiplier,
            naturalUseProbability,
          };
        });

      const lifecycle = lifecycleByCustomer.get(candidate.customerId);
      if (!lifecycle) {
        throw new PopulationCalibrationError(
          `missing lifecycle state for ${candidate.customerId}`,
        );
      }

      const categoryAffinity = Math.max(
        0,
        ...preferences.categoryPreferences.map(
          (preference) => preference.affinity,
        ),
      );

      return {
        customerId: candidate.customerId,
        populationWeight: candidate.populationWeight,
        latentFactors: candidate.factors,
        purchaseIntent: candidate.purchaseIntent,
        currentPurchaseNeed: candidate.currentPurchaseNeed,
        priceSensitivityMultiplier:
          candidate.priceSensitivityMultiplier,
        promotionSensitivityMultiplier:
          candidate.promotionSensitivityMultiplier,
        brandAffinity: candidate.brandAffinity,
        categoryPreferences: preferences.categoryPreferences,
        productPreferences: preferences.productPreferences,
        channelTraits,
        naturalSelection: candidate.naturalSelection,
        devicePreference: devicePreference(
          candidate,
          complexity,
          rng.fork(`device:${index}`),
        ),
        repeatPropensity: candidate.repeatPropensity,
        expectedPurchaseIntervalDays:
          candidate.expectedPurchaseIntervalDays,
        annualPurchaseHazard: candidate.annualPurchaseHazard,
        expectedFuturePurchases: candidate.expectedFuturePurchases,
        expectedOrderValueMinor: candidate.expectedOrderValueMinor,
        expectedLifetimeValueMinor:
          candidate.expectedLifetimeValueMinor,
        lifecycle,
        derivedSegments: derivedSegments(
          candidate,
          lifecycle,
          lifetimeTargets.targetClvMinor,
          categoryAffinity,
        ),
      };
    },
  );

  const calibration = buildCalibrationReport(
    world,
    candidates,
    lifetimeTargets.targetFuturePurchases,
    lifetimeTargets.targetClvMinor,
    tolerance,
  );

  if (!calibration.converged) {
    const failed = calibration.metrics
      .filter((metric) => !metric.converged)
      .map(
        (metric) =>
          `${metric.metric}: target=${metric.target}, implied=${metric.implied}`,
      )
      .join("; ");
    throw new PopulationCalibrationError(
      `latent population failed merchant reconciliation: ${failed}`,
    );
  }

  const representedWeight = customers.reduce(
    (sum, customer) => sum + customer.populationWeight,
    0,
  );
  if (
    Math.abs(representedWeight - representedCustomerCount) >
    Math.max(1e-8, representedCustomerCount * 1e-10)
  ) {
    throw new PopulationCalibrationError(
      "weighted population representation failed",
    );
  }

  if (serializeGroundTruthManifest(world.manifest) !== manifestBefore) {
    throw new PopulationCalibrationError(
      "customer population generation mutated frozen merchant GroundTruth",
    );
  }

  const population: LatentCustomerPopulation = {
    schemaVersion: "1.0.0",
    generatorVersion: CUSTOMER_POPULATION_GENERATOR_VERSION,
    merchantWorldId: world.manifest.worldId,
    populationSeed: request.populationSeed,
    representedCustomerCount,
    explicitAgentCount,
    weightedAgents: populationWeight !== 1,
    customers,
    calibration,
    provenance: {
      generatorVersion: CUSTOMER_POPULATION_GENERATOR_VERSION,
      merchantWorldId: world.manifest.worldId,
      merchantWorldFingerprint: merchantFingerprint(world),
      merchantGeneratorVersion: world.provenance.generatorVersion,
      merchantGroundTruthSchemaVersion: world.manifest.schemaVersion,
      merchantWorldSeed: world.manifest.seed,
      populationSeed: request.populationSeed,
      populationConfig: request.populationConfig ?? {},
      inheritedComplexity: complexity,
    },
  };

  validateLatentCustomerPopulation(population, world);

  return Object.freeze(population);
}
