import type { LatentCustomer } from "../customer_population/types.js";
import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";
import { clamp } from "../customer_population/calibration.js";
import { evaluateFrozenResponseCurve } from "../ground_truth/response-functions.js";
import { days, hours, type SharedRandomness } from "./kernel.js";
import type { SimulationInterventionState } from "./interventions.js";
import type { RuntimeCustomerState } from "./state.js";
import {
  applyMarketingMemory,
  refreshLatentCustomerState,
} from "./state.js";
import type {
  CausalEffectKind,
  ExposureCausalTruth,
  ObservableSource,
  PerfectObservableJourneyEvent,
} from "./types.js";

export interface ChannelOpportunity {
  readonly source: ObservableSource;
  readonly channel?: MarketingChannel;
  readonly isPaidExposure: boolean;
  readonly probability: number;
}

function channelTrait(
  customer: LatentCustomer,
  channel: MarketingChannel,
) {
  const trait = customer.channelTraits.find(
    (candidate) => candidate.channelId === channel,
  );
  if (!trait) {
    throw new RangeError(
      `customer ${customer.customerId} has no channel trait for ${channel}`,
    );
  }
  return trait;
}

function channelNaturalUse(
  customer: LatentCustomer,
  channel: MarketingChannel,
): number {
  return channelTrait(customer, channel).naturalUseProbability;
}

export function naturalVisitOpportunities(
  customer: RuntimeCustomerState,
  modifiers: {
    readonly directMultiplier?: number;
    readonly organicMultiplier?: number;
    readonly channelMultipliers?: ReadonlyMap<MarketingChannel, number>;
  } = {},
): readonly ChannelOpportunity[] {
  const source = customer.source;
  return [
    {
      source: "direct",
      isPaidExposure: false,
      probability: clamp(
        source.naturalSelection.brandedDirectProbability *
          (0.35 + customer.need * 0.65) *
          (modifiers.directMultiplier ?? 1),
        0,
        0.95,
      ),
    },
    {
      source: "organic_search",
      isPaidExposure: false,
      probability: clamp(
        source.naturalSelection.organicDiscoveryProbability *
          (0.3 + customer.intent * 0.7) *
          (modifiers.organicMultiplier ?? 1),
        0,
        0.95,
      ),
    },
    ...source.channelTraits
      .filter(
        (trait) =>
          trait.channelId === "google_search" ||
          trait.channelId === "google_shopping" ||
          trait.channelId === "email" ||
          trait.channelId === "sms" ||
          trait.channelId === "pinterest" ||
          trait.channelId === "affiliate",
      )
      .map((trait) => ({
        source: trait.channelId as ObservableSource,
        channel: trait.channelId,
        isPaidExposure: false,
        probability: clamp(
          trait.naturalUseProbability *
            (0.25 + customer.intent * 0.75) *
            (modifiers.channelMultipliers?.get(
              trait.channelId,
            ) ?? 1),
          0,
          0.96,
        ),
      })),
  ];
}

export function paidExposureProbability(
  world: GeneratedMerchantWorld,
  customer: RuntimeCustomerState,
  channel: MarketingChannel,
  interventionState: SimulationInterventionState,
  opportunityMultiplier = 1,
): number {
  const scale = interventionState.channelSpendScale.get(channel) ?? 1;
  if (scale <= 0) return 0;

  const natural = channelNaturalUse(customer.source, channel);
  const paidDependence = world.summary.paidDependence;
  const base =
    0.015 +
    0.075 * paidDependence +
    0.09 * natural +
    0.06 * customer.intent;

  // Spend affects opportunity/exposure frequency, not the causal effect itself.
  return clamp(
    base *
      Math.sqrt(scale) *
      Math.max(0, opportunityMultiplier),
    0,
    0.85,
  );
}

function delayMsForChannel(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
): number {
  const mechanism = world.manifest.channelIncrementality.find(
    (candidate) => candidate.channelId === channel,
  );
  if (!mechanism?.delay) return 0;
  if (
    mechanism.delay.kind === "fixed" &&
    mechanism.delay.fixedSeconds !== undefined
  ) {
    return Number(mechanism.delay.fixedSeconds) * 1_000;
  }
  if (mechanism.delay.values && mechanism.delay.values.length > 0) {
    return Number(mechanism.delay.values[0]!.seconds) * 1_000;
  }
  return 0;
}

function halfLifeForChannel(channel: MarketingChannel): number {
  if (channel === "email" || channel === "sms") return days(2.5);
  if (channel === "pinterest") return days(6);
  if (channel === "meta") return days(4);
  if (channel === "google_search" || channel === "google_shopping") {
    return hours(18);
  }
  return days(3);
}

function referenceSpendForResponseCurve(
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

  if (!curve) return 1;

  if (curve.kind === "hill") {
    return Math.max(1, Number(curve.halfSaturationSpend));
  }
  if (curve.kind === "threshold") {
    return Math.max(1, Number(curve.thresholdSpend));
  }
  if (curve.kind === "linear") {
    return Math.max(1, Number(curve.maxSpend ?? 100_000));
  }
  const positive = curve.points.find(
    (point) => Number(point.spend) > 0,
  );
  return Math.max(1, Number(positive?.spend ?? 100_000));
}

function causalPerExposureScale(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
  spendScale: number,
): number {
  const mechanism = world.manifest.channelIncrementality.find(
    (candidate) => candidate.channelId === channel,
  );
  const curve = mechanism?.responseCurveId
    ? world.manifest.responseCurves.find(
        (candidate) => candidate.id === mechanism.responseCurveId,
      )
    : undefined;

  if (!curve || spendScale <= 0) return 0;

  const baselineSpend = referenceSpendForResponseCurve(world, channel);
  const baselineOutcome = evaluateFrozenResponseCurve(
    curve,
    baselineSpend,
  );
  const currentOutcome = evaluateFrozenResponseCurve(
    curve,
    baselineSpend * spendScale,
  );

  if (Math.abs(baselineOutcome) < 1e-12) {
    // A zero causal-response curve must still allow delivery/exposure.
    // The frozen merchant effect controls whether the exposure has effect.
    return 1;
  }

  const totalResponseScale = currentOutcome / baselineOutcome;
  const deliveryScale = Math.sqrt(spendScale);
  if (deliveryScale <= 0) return 0;

  return clamp(totalResponseScale / deliveryScale, -3, 3);
}

function normalizedMerchantEffect(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
): number {
  const mechanism = world.manifest.channelIncrementality.find(
    (candidate) => candidate.channelId === channel,
  );
  if (!mechanism) return 0;

  const annualOrders = Math.max(1, world.summary.expectedAnnualOrders);
  return clamp(
    mechanism.effect.value / (annualOrders / 12),
    -0.25,
    0.35,
  );
}

function effectKindsForChannel(
  channel: MarketingChannel,
  appliedEffect: number,
  randomness: SharedRandomness,
  key: string,
): readonly CausalEffectKind[] {
  if (appliedEffect === 0) return [];
  const kinds: CausalEffectKind[] = [];

  if (
    channel === "meta" ||
    channel === "pinterest" ||
    randomness.bool(`${key}:awareness`, 0.35)
  ) {
    kinds.push("awareness");
  }
  if (
    channel === "email" ||
    channel === "sms" ||
    randomness.bool(`${key}:consideration`, 0.52)
  ) {
    kinds.push("consideration");
  }
  if (
    channel === "google_search" ||
    channel === "google_shopping" ||
    randomness.bool(`${key}:purchase`, 0.44)
  ) {
    kinds.push("purchase_probability");
  }
  if (randomness.bool(`${key}:product`, 0.22)) {
    kinds.push("product_preference");
  }
  if (randomness.bool(`${key}:timing`, 0.26)) {
    kinds.push("timing");
  }
  return kinds;
}

export function recordMarketingExposure(
  world: GeneratedMerchantWorld,
  customer: RuntimeCustomerState,
  channel: MarketingChannel,
  timestampMs: number,
  eventId: string,
  randomness: SharedRandomness,
  interventionState: SimulationInterventionState,
  causalResponseMultiplier = 1,
): {
  readonly observableEvent: PerfectObservableJourneyEvent;
  readonly truth: ExposureCausalTruth;
  readonly applyAtMs: number;
  readonly latentEffect: {
    readonly awarenessLift: number;
    readonly considerationLift: number;
    readonly purchaseProbabilityLift: number;
    readonly productPreferenceLift: number;
    readonly halfLifeMs: number;
  };
} {
  refreshLatentCustomerState(customer, timestampMs);
  const trait = channelTrait(customer.source, channel);
  const baseEffect = normalizedMerchantEffect(world, channel);
  const spendScale = interventionState.channelSpendScale.get(channel) ?? 1;

  // Spend changes how often treatment is delivered. For an exposure that
  // actually occurred, customer-level causal response comes from the frozen
  // merchant effect × frozen Step 3 susceptibility.
  const merchantEffect =
    baseEffect *
    causalPerExposureScale(
      world,
      channel,
      spendScale,
    ) *
    causalResponseMultiplier;
  const appliedEffect = merchantEffect * trait.causalEffectMultiplier;
  const delayMs = delayMsForChannel(world, channel);
  const halfLifeMs = halfLifeForChannel(channel);
  const effectKinds = effectKindsForChannel(
    channel,
    appliedEffect,
    randomness,
    eventId,
  );

  const magnitude = clamp(Math.abs(appliedEffect), 0, 0.3);
  const sign = appliedEffect < 0 ? -1 : 1;

  const latentEffect = {
    awarenessLift: effectKinds.includes("awareness")
      ? sign * magnitude * 0.38
      : 0,
    considerationLift: effectKinds.includes("consideration")
      ? sign * magnitude * 0.42
      : 0,
    purchaseProbabilityLift: effectKinds.includes("purchase_probability")
      ? sign * magnitude * 0.52
      : 0,
    productPreferenceLift: effectKinds.includes("product_preference")
      ? sign * magnitude * 0.22
      : 0,
    halfLifeMs,
  };

  const observableEvent: PerfectObservableJourneyEvent = {
    eventId,
    eventType:
      channel === "email"
        ? "email_open"
        : channel === "sms"
          ? "sms_open"
          : "impression",
    occurredAt: new Date(timestampMs).toISOString(),
    anonymousSubjectId: customer.customerId,
    source: channel,
    channel,
  };

  return {
    observableEvent,
    truth: {
      exposureEventId: eventId,
      customerId: customer.customerId,
      channelId: channel,
      occurredAt: observableEvent.occurredAt,
      merchantEffect,
      customerMultiplier: trait.causalEffectMultiplier,
      appliedEffect,
      effectKinds,
      delayMs,
      halfLifeMs,
      zeroEffect: appliedEffect === 0,
    },
    applyAtMs: timestampMs + delayMs,
    latentEffect,
  };
}

export function applyExposureLatentEffect(
  customer: RuntimeCustomerState,
  channel: MarketingChannel,
  timestampMs: number,
  effect: {
    readonly awarenessLift: number;
    readonly considerationLift: number;
    readonly purchaseProbabilityLift: number;
    readonly productPreferenceLift: number;
    readonly halfLifeMs: number;
  },
): void {
  applyMarketingMemory(
    customer,
    channel,
    timestampMs,
    effect,
  );
}
