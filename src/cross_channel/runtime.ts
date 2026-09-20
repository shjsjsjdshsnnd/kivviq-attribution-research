import type { MarketingChannel } from "../generation/config.js";
import type { SimulationInterventionState } from "../simulation/interventions.js";
import type {
  RuntimeCustomerState,
  RuntimeWorldState,
} from "../simulation/state.js";
import {
  decayAllCustomerMemory,
  recordBrandedSearchReadiness,
} from "../simulation/state.js";
import type {
  CompiledInteractionRule,
  CrossChannelInteractionNetwork,
  FutureAudienceSummary,
  InteractionCausalTruth,
} from "./types.js";
import { customerInteractionMultiplier } from "./network.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface OpportunityModifiers {
  readonly directMultiplier: number;
  readonly organicMultiplier: number;
  readonly brandedSearchMultiplier: number;
  readonly channelMultipliers: ReadonlyMap<MarketingChannel, number>;
}

export interface InteractionRuntimeContext {
  readonly timestampMs: number;
  readonly promotionActive: boolean;
  readonly inventoryAvailabilityRatio: number;
  readonly interventionState: SimulationInterventionState;
}

function conditionMultiplier(
  rule: CompiledInteractionRule,
  customer: RuntimeCustomerState,
  context: InteractionRuntimeContext,
): number {
  const condition = rule.condition;
  if (!condition) return 1;

  if (
    condition.promotionActive !== undefined &&
    condition.promotionActive !== context.promotionActive
  ) {
    return 0;
  }

  if (
    condition.minimumIntent !== undefined &&
    customer.intent < condition.minimumIntent
  ) {
    return 0;
  }

  if (
    condition.minimumAwareness !== undefined &&
    customer.awareness < condition.minimumAwareness
  ) {
    return 0;
  }

  if (
    condition.inventoryAvailabilityAtLeast !== undefined &&
    context.inventoryAvailabilityRatio <
      condition.inventoryAvailabilityAtLeast
  ) {
    return 0;
  }

  if (
    condition.lifecycleStates !== undefined &&
    !condition.lifecycleStates.includes(customer.lifecycle)
  ) {
    return 0;
  }

  if (condition.months !== undefined) {
    const month =
      new Date(context.timestampMs).getUTCMonth() + 1;
    if (!condition.months.includes(month)) return 0;
  }

  return 1;
}

function allConditionChannelsActive(
  rule: CompiledInteractionRule,
  customer: RuntimeCustomerState,
  currentDriver?: MarketingChannel,
): boolean {
  return rule.conditionedOnChannels
    .filter((channel) => channel !== currentDriver)
    .every((channel) => {
      const memory = customer.channelMemory.get(channel);
      return memory !== undefined && memory.exposures > 0;
    });
}

function interactionMemoryValue(
  customer: RuntimeCustomerState,
  mechanismId: string,
): number {
  return customer.interactionMemory.get(mechanismId)?.value ?? 0;
}

function targetChannelMultiplier(
  map: Map<MarketingChannel, number>,
  channel: MarketingChannel,
  relativeEffect: number,
): void {
  map.set(
    channel,
    clamp(
      (map.get(channel) ?? 1) *
        Math.max(0.02, 1 + relativeEffect),
      0.02,
      4,
    ),
  );
}

export interface PreparedInteractionApplication {
  readonly truth: InteractionCausalTruth;
  readonly applyAtMs: number;
}

export function prepareExposureInteractions(
  network: CrossChannelInteractionNetwork,
  customer: RuntimeCustomerState,
  sourceChannel: MarketingChannel,
  context: InteractionRuntimeContext,
): readonly PreparedInteractionApplication[] {
  decayAllCustomerMemory(customer, context.timestampMs);

  const prepared: PreparedInteractionApplication[] = [];

  for (const rule of network.rules) {
    if (!rule.driverChannels.includes(sourceChannel)) continue;
    if (rule.kind === "zero" || rule.effectValue === 0) continue;

    if (
      rule.kind === "synergy" &&
      !allConditionChannelsActive(
        rule,
        customer,
        sourceChannel,
      )
    ) {
      continue;
    }

    const stateMultiplier = conditionMultiplier(
      rule,
      customer,
      context,
    );
    if (stateMultiplier === 0) continue;

    const customerMultiplier =
      customerInteractionMultiplier(rule, customer.source);

    const driverSpendScale =
      context.interventionState.channelSpendScale.get(
        sourceChannel,
      ) ?? 1;
    const saturationAdjustment = clamp(
      1 / Math.max(1, Math.sqrt(driverSpendScale)),
      0.3,
      1,
    );

    const baseEffect =
      rule.effectValue * saturationAdjustment;
    const appliedEffect =
      baseEffect *
      customerMultiplier *
      stateMultiplier;

    prepared.push({
      applyAtMs: context.timestampMs + rule.lagMs,
      truth: {
        mechanismId: rule.mechanismId,
        customerId: customer.customerId,
        occurredAt: new Date(context.timestampMs).toISOString(),
        kind: rule.kind,
        participantChannels: rule.participantChannels,
        sourceVariableIds: rule.sourceVariableIds,
        targetVariableIds: rule.targetVariableIds,
        targetSemantic: rule.targetSemantic,
        baseEffect,
        customerMultiplier,
        stateMultiplier,
        decayMultiplier: 1,
        appliedEffect,
        lagMs: rule.lagMs,
      },
    });
  }

  return prepared;
}

export function applyPreparedInteraction(
  network: CrossChannelInteractionNetwork,
  customer: RuntimeCustomerState,
  truth: InteractionCausalTruth,
  timestampMs: number,
): void {
  const rule = network.rules.find(
    (candidate) =>
      candidate.mechanismId === truth.mechanismId,
  );
  if (!rule) {
    throw new RangeError(
      `unknown interaction mechanism ${truth.mechanismId}`,
    );
  }

  decayAllCustomerMemory(customer, timestampMs);

  const current =
    customer.interactionMemory.get(rule.mechanismId) ?? {
      mechanismId: rule.mechanismId,
      participantChannels: rule.participantChannels,
      value: 0,
      lastUpdatedMs: timestampMs,
      halfLifeMs: rule.halfLifeMs,
    };

  current.value += truth.appliedEffect;
  current.lastUpdatedMs = timestampMs;
  current.halfLifeMs = rule.halfLifeMs;
  customer.interactionMemory.set(
    rule.mechanismId,
    current,
  );

  const sourceChannel =
    rule.driverChannels[0] ??
    rule.participantChannels[0];

  if (
    sourceChannel !== undefined &&
    rule.targetSemantic ===
      "branded_search_probability"
  ) {
    recordBrandedSearchReadiness(
      customer,
      truth.appliedEffect * 0.35,
      sourceChannel,
      timestampMs,
    );
  }

  if (
    sourceChannel !== undefined &&
    rule.targetSemantic ===
      "retargeting_eligibility"
  ) {
    customer.futureAudience.retargetingEligibility =
      clamp(
        customer.futureAudience.retargetingEligibility +
          truth.appliedEffect * 0.45,
        0,
        1,
      );
    customer.futureAudience.createdByChannels.add(
      sourceChannel,
    );
  }

  if (
    sourceChannel !== undefined &&
    rule.targetSemantic === "email_eligibility"
  ) {
    customer.futureAudience.emailEligibility = clamp(
      customer.futureAudience.emailEligibility +
        truth.appliedEffect * 0.35,
      0,
      1,
    );
    customer.futureAudience.createdByChannels.add(
      sourceChannel,
    );
  }
}


export function opportunityModifiers(
  network: CrossChannelInteractionNetwork,
  customer: RuntimeCustomerState,
  context: InteractionRuntimeContext,
): OpportunityModifiers {
  decayAllCustomerMemory(customer, context.timestampMs);

  let directMultiplier = 1;
  let organicMultiplier = 1;
  let brandedSearchMultiplier =
    1 +
    customer.futureAudience.brandedSearchReadiness *
      0.45;

  const channelMultipliers =
    new Map<MarketingChannel, number>();

  for (const channel of network.activeChannels) {
    channelMultipliers.set(channel, 1);
  }

  for (const rule of network.rules) {
    const stateMultiplier = conditionMultiplier(
      rule,
      customer,
      context,
    );
    if (stateMultiplier === 0) continue;

    const memory = interactionMemoryValue(
      customer,
      rule.mechanismId,
    );
    const customerMultiplier =
      customerInteractionMultiplier(rule, customer.source);
    const effect =
      (memory !== 0 ? memory : rule.effectValue * 0.25) *
      stateMultiplier *
      customerMultiplier;

    if (
      rule.kind === "substitution" ||
      rule.kind === "cannibalization"
    ) {
      const driver = rule.driverChannels[0];
      const driverScale =
        driver === undefined
          ? 1
          : context.interventionState.channelSpendScale.get(
              driver,
            ) ?? 1;

      if (driverScale > 0) {
        const suppression =
          Math.abs(effect) * Math.min(1.5, driverScale);
        if (
          rule.targetSemantic ===
          "direct_visit_probability"
        ) {
          directMultiplier *= Math.max(
            0.1,
            1 - suppression,
          );
        } else if (
          rule.targetSemantic ===
          "organic_visit_probability"
        ) {
          organicMultiplier *= Math.max(
            0.1,
            1 - suppression,
          );
        } else if (
          rule.targetSemantic ===
          "organic_direct_probability"
        ) {
          directMultiplier *= Math.max(
            0.1,
            1 - suppression,
          );
          organicMultiplier *= Math.max(
            0.1,
            1 - suppression,
          );
        }

        for (const target of rule.targetChannels) {
          targetChannelMultiplier(
            channelMultipliers,
            target,
            -suppression,
          );
        }
      } else if (rule.kind === "substitution") {
        // When the paid route disappears, preserve the possibility of
        // reaching the merchant through another route.
        directMultiplier *= 1 + Math.abs(effect) * 0.8;
        organicMultiplier *= 1 + Math.abs(effect) * 0.65;
        for (const target of rule.targetChannels) {
          targetChannelMultiplier(
            channelMultipliers,
            target,
            Math.abs(effect) * 0.55,
          );
        }
      }
      continue;
    }

    if (
      rule.targetSemantic ===
      "branded_search_probability"
    ) {
      brandedSearchMultiplier *= 1 + effect;
    } else if (
      rule.targetSemantic ===
      "organic_visit_probability"
    ) {
      organicMultiplier *= 1 + effect;
    } else if (
      rule.targetSemantic ===
      "direct_visit_probability"
    ) {
      directMultiplier *= 1 + effect;
    } else if (
      rule.targetSemantic ===
      "organic_direct_probability"
    ) {
      organicMultiplier *= 1 + effect * 0.7;
      directMultiplier *= 1 + effect * 0.55;
    } else if (
      rule.targetSemantic === "channel_opportunity"
    ) {
      for (const target of rule.targetChannels) {
        targetChannelMultiplier(
          channelMultipliers,
          target,
          effect,
        );
      }
    }

    if (rule.kind === "audience_depletion") {
      for (const target of rule.targetChannels) {
        targetChannelMultiplier(
          channelMultipliers,
          target,
          -Math.abs(effect),
        );
      }
    }
  }

  return {
    directMultiplier: clamp(
      directMultiplier,
      0.05,
      4,
    ),
    organicMultiplier: clamp(
      organicMultiplier,
      0.05,
      4,
    ),
    brandedSearchMultiplier: clamp(
      brandedSearchMultiplier,
      0.1,
      4,
    ),
    channelMultipliers,
  };
}

export function conditionalResponseMultiplier(
  network: CrossChannelInteractionNetwork,
  customer: RuntimeCustomerState,
  targetChannel: MarketingChannel,
  context: InteractionRuntimeContext,
): number {
  decayAllCustomerMemory(customer, context.timestampMs);
  let multiplier = 1;

  for (const rule of network.rules) {
    if (rule.kind === "zero") continue;
    if (
      !rule.participantChannels.includes(
        targetChannel,
      )
    ) {
      continue;
    }

    const stateMultiplier = conditionMultiplier(
      rule,
      customer,
      context,
    );
    if (stateMultiplier === 0) continue;

    const allOthersActive =
      rule.participantChannels
        .filter((channel) => channel !== targetChannel)
        .every((channel) => {
          const memory =
            customer.channelMemory.get(channel);
          return (
            memory !== undefined &&
            memory.exposures > 0
          );
        });

    if (
      (rule.kind === "synergy" ||
        rule.kind === "state_dependent") &&
      !allOthersActive &&
      rule.conditionedOnChannels.length > 0
    ) {
      continue;
    }

    const customerMultiplier =
      customerInteractionMultiplier(rule, customer.source);
    const memory =
      interactionMemoryValue(
        customer,
        rule.mechanismId,
      );

    const effective =
      (memory !== 0 ? memory : rule.effectValue) *
      stateMultiplier *
      customerMultiplier;

    if (
      rule.kind === "synergy" ||
      rule.kind === "state_dependent" ||
      rule.kind === "delayed"
    ) {
      multiplier *= Math.max(0.05, 1 + effective);
    } else if (
      rule.kind === "cannibalization" ||
      rule.kind === "audience_depletion"
    ) {
      multiplier *= Math.max(
        0.05,
        1 - Math.abs(effective),
      );
    }
  }

  return clamp(multiplier, 0.05, 5);
}

export function checkoutInteractionLift(
  network: CrossChannelInteractionNetwork,
  customer: RuntimeCustomerState,
  context: InteractionRuntimeContext,
): number {
  let lift = 0;

  for (const rule of network.rules) {
    if (
      rule.targetSemantic !==
        "conversion_probability" &&
      rule.targetSemantic !== "channel_response"
    ) {
      continue;
    }

    const stateMultiplier = conditionMultiplier(
      rule,
      customer,
      context,
    );
    if (stateMultiplier === 0) continue;

    const allChannelsActive =
      rule.participantChannels.every((channel) => {
        const memory =
          customer.channelMemory.get(channel);
        return (
          memory !== undefined &&
          memory.exposures > 0
        );
      });

    if (
      rule.participantChannels.length > 0 &&
      !allChannelsActive
    ) {
      continue;
    }

    const customerMultiplier =
      customerInteractionMultiplier(rule, customer.source);
    const memory =
      interactionMemoryValue(
        customer,
        rule.mechanismId,
      );
    const effect =
      (memory !== 0 ? memory : rule.effectValue) *
      stateMultiplier *
      customerMultiplier;

    if (
      rule.kind === "synergy" ||
      rule.kind === "state_dependent" ||
      rule.kind === "delayed"
    ) {
      lift += effect * 0.2;
    } else if (
      rule.kind === "cannibalization"
    ) {
      lift -= Math.abs(effect) * 0.15;
    }
  }

  return clamp(lift, -0.35, 0.35);
}

export function paidExposureOpportunityMultiplier(
  network: CrossChannelInteractionNetwork,
  customer: RuntimeCustomerState,
  channel: MarketingChannel,
  context: InteractionRuntimeContext,
): number {
  let multiplier =
    opportunityModifiers(
      network,
      customer,
      context,
    ).channelMultipliers.get(channel) ?? 1;

  if (
    channel === "meta" ||
    channel === "google_shopping"
  ) {
    multiplier *=
      0.65 +
      customer.futureAudience
        .retargetingEligibility *
        0.7;
  }

  if (channel === "email") {
    multiplier *=
      0.55 +
      customer.futureAudience.emailEligibility *
        0.8;
  }

  return clamp(multiplier, 0.05, 4);
}

export function futureAudienceSummary(
  runtime: RuntimeWorldState,
): FutureAudienceSummary {
  let retargeting = 0;
  let email = 0;
  let branded = 0;
  let visitors = 0;

  for (const customer of runtime.customers.values()) {
    const weight = customer.populationWeight;
    retargeting +=
      customer.futureAudience
        .retargetingEligibility *
      weight;
    email +=
      customer.futureAudience.emailEligibility *
      weight;
    branded +=
      customer.futureAudience
        .brandedSearchReadiness *
      weight;
    visitors +=
      customer.futureAudience.recentSiteVisitScore *
      weight;
  }

  return {
    representedRetargetingEligible: retargeting,
    representedEmailEligible: email,
    representedBrandedSearchReady: branded,
    representedRecentVisitors: visitors,
  };
}
