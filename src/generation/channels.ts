import { ARCHETYPE_TENDENCIES } from "./archetypes.js";
import type {
  MarketingChannel,
  MerchantGenerationConfig,
} from "./config.js";
import type { LatentBusinessProfile } from "./profile.js";
import { SeededRandom } from "./rng.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface GeneratedChannelMechanisms {
  readonly responseCurves: readonly Record<string, unknown>[];
  readonly channelIncrementality: readonly Record<string, unknown>[];
  readonly cacMechanisms: readonly Record<string, unknown>[];
  readonly saturationMechanisms: readonly Record<string, unknown>[];
  readonly channelInteractions: readonly Record<string, unknown>[];
  readonly channelMechanismIds: Readonly<Record<string, string>>;
}

const lifecycleChannels = new Set<MarketingChannel>(["email", "sms"]);

function monthlySpendBudget(
  profile: LatentBusinessProfile,
  channelCount: number,
): number {
  const annualSpend =
    profile.annualRevenuePotentialMinor * profile.marketingSpendRate;
  return Math.max(10_000, Math.round(annualSpend / 12 / channelCount));
}

function channelSuitability(
  config: MerchantGenerationConfig,
  channel: MarketingChannel,
): number {
  return ARCHETYPE_TENDENCIES[config.archetype].channelSuitability[channel];
}

function trueIncrementalityFactor(
  config: MerchantGenerationConfig,
  profile: LatentBusinessProfile,
  channel: MarketingChannel,
  rng: SeededRandom,
): number {
  const forcedZero =
    config.overrides?.forceZeroIncrementalityChannels?.includes(channel) ??
    false;
  if (forcedZero) return 0;

  let factor = rng.uniform(0.2, 1.05) * channelSuitability(config, channel);

  if (profile.marketingDependence === "paid_media_heavy") {
    factor *= lifecycleChannels.has(channel) ? 0.8 : 1.2;
  }
  if (profile.marketingDependence === "retention_heavy") {
    factor *= lifecycleChannels.has(channel) ? 1.35 : 0.82;
  }
  if (profile.marketingDependence === "organic_heavy") {
    factor *= lifecycleChannels.has(channel) ? 1.05 : 0.72;
  }

  // Strong pre-existing brand demand makes demand capture more plausible.
  factor *= 1 - profile.brandStrength * rng.uniform(0.08, 0.32);

  if (profile.outlierTag === "weak_paid_efficiency" && !lifecycleChannels.has(channel)) {
    factor *= rng.uniform(0.25, 0.55);
  }

  if (config.complexity === "adversarial" && rng.bool(0.22)) {
    factor = -rng.uniform(0.02, 0.22);
  }

  return clamp(factor, -0.35, 1.35);
}

function orderResponseCurve(
  id: string,
  halfSaturationSpend: number,
  maxIncrementalOrders: number,
  config: MerchantGenerationConfig,
  rng: SeededRandom,
): Record<string, unknown> {
  if (
    config.complexity === "adversarial" &&
    rng.bool(0.35)
  ) {
    const p1 = Math.max(1_000, Math.round(halfSaturationSpend * 0.35));
    const p2 = Math.max(p1 + 1, Math.round(halfSaturationSpend));
    const p3 = Math.max(p2 + 1, Math.round(halfSaturationSpend * 2.2));
    const p4 = Math.max(p3 + 1, Math.round(halfSaturationSpend * 4));
    const peak = Math.max(0, maxIncrementalOrders);
    return {
      id,
      kind: "piecewise",
      inputUnit: "money_minor",
      outputUnit: "orders",
      points: [
        { spend: 0, outcome: 0 },
        { spend: p1, outcome: peak * 0.5 },
        { spend: p2, outcome: peak * 0.9 },
        { spend: p3, outcome: peak },
        {
          spend: p4,
          outcome: peak * rng.uniform(0.68, 0.96),
        },
      ],
    };
  }

  if (config.complexity === "complex" && rng.bool(0.28)) {
    return {
      id,
      kind: "threshold",
      inputUnit: "money_minor",
      outputUnit: "orders",
      thresholdSpend: Math.max(
        0,
        Math.round(halfSaturationSpend * rng.uniform(0.2, 0.6)),
      ),
      belowThresholdSlope:
        maxIncrementalOrders / Math.max(1, halfSaturationSpend) * rng.uniform(0.15, 0.55),
      aboveThresholdSlope:
        maxIncrementalOrders / Math.max(1, halfSaturationSpend) * rng.uniform(0.35, 0.95),
      maximumOutcome: Math.max(0, maxIncrementalOrders),
    };
  }

  return {
    id,
    kind: "hill",
    inputUnit: "money_minor",
    outputUnit: "orders",
    maxIncrementalOutcome: Math.max(0.001, maxIncrementalOrders),
    halfSaturationSpend: Math.max(1, Math.round(halfSaturationSpend)),
    hillCoefficient: rng.uniform(0.7, 2.1),
  };
}

function acquisitionCurve(
  id: string,
  halfSaturationSpend: number,
  maxCustomers: number,
  rng: SeededRandom,
): Record<string, unknown> {
  return {
    id,
    kind: "hill",
    inputUnit: "money_minor",
    outputUnit: "customers",
    maxIncrementalOutcome: Math.max(0.001, maxCustomers),
    halfSaturationSpend: Math.max(1, Math.round(halfSaturationSpend)),
    hillCoefficient: rng.uniform(0.75, 1.8),
  };
}

export function generateChannelMechanisms(
  config: MerchantGenerationConfig,
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): GeneratedChannelMechanisms {
  const responseCurves: Record<string, unknown>[] = [];
  const channelIncrementality: Record<string, unknown>[] = [];
  const cacMechanisms: Record<string, unknown>[] = [];
  const saturationMechanisms: Record<string, unknown>[] = [];
  const channelMechanismIds: Record<string, string> = {};

  const channelCount = Math.max(1, profile.activeChannels.length);
  const baseMonthlyBudget = monthlySpendBudget(profile, channelCount);

  for (const channel of profile.activeChannels) {
    const slug = `${profile.merchantId}_${channel}`;
    const incrementalityId = `${slug}_incrementality`;
    const orderCurveId = `${slug}_order_response`;
    const acquisitionCurveId = `${slug}_acquisition_response`;
    const saturationId = `${slug}_saturation`;
    const cacId = `${slug}_cac`;

    const factor = trueIncrementalityFactor(
      config,
      profile,
      channel,
      rng,
    );
    const budget = Math.max(
      1_000,
      Math.round(baseMonthlyBudget * rng.uniform(0.55, 1.55)),
    );
    const halfSaturationSpend = Math.max(
      1_000,
      Math.round(
        budget *
          (config.complexity === "adversarial"
            ? rng.uniform(0.45, 1.2)
            : rng.uniform(0.75, 2.2)),
      ),
    );
    const channelOrderOpportunity =
      (profile.expectedAnnualOrders * profile.paidDependence) /
      12 /
      channelCount;
    const maxIncrementalOrders = Math.max(
      0.001,
      Math.abs(factor) *
        channelOrderOpportunity *
        rng.uniform(0.7, 1.7),
    );

    responseCurves.push(
      orderResponseCurve(
        orderCurveId,
        halfSaturationSpend,
        maxIncrementalOrders,
        config,
        rng,
      ),
    );

    const newCustomerShare = clamp(
      1 - profile.repeatProbability * rng.uniform(0.35, 0.75),
      0.12,
      0.95,
    );
    const maxCustomers =
      maxIncrementalOrders * newCustomerShare * rng.uniform(0.75, 1.05);

    responseCurves.push(
      acquisitionCurve(
        acquisitionCurveId,
        halfSaturationSpend,
        maxCustomers,
        rng,
      ),
    );

    const effectOrders =
      factor === 0
        ? 0
        : channelOrderOpportunity * factor * rng.uniform(0.65, 1.15);

    const delaySeconds =
      lifecycleChannels.has(channel)
        ? rng.integer(0, 3) * 86_400
        : rng.integer(0, config.complexity === "simple" ? 1 : 12) * 86_400;

    channelIncrementality.push({
      id: incrementalityId,
      channelId: channel,
      outcomeVariable: "commerce.orders",
      effect: {
        scale: "absolute",
        value: effectOrders,
        unit: "orders",
      },
      responseCurveId: orderCurveId,
      ...(delaySeconds === 0
        ? {}
        : {
            delay: {
              kind: "fixed",
              fixedSeconds: delaySeconds,
            },
          }),
      heterogeneity: [
        {
          selector: { segmentIds: ["high_intent"] },
          multiplier: rng.uniform(0.72, 1.35),
        },
        {
          selector: { segmentIds: ["returning"] },
          multiplier: lifecycleChannels.has(channel)
            ? rng.uniform(1.05, 1.5)
            : rng.uniform(0.55, 1.1),
        },
      ],
      saturationMechanismId: saturationId,
      timeDependent: config.complexity !== "simple",
    });

    saturationMechanisms.push({
      id: saturationId,
      channelId: channel,
      responseCurveId: orderCurveId,
      finiteOptimalSpendPossible: true,
    });

    const expectedNewCustomers = Math.max(
      1,
      Math.abs(maxCustomers) * rng.uniform(0.35, 0.75),
    );
    cacMechanisms.push({
      id: cacId,
      channelId: channel,
      averageIncrementalCAC: Math.max(
        1,
        Math.round(budget / expectedNewCustomers),
      ),
      marginalCACCurveId: acquisitionCurveId,
      definition: "incremental_new_customers_only",
    });

    channelMechanismIds[channel] = incrementalityId;
  }

  const channelInteractions: Record<string, unknown>[] = [];
  const maxInteractions: Record<MerchantGenerationConfig["complexity"], number> = {
    simple: 0,
    normal: 1,
    complex: 2,
    adversarial: 4,
  };
  const targetInteractions = Math.min(
    maxInteractions[config.complexity],
    Math.max(0, profile.activeChannels.length - 1),
  );

  for (let index = 0; index < targetInteractions; index += 1) {
    const first = profile.activeChannels[index % profile.activeChannels.length]!;
    const second =
      profile.activeChannels[
        (index + 1 + rng.integer(0, Math.max(0, profile.activeChannels.length - 2))) %
          profile.activeChannels.length
      ]!;
    if (first === second) continue;

    const kinds =
      config.complexity === "adversarial"
        ? (["synergy", "cannibalization", "mediation", "delayed", "zero"] as const)
        : (["synergy", "mediation", "delayed", "zero"] as const);
    const kind = rng.pick(kinds);
    const effect =
      kind === "zero"
        ? 0
        : kind === "cannibalization"
          ? -rng.uniform(0.03, 0.22)
          : rng.uniform(0.02, 0.2);

    channelInteractions.push({
      id: `${profile.merchantId}_interaction_${String(index + 1).padStart(2, "0")}`,
      channelIds: [first, second],
      kind,
      functionalForm:
        kind === "zero"
          ? "additive"
          : rng.pick(["additive", "multiplicative", "nonlinear"] as const),
      effect: {
        scale: "relative",
        value: effect,
        unit: "dimensionless",
      },
      ...(kind === "delayed"
        ? { delaySeconds: rng.integer(1, 14) * 86_400 }
        : {}),
      ...(kind === "mediation"
        ? { mediatorVariable: "customer.brand_awareness" }
        : {}),
    });
  }

  return {
    responseCurves,
    channelIncrementality,
    cacMechanisms,
    saturationMechanisms,
    channelInteractions,
    channelMechanismIds,
  };
}
