import type {
  LatentCustomer,
  LatentCustomerPopulation,
} from "../customer_population/types.js";
import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";
import { clamp } from "../customer_population/calibration.js";
import { days } from "./kernel.js";
import {
  createInventoryEconomyState,
  legacyNetAvailableUnits,
} from "../inventory_dynamics/state.js";
import type {
  InventoryEconomyRuntime,
} from "../inventory_dynamics/types.js";

export type RuntimeLifecycleState =
  | "prospect"
  | "engaged_prospect"
  | "first_time_buyer"
  | "active_customer"
  | "repeat_customer"
  | "loyal_customer"
  | "lapsing"
  | "dormant"
  | "churned"
  | "subscriber";

export interface ChannelMemory {
  readonly channelId: MarketingChannel;
  awarenessLift: number;
  considerationLift: number;
  purchaseProbabilityLift: number;
  productPreferenceLift: number;
  lastUpdatedMs: number;
  halfLifeMs: number;
  exposures: number;
}

export interface PersistentCartLine {
  readonly productId: string;
  quantity: number;
  unitPriceMinor: number;
  /**
   * Step 9 links an observed cart line back to the latent inventory-demand
   * record that preceded it. Optional for frozen Step 1-8 compatibility.
   */
  demandTruthId?: string;
  demandTruthIds?: string[];
}

export interface InteractionMemoryState {
  readonly mechanismId: string;
  readonly participantChannels: readonly MarketingChannel[];
  value: number;
  lastUpdatedMs: number;
  halfLifeMs: number;
}

export interface FutureAudienceState {
  retargetingEligibility: number;
  emailEligibility: number;
  brandedSearchReadiness: number;
  recentSiteVisitScore: number;
  readonly createdByChannels: Set<MarketingChannel>;
}

export interface PersistentCart {
  readonly lines: PersistentCartLine[];
  updatedAtMs: number;
  expiresAtMs: number;
}

export interface RuntimeRetentionState {
  enabled: boolean;
  repeatHazardQualityMultiplier: number;
  promotionDependenceShift: number;
  trueChurnState:
    | "active"
    | "latent_churned"
    | "permanent_churned";
  reactivationCount: number;
  readonly ownedProductQuantities: Map<string, number>;
  readonly categoryFamiliarity: Map<string, number>;
  readonly causalAcquisitionChannels: Set<MarketingChannel>;
}

export interface RuntimeCustomerState {
  readonly customerId: string;
  readonly populationWeight: number;
  readonly source: LatentCustomer;

  need: number;
  intent: number;
  awareness: number;
  consideration: number;
  brandAffinity: number;

  lifecycle: RuntimeLifecycleState;
  purchaseCount: number;
  lastPurchaseMs?: number;
  lastActivityMs: number;
  nextNeedEligibleMs: number;
  churned: boolean;
  readonly retention: RuntimeRetentionState;

  channelMemory: Map<MarketingChannel, ChannelMemory>;
  interactionMemory: Map<string, InteractionMemoryState>;
  futureAudience: FutureAudienceState;
  cart?: PersistentCart;
}

export interface RuntimeWorldState {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly customers: Map<string, RuntimeCustomerState>;
  /**
   * Legacy Step 4-8 projection. Step 9 authoritative state lives in
   * inventoryEconomy. Backorders may still appear as negative values here
   * solely to preserve frozen inherited behavior.
   */
  readonly inventory: Map<string, number>;
  readonly initialInventory: ReadonlyMap<string, number>;
  readonly inventoryEconomy: InventoryEconomyRuntime;
  readonly activePromotions: Set<string>;
  readonly interventionValues: Map<string, number | boolean | string>;
}

function initialLifecycle(customer: LatentCustomer): RuntimeLifecycleState {
  switch (customer.lifecycle.state) {
    case "prospect":
      return "prospect";
    case "abstract_recent_buyer":
      return "active_customer";
    case "abstract_active_repeat":
      return "repeat_customer";
    case "abstract_lapsing":
      return "lapsing";
    case "abstract_dormant":
      return "dormant";
    case "abstract_subscriber":
      return "subscriber";
  }
}

export function createRuntimeWorldState(
  merchantWorld: GeneratedMerchantWorld,
  latentPopulation: LatentCustomerPopulation,
  startMs: number,
  retentionEnabled = false,
): RuntimeWorldState {
  if (latentPopulation.merchantWorldId !== merchantWorld.manifest.worldId) {
    throw new RangeError(
      "latent population does not belong to the supplied merchant world",
    );
  }

  const customers = new Map<string, RuntimeCustomerState>();
  for (const customer of latentPopulation.customers) {
    customers.set(customer.customerId, {
      customerId: customer.customerId,
      populationWeight: customer.populationWeight,
      source: customer,
      need: clamp(customer.currentPurchaseNeed, 0, 1),
      intent: clamp(customer.purchaseIntent, 0, 1),
      awareness: clamp(customer.brandAffinity * 0.75, 0, 1),
      consideration: clamp(
        customer.purchaseIntent * 0.5 +
          customer.currentPurchaseNeed * 0.35 +
          customer.brandAffinity * 0.15,
        0,
        1,
      ),
      brandAffinity: clamp(customer.brandAffinity, 0, 1),
      lifecycle: initialLifecycle(customer),
      purchaseCount:
        customer.lifecycle.preSimulationHistory === "none" ? 0 : 1,
      lastActivityMs: startMs,
      nextNeedEligibleMs: startMs,
      churned: false,
      retention: {
        enabled: retentionEnabled,
        repeatHazardQualityMultiplier: 1,
        promotionDependenceShift: 0,
        trueChurnState: "active",
        reactivationCount: 0,
        ownedProductQuantities: new Map(),
        categoryFamiliarity: new Map(),
        causalAcquisitionChannels: new Set(),
      },
      channelMemory: new Map(),
      interactionMemory: new Map(),
      futureAudience: {
        retargetingEligibility:
          customer.naturalSelection.retargetingEligibilityProbability,
        emailEligibility:
          customer.naturalSelection.emailSubscriptionProbability,
        brandedSearchReadiness:
          customer.naturalSelection.brandedDirectProbability,
        recentSiteVisitScore: 0,
        createdByChannels: new Set(),
      },
    });
  }

  const inventoryEconomy = createInventoryEconomyState(
    merchantWorld,
    startMs,
  );
  const inventory = new Map<string, number>();
  for (const mechanism of merchantWorld.manifest.inventoryMechanisms) {
    inventory.set(
      mechanism.productId,
      legacyNetAvailableUnits(
        inventoryEconomy,
        mechanism.productId,
      ),
    );
  }

  return {
    merchantWorld,
    latentPopulation,
    customers,
    inventory,
    initialInventory: new Map(inventory),
    inventoryEconomy,
    activePromotions: new Set(),
    interventionValues: new Map(),
  };
}

export function decayChannelMemory(
  memory: ChannelMemory,
  nowMs: number,
): void {
  if (nowMs <= memory.lastUpdatedMs) return;
  const elapsed = nowMs - memory.lastUpdatedMs;
  const factor =
    memory.halfLifeMs <= 0
      ? 0
      : Math.pow(0.5, elapsed / memory.halfLifeMs);

  memory.awarenessLift *= factor;
  memory.considerationLift *= factor;
  memory.purchaseProbabilityLift *= factor;
  memory.productPreferenceLift *= factor;
  memory.lastUpdatedMs = nowMs;
}

export function decayAllCustomerMemory(
  customer: RuntimeCustomerState,
  nowMs: number,
): void {
  for (const memory of customer.channelMemory.values()) {
    decayChannelMemory(memory, nowMs);
  }

  for (const memory of customer.interactionMemory.values()) {
    if (nowMs <= memory.lastUpdatedMs) continue;
    const elapsed = nowMs - memory.lastUpdatedMs;
    const factor =
      memory.halfLifeMs <= 0
        ? 0
        : Math.pow(0.5, elapsed / memory.halfLifeMs);
    memory.value *= factor;
    memory.lastUpdatedMs = nowMs;
  }

  const elapsed = Math.max(0, nowMs - customer.lastActivityMs);
  if (elapsed > 0) {
    // Intent does not disappear immediately. It slowly drifts toward the
    // customer's latent baseline when no reinforcing state/event occurs.
    const baseline = clamp(customer.source.purchaseIntent, 0, 1);
    const meanReversion = 1 - Math.exp(-elapsed / days(21));
    customer.intent =
      customer.intent * (1 - meanReversion) + baseline * meanReversion;

    // Current need decays more slowly for high-consideration purchases.
    const needHalfLifeDays = clamp(
      customer.source.expectedPurchaseIntervalDays * 0.12,
      4,
      90,
    );
    customer.need *= Math.pow(0.5, elapsed / days(needHalfLifeDays));

    const audienceDecay = Math.pow(0.5, elapsed / days(14));
    customer.futureAudience.recentSiteVisitScore *= audienceDecay;
    customer.futureAudience.retargetingEligibility = clamp(
      customer.source.naturalSelection.retargetingEligibilityProbability * 0.45 +
        customer.futureAudience.retargetingEligibility * audienceDecay,
      0,
      1,
    );
    customer.futureAudience.brandedSearchReadiness = clamp(
      customer.source.naturalSelection.brandedDirectProbability * 0.5 +
        customer.futureAudience.brandedSearchReadiness * Math.pow(0.5, elapsed / days(21)),
      0,
      1,
    );
  }

  customer.lastActivityMs = nowMs;
}

export function totalMemoryLift(
  customer: RuntimeCustomerState,
): {
  readonly awareness: number;
  readonly consideration: number;
  readonly purchaseProbability: number;
  readonly productPreference: number;
} {
  let awareness = 0;
  let consideration = 0;
  let purchaseProbability = 0;
  let productPreference = 0;

  for (const memory of customer.channelMemory.values()) {
    awareness += memory.awarenessLift;
    consideration += memory.considerationLift;
    purchaseProbability += memory.purchaseProbabilityLift;
    productPreference += memory.productPreferenceLift;
  }

  return {
    awareness,
    consideration,
    purchaseProbability,
    productPreference,
  };
}

export function refreshLatentCustomerState(
  customer: RuntimeCustomerState,
  nowMs: number,
): void {
  decayAllCustomerMemory(customer, nowMs);
  const memory = totalMemoryLift(customer);

  customer.awareness = clamp(
    customer.source.brandAffinity * 0.65 + memory.awareness,
    0,
    1,
  );
  customer.consideration = clamp(
    customer.need * 0.35 +
      customer.intent * 0.38 +
      customer.awareness * 0.17 +
      memory.consideration,
    0,
    1,
  );
  customer.intent = clamp(
    customer.source.purchaseIntent * 0.28 +
      customer.need * 0.42 +
      customer.brandAffinity * 0.1 +
      customer.consideration * 0.14 +
      memory.purchaseProbability,
    0,
    1,
  );
}

export function markNeedFormation(
  customer: RuntimeCustomerState,
  strength: number,
  nowMs: number,
): void {
  refreshLatentCustomerState(customer, nowMs);
  customer.need = clamp(Math.max(customer.need, strength), 0, 1);
  customer.intent = clamp(
    customer.intent + strength * 0.32,
    0,
    1,
  );
  customer.consideration = clamp(
    customer.consideration + strength * 0.18,
    0,
    1,
  );
  if (customer.lifecycle === "prospect") {
    customer.lifecycle = "engaged_prospect";
  } else if (
    customer.retention.enabled &&
    (customer.lifecycle === "lapsing" ||
      customer.lifecycle === "dormant" ||
      (customer.lifecycle === "churned" &&
        customer.retention.trueChurnState !==
          "permanent_churned"))
  ) {
    customer.lifecycle = "active_customer";
    customer.churned = false;
    customer.retention.trueChurnState = "active";
    customer.retention.reactivationCount += 1;
  }
  customer.lastActivityMs = nowMs;
}

export function applyMarketingMemory(
  customer: RuntimeCustomerState,
  channelId: MarketingChannel,
  nowMs: number,
  effect: {
    readonly awarenessLift: number;
    readonly considerationLift: number;
    readonly purchaseProbabilityLift: number;
    readonly productPreferenceLift: number;
    readonly halfLifeMs: number;
  },
): void {
  refreshLatentCustomerState(customer, nowMs);

  const current =
    customer.channelMemory.get(channelId) ??
    {
      channelId,
      awarenessLift: 0,
      considerationLift: 0,
      purchaseProbabilityLift: 0,
      productPreferenceLift: 0,
      lastUpdatedMs: nowMs,
      halfLifeMs: effect.halfLifeMs,
      exposures: 0,
    };

  decayChannelMemory(current, nowMs);
  current.awarenessLift += effect.awarenessLift;
  current.considerationLift += effect.considerationLift;
  current.purchaseProbabilityLift += effect.purchaseProbabilityLift;
  current.productPreferenceLift += effect.productPreferenceLift;
  current.halfLifeMs = effect.halfLifeMs;
  current.exposures += 1;
  current.lastUpdatedMs = nowMs;
  customer.channelMemory.set(channelId, current);

  refreshLatentCustomerState(customer, nowMs);
}

export interface RetentionPurchaseTransitionOptions {
  readonly brandAffinityDelta: number;
  readonly repeatHazardQualityMultiplier: number;
  readonly promotionDependenceDelta: number;
  readonly loyalPurchaseThreshold: number;
  readonly productQuantities: Readonly<Record<string, number>>;
  readonly productCategories: Readonly<Record<string, string>>;
  readonly causalAcquisitionChannels: readonly MarketingChannel[];
}

export function transitionAfterPurchase(
  customer: RuntimeCustomerState,
  nowMs: number,
  needDeferralMultiplier = 1,
  retention?: RetentionPurchaseTransitionOptions,
): void {
  customer.purchaseCount += 1;
  customer.lastPurchaseMs = nowMs;
  customer.need = 0.02;
  customer.intent = clamp(customer.intent * 0.22, 0, 1);
  customer.consideration = clamp(customer.consideration * 0.25, 0, 1);

  if (retention === undefined) {
    customer.brandAffinity = clamp(
      customer.brandAffinity +
        0.02 * (1 - customer.brandAffinity),
      0,
      1,
    );
  } else {
    customer.brandAffinity = clamp(
      customer.brandAffinity +
        retention.brandAffinityDelta,
      0,
      1,
    );
    customer.retention.repeatHazardQualityMultiplier =
      clamp(
        retention.repeatHazardQualityMultiplier,
        0.05,
        8,
      );
    customer.retention.promotionDependenceShift =
      clamp(
        customer.retention.promotionDependenceShift +
          retention.promotionDependenceDelta,
        -2,
        3,
      );
    for (const [productId, quantity] of Object.entries(
      retention.productQuantities,
    )) {
      customer.retention.ownedProductQuantities.set(
        productId,
        (customer.retention.ownedProductQuantities.get(
          productId,
        ) ?? 0) + quantity,
      );
      const categoryId =
        retention.productCategories[productId];
      if (categoryId !== undefined) {
        customer.retention.categoryFamiliarity.set(
          categoryId,
          Math.min(
            6,
            (customer.retention.categoryFamiliarity.get(
              categoryId,
            ) ?? 0) +
              Math.max(0.25, quantity * 0.5),
          ),
        );
      }
    }
    for (const channel of retention.causalAcquisitionChannels) {
      customer.retention.causalAcquisitionChannels.add(
        channel,
      );
    }
    customer.retention.trueChurnState = "active";
    customer.churned = false;
  }

  customer.lifecycle =
    customer.purchaseCount <= 1
      ? "first_time_buyer"
      : retention !== undefined &&
          customer.purchaseCount >=
            retention.loyalPurchaseThreshold
        ? "loyal_customer"
        : "repeat_customer";

  const intervalDays = Math.max(
    3,
    customer.source.expectedPurchaseIntervalDays,
  );
  customer.nextNeedEligibleMs =
    nowMs +
    days(
      intervalDays *
        0.35 *
        clamp(needDeferralMultiplier, 1, 8),
    );
  customer.lastActivityMs = nowMs;
}

export interface RetentionLifecycleTransitionOptions {
  readonly lapseAfterIntervals: number;
  readonly dormantAfterIntervals: number;
  readonly latentChurnAfterIntervals: number;
  readonly permanentChurnAfterIntervals: number | null;
}

export function transitionLifecycleForInactivity(
  customer: RuntimeCustomerState,
  nowMs: number,
  retention?: RetentionLifecycleTransitionOptions,
): void {
  if (customer.churned) return;

  if (retention === undefined) {
    const sinceActivity = nowMs - customer.lastActivityMs;
    const interval = days(
      Math.max(7, customer.source.expectedPurchaseIntervalDays),
    );

    if (customer.purchaseCount > 0) {
      if (sinceActivity > interval * 4.5) {
        customer.lifecycle = "dormant";
      } else if (sinceActivity > interval * 2.2) {
        customer.lifecycle = "lapsing";
      } else if (customer.purchaseCount > 1) {
        customer.lifecycle = "repeat_customer";
      } else {
        customer.lifecycle = "active_customer";
      }
    }

    if (
      sinceActivity > interval * 8 &&
      customer.source.repeatPropensity < 0.35
    ) {
      customer.lifecycle = "churned";
      customer.churned = true;
    }
    return;
  }

  if (customer.purchaseCount <= 0) return;

  const referenceMs =
    customer.lastPurchaseMs ?? customer.lastActivityMs;
  const sincePurchase = Math.max(
    0,
    nowMs - referenceMs,
  );
  const interval = days(
    Math.max(7, customer.source.expectedPurchaseIntervalDays),
  );
  const elapsedIntervals =
    sincePurchase / Math.max(1, interval);

  if (
    retention.permanentChurnAfterIntervals !== null &&
    elapsedIntervals >=
      retention.permanentChurnAfterIntervals
  ) {
    customer.lifecycle = "churned";
    customer.churned = true;
    customer.retention.trueChurnState =
      "permanent_churned";
    return;
  }

  if (
    elapsedIntervals >=
      retention.latentChurnAfterIntervals
  ) {
    customer.lifecycle = "dormant";
    customer.retention.trueChurnState =
      "latent_churned";
    return;
  }

  customer.retention.trueChurnState = "active";
  if (
    elapsedIntervals >=
    retention.dormantAfterIntervals
  ) {
    customer.lifecycle = "dormant";
  } else if (
    elapsedIntervals >=
    retention.lapseAfterIntervals
  ) {
    customer.lifecycle = "lapsing";
  } else if (customer.purchaseCount >= 4) {
    customer.lifecycle = "loyal_customer";
  } else if (customer.purchaseCount > 1) {
    customer.lifecycle = "repeat_customer";
  } else {
    customer.lifecycle = "active_customer";
  }
}


export function recordSiteVisitForFutureAudience(
  customer: RuntimeCustomerState,
  source: MarketingChannel | "organic_search" | "direct" | "referral",
  nowMs: number,
): void {
  decayAllCustomerMemory(customer, nowMs);
  customer.futureAudience.recentSiteVisitScore = clamp(
    customer.futureAudience.recentSiteVisitScore + 0.3,
    0,
    1,
  );
  customer.futureAudience.retargetingEligibility = clamp(
    Math.max(
      customer.futureAudience.retargetingEligibility,
      0.28 +
        customer.intent * 0.42 +
        customer.consideration * 0.2 +
        customer.futureAudience.recentSiteVisitScore * 0.1,
    ),
    0,
    1,
  );
  customer.futureAudience.emailEligibility = clamp(
    Math.max(
      customer.futureAudience.emailEligibility,
      0.2 +
        customer.brandAffinity * 0.45 +
        customer.consideration * 0.2,
    ),
    0,
    1,
  );

  if (
    source !== "organic_search" &&
    source !== "direct" &&
    source !== "referral"
  ) {
    customer.futureAudience.createdByChannels.add(source);
  }
}

export function recordBrandedSearchReadiness(
  customer: RuntimeCustomerState,
  lift: number,
  sourceChannel: MarketingChannel,
  nowMs: number,
): void {
  decayAllCustomerMemory(customer, nowMs);
  customer.futureAudience.brandedSearchReadiness = clamp(
    customer.futureAudience.brandedSearchReadiness + lift,
    0,
    1,
  );
  if (lift !== 0) {
    customer.futureAudience.createdByChannels.add(sourceChannel);
  }
}
