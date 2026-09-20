import type { LatentCustomer, LatentCustomerPopulation } from "../customer_population/types.js";
import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";
import type { ChannelInteractionMechanism } from "../ground_truth/ontology.js";
import type {
  AudienceOverlapMatrix,
  CompiledInteractionRule,
  CrossChannelInteractionNetwork,
  ExecutableInteractionKind,
  InteractionTargetSemantic,
} from "./types.js";
import { CROSS_CHANNEL_VERSION } from "./types.js";

export class CrossChannelNetworkError extends Error {}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function inferTargetSemantic(
  mechanism: ChannelInteractionMechanism,
  sourceVariables: readonly string[],
  targetVariables: readonly string[],
): InteractionTargetSemantic {
  const targets = targetVariables.join("|");
  const sources = sourceVariables.join("|");
  const channels = mechanism.channelIds;

  if (
    targets.includes("retargeting") ||
    mechanism.mediatorVariable?.includes("retargeting")
  ) {
    return "retargeting_eligibility";
  }
  if (
    targets.includes("email") ||
    mechanism.mediatorVariable?.includes("email")
  ) {
    return "email_eligibility";
  }
  if (
    targets.includes("branded") ||
    (mechanism.kind === "mediation" &&
      channels[0] === "meta" &&
      channels.includes("google_search"))
  ) {
    return "branded_search_probability";
  }
  if (
    mechanism.kind === "mediation" &&
    channels[0] === "pinterest"
  ) {
    return "organic_direct_probability";
  }
  if (
    targets.includes("direct") &&
    targets.includes("organic")
  ) {
    return "organic_direct_probability";
  }
  if (targets.includes("direct")) {
    return "direct_visit_probability";
  }
  if (targets.includes("organic")) {
    return "organic_visit_probability";
  }
  if (
    targets.includes("purchase_probability") ||
    targets.includes("commerce.orders")
  ) {
    return "conversion_probability";
  }
  if (
    targets.includes("product") ||
    mechanism.mediatorVariable?.includes("product")
  ) {
    return "product_preference";
  }
  if (
    targets.includes("customer.brand_awareness") ||
    sources.includes("promotion.discount_active")
  ) {
    return "channel_response";
  }
  return "channel_opportunity";
}

function inferExecutableKind(
  mechanism: ChannelInteractionMechanism,
  sourceVariables: readonly string[],
  targetVariables: readonly string[],
): ExecutableInteractionKind {
  const allVariables = [...sourceVariables, ...targetVariables].join("|");

  if (mechanism.kind === "zero") return "zero";

  if (
    allVariables.includes("retargeting_eligibility") ||
    allVariables.includes("email_eligibility")
  ) {
    return mechanism.effect.value < 0
      ? "audience_depletion"
      : "audience_creation";
  }

  if (
    sourceVariables.includes("promotion.discount_active") ||
    sourceVariables.includes("inventory.available")
  ) {
    return "state_dependent";
  }

  if (
    mechanism.kind === "cannibalization" &&
    (allVariables.includes("direct") ||
      allVariables.includes("organic"))
  ) {
    return "substitution";
  }

  if (mechanism.kind === "delayed") return "delayed";
  return mechanism.kind;
}

function defaultVariables(
  mechanism: ChannelInteractionMechanism,
): {
  readonly sources: readonly string[];
  readonly targets: readonly string[];
} {
  const source = mechanism.channelIds[0];
  const targets = mechanism.channelIds.slice(1);

  const sources = source
    ? [`marketing.${source}.exposure`]
    : ["customer.brand_awareness"];

  if (mechanism.kind === "mediation") {
    return {
      sources,
      targets: [
        mechanism.mediatorVariable ?? "customer.brand_awareness",
      ],
    };
  }

  if (mechanism.kind === "cannibalization") {
    return {
      sources,
      targets: [
        targets[0]
          ? `marketing.${targets[0]}.exposure`
          : "funnel.purchase_probability",
      ],
    };
  }

  return {
    sources: mechanism.channelIds.map(
      (channel) => `marketing.${channel}.exposure`,
    ),
    targets: ["funnel.purchase_probability"],
  };
}

function halfLifeMs(
  mechanism: ChannelInteractionMechanism,
): number {
  const lag = Number(mechanism.delaySeconds ?? 0) * 1_000;
  if (lag > 0) return Math.max(86_400_000, lag * 2);
  if (mechanism.kind === "mediation") return 5 * 86_400_000;
  if (mechanism.kind === "delayed") return 7 * 86_400_000;
  return 2 * 86_400_000;
}

function compileRule(
  world: GeneratedMerchantWorld,
  mechanism: ChannelInteractionMechanism,
): CompiledInteractionRule {
  const edges = world.manifest.causalGraph.edges.filter(
    (edge) => edge.mechanismId === mechanism.id,
  );

  const fallback = defaultVariables(mechanism);
  const sourceVariableIds = [
    ...new Set(
      edges.length > 0
        ? edges.map((edge) => edge.parent)
        : fallback.sources,
    ),
  ];
  const targetVariableIds = [
    ...new Set(
      edges.length > 0
        ? edges.map((edge) => edge.child)
        : fallback.targets,
    ),
  ];

  const participantChannels =
    mechanism.channelIds.filter(
      (channel): channel is MarketingChannel =>
        world.summary.activeChannels.includes(
          channel as MarketingChannel,
        ),
    );

  if (participantChannels.length === 0) {
    throw new CrossChannelNetworkError(
      `interaction ${mechanism.id} has no active participant channel`,
    );
  }

  const driverChannels =
    mechanism.kind === "synergy"
      ? participantChannels
      : participantChannels.slice(0, 1);
  const conditionedOnChannels =
    mechanism.kind === "synergy"
      ? participantChannels
      : participantChannels.slice(1);

  const targetChannels =
    mechanism.kind === "synergy"
      ? []
      : participantChannels.slice(1);

  const executableKind = inferExecutableKind(
    mechanism,
    sourceVariableIds,
    targetVariableIds,
  );

  const condition =
    executableKind === "state_dependent"
      ? {
          ...(sourceVariableIds.includes("promotion.discount_active")
            ? { promotionActive: true }
            : {}),
          ...(sourceVariableIds.includes("inventory.available")
            ? { inventoryAvailabilityAtLeast: 0.2 }
            : {}),
        }
      : undefined;

  return {
    mechanismId: mechanism.id,
    declaredKind: mechanism.kind,
    kind: executableKind,
    participantChannels,
    driverChannels,
    conditionedOnChannels,
    targetChannels,
    sourceVariableIds,
    targetVariableIds,
    targetSemantic: inferTargetSemantic(
      mechanism,
      sourceVariableIds,
      targetVariableIds,
    ),
    ...(mechanism.mediatorVariable === undefined
      ? {}
      : { mediatorVariable: mechanism.mediatorVariable }),
    effectScale: mechanism.effect.scale,
    effectValue: mechanism.effect.value,
    effectUnit: mechanism.effect.unit,
    functionalForm: mechanism.functionalForm,
    lagMs: Number(mechanism.delaySeconds ?? 0) * 1_000,
    halfLifeMs: halfLifeMs(mechanism),
    ...(mechanism.selector === undefined
      ? {}
      : { selector: mechanism.selector }),
    ...(condition === undefined ? {} : { condition }),
    higherOrder: participantChannels.length > 2,
    asymmetric:
      mechanism.kind !== "synergy" &&
      participantChannels.length > 1,
    provenance: {
      groundTruthWorldId: world.manifest.worldId,
      mechanismCollection: "channelInteractions",
      mechanismId: mechanism.id,
      causalEdgeCount: edges.length,
    },
  };
}

export function compileCrossChannelNetwork(
  world: GeneratedMerchantWorld,
): CrossChannelInteractionNetwork {
  const ids = new Set<string>();
  const rules = world.manifest.channelInteractions.map(
    (mechanism) => {
      if (ids.has(mechanism.id)) {
        throw new CrossChannelNetworkError(
          `duplicate interaction mechanism id ${mechanism.id}`,
        );
      }
      ids.add(mechanism.id);

      if (
        !Number.isFinite(mechanism.effect.value)
      ) {
        throw new CrossChannelNetworkError(
          `interaction ${mechanism.id} has non-finite effect`,
        );
      }

      return compileRule(world, mechanism);
    },
  );

  const n = world.summary.activeChannels.length;
  const maximumPossiblePairCount =
    n <= 1 ? 0 : (n * (n - 1)) / 2;
  const realizedNonZeroRuleCount = rules.filter(
    (rule) => rule.kind !== "zero" && rule.effectValue !== 0,
  ).length;

  return {
    version: CROSS_CHANNEL_VERSION,
    merchantWorldId: world.manifest.worldId,
    activeChannels: world.summary.activeChannels,
    rules,
    mechanismIds: rules.map((rule) => rule.mechanismId),
    zeroInteractionMechanismIds: rules
      .filter(
        (rule) =>
          rule.kind === "zero" ||
          rule.effectValue === 0,
      )
      .map((rule) => rule.mechanismId),
    maximumPossiblePairCount,
    realizedNonZeroRuleCount,
    sparsity:
      maximumPossiblePairCount > 0
        ? clamp(
            1 -
              Math.min(
                maximumPossiblePairCount,
                realizedNonZeroRuleCount,
              ) /
                maximumPossiblePairCount,
            0,
            1,
          )
        : 1,
  };
}

function traitFor(
  customer: LatentCustomer,
  channel: MarketingChannel,
) {
  return customer.channelTraits.find(
    (trait) => trait.channelId === channel,
  );
}

function selectorMultiplier(
  rule: CompiledInteractionRule,
  customer: LatentCustomer,
): number {
  const selector = rule.selector;
  if (!selector) return 1;

  let multiplier = 1;

  if (
    selector.categoryIds !== undefined &&
    selector.categoryIds.length > 0
  ) {
    const affinity = Math.max(
      0,
      ...customer.categoryPreferences
        .filter((preference) =>
          selector.categoryIds!.includes(
            preference.categoryId,
          ),
        )
        .map((preference) => preference.affinity),
    );
    multiplier *= affinity > 0 ? 0.55 + affinity * 0.75 : 0.35;
  }

  if (
    selector.productIds !== undefined &&
    selector.productIds.length > 0
  ) {
    const affinity = Math.max(
      0,
      ...customer.productPreferences
        .filter((preference) =>
          selector.productIds!.includes(
            preference.productId,
          ),
        )
        .map((preference) => preference.affinity),
    );
    multiplier *= affinity > 0 ? 0.5 + affinity * 0.8 : 0.3;
  }

  if (
    selector.customerTypes !== undefined &&
    selector.customerTypes.length > 0
  ) {
    const type =
      customer.lifecycle.preSimulationHistory === "none"
        ? "new"
        : "existing";
    multiplier *= selector.customerTypes.includes(type)
      ? 1.15
      : 0.5;
  }

  if (
    selector.segmentIds !== undefined &&
    selector.segmentIds.length > 0
  ) {
    const matched = selector.segmentIds.some((segment) => {
      if (segment === "high_intent") {
        return customer.purchaseIntent >= 0.65;
      }
      if (segment === "returning") {
        return (
          customer.lifecycle.preSimulationHistory !== "none" ||
          customer.repeatPropensity >= 0.55
        );
      }
      return customer.derivedSegments.includes(segment as never);
    });
    multiplier *= matched ? 1.18 : 0.62;
  }

  return clamp(multiplier, 0.15, 2);
}

export function customerInteractionMultiplier(
  rule: CompiledInteractionRule,
  customer: LatentCustomer,
): number {
  const susceptibilities = rule.participantChannels
    .map(
      (channel) =>
        traitFor(customer, channel)
          ?.causalEffectMultiplier,
    )
    .filter(
      (value): value is number =>
        value !== undefined,
    );

  const susceptibility =
    susceptibilities.length === 0
      ? 1
      : susceptibilities.reduce(
          (sum, value) => sum + value,
          0,
        ) / susceptibilities.length;

  const categoryAffinity = Math.max(
    0,
    ...customer.categoryPreferences.map(
      (preference) => preference.affinity,
    ),
  );

  const lifecycleMultiplier =
    customer.lifecycle.state === "prospect"
      ? 1
      : customer.lifecycle.state ===
            "abstract_subscriber"
        ? 1.12
        : 1.05;

  return (
    clamp(
      0.72 +
        susceptibility * 0.22 +
        categoryAffinity * 0.08 +
        customer.purchaseIntent * 0.08,
      -1.5,
      2.5,
    ) *
    lifecycleMultiplier *
    selectorMultiplier(rule, customer)
  );
}

export function audienceOverlapMatrix(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
): AudienceOverlapMatrix {
  const channels = world.summary.activeChannels;
  const cells = [];

  for (let leftIndex = 0; leftIndex < channels.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < channels.length;
      rightIndex += 1
    ) {
      const left = channels[leftIndex]!;
      const right = channels[rightIndex]!;
      let numerator = 0;
      let denominator = 0;
      let joint = 0;

      for (const customer of population.customers) {
        const leftTrait = traitFor(customer, left);
        const rightTrait = traitFor(customer, right);
        if (!leftTrait || !rightTrait) continue;

        const weight = customer.populationWeight;
        const l = leftTrait.naturalUseProbability;
        const r = rightTrait.naturalUseProbability;

        numerator += Math.min(l, r) * weight;
        denominator += Math.max(l, r) * weight;
        joint += l * r * weight;
      }

      cells.push({
        left,
        right,
        weightedOverlap:
          denominator > 0
            ? numerator / denominator
            : 0,
        jointReachPotential:
          population.representedCustomerCount > 0
            ? joint /
              population.representedCustomerCount
            : 0,
      });
    }
  }

  return {
    merchantWorldId: world.manifest.worldId,
    cells,
  };
}
