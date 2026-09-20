import { generateCustomerPopulation } from "../customer_population/generator.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import type { CrossChannelFixture } from "./types.js";

interface InteractionDefinition {
  readonly id: string;
  readonly channelIds: readonly MarketingChannel[];
  readonly kind:
    | "synergy"
    | "cannibalization"
    | "mediation"
    | "zero"
    | "delayed";
  readonly functionalForm:
    | "additive"
    | "multiplicative"
    | "nonlinear";
  readonly effect: number;
  readonly sources: readonly string[];
  readonly targets: readonly string[];
  readonly delaySeconds?: number;
  readonly mediatorVariable?: string;
}

function worldWithRequiredChannels(
  seedStart: number,
  required: readonly MarketingChannel[],
  options: {
    readonly archetype?:
      | "fashion_apparel"
      | "beauty_cosmetics"
      | "home_furnishings_decor"
      | "furniture";
    readonly marketingDependence?:
      | "paid_media_heavy"
      | "retention_heavy"
      | "balanced";
  } = {},
): GeneratedMerchantWorld {
  for (let offset = 0; offset < 80; offset += 1) {
    const world = generateMerchantWorldRecord({
      seed: seedStart + offset,
      archetype: options.archetype ?? "fashion_apparel",
      scale: "growth",
      complexity: "adversarial",
      marketingDependence:
        options.marketingDependence ?? "paid_media_heavy",
      overrides: {
        forceZeroIncrementalityChannels: required.filter(
          (channel) =>
            channel === "meta" ||
            channel === "google_search" ||
            channel === "google_shopping" ||
            channel === "pinterest" ||
            channel === "affiliate",
        ),
      },
    });

    if (
      required.every((channel) =>
        world.summary.activeChannels.includes(channel),
      )
    ) {
      return world;
    }
  }

  throw new RangeError(
    `unable to generate fixture with channels: ${required.join(", ")}`,
  );
}

function ensureCausalNode(
  clone: any,
  variable: string,
): void {
  if (
    clone.manifest.causalGraph.nodes.some(
      (node: any) => node.id === variable,
    )
  ) {
    return;
  }

  const isBoolean =
    variable === "promotion.discount_active";
  const domain =
    variable.startsWith("marketing.")
      ? "marketing"
      : variable.startsWith("demand.")
        ? "demand"
        : variable.startsWith("customer.")
          ? "customer"
          : variable.startsWith("funnel.")
            ? "funnel"
            : "marketing";

  clone.manifest.causalGraph.nodes.push({
    id: variable,
    domain,
    temporalScope: "time_indexed",
    valueType: isBoolean ? "boolean" : "number",
    unit: isBoolean ? "boolean" : "probability",
    intervenable: false,
    visibility: "latent",
  });
}

function replaceInteractionNetwork(
  world: GeneratedMerchantWorld,
  definitions: readonly InteractionDefinition[],
): GeneratedMerchantWorld {
  const clone = structuredClone(world) as any;
  const oldIds = new Set(
    clone.manifest.channelInteractions.map(
      (interaction: any) => interaction.id,
    ),
  );

  clone.manifest.causalGraph.edges =
    clone.manifest.causalGraph.edges.filter(
      (edge: any) => !oldIds.has(edge.mechanismId),
    );

  clone.manifest.channelInteractions = definitions.map(
    (definition) => ({
      id: definition.id,
      channelIds: [...definition.channelIds],
      kind: definition.kind,
      functionalForm: definition.functionalForm,
      effect: {
        scale: "relative",
        value: definition.effect,
        unit: "dimensionless",
      },
      ...(definition.delaySeconds === undefined
        ? {}
        : { delaySeconds: definition.delaySeconds }),
      ...(definition.mediatorVariable === undefined
        ? {}
        : {
            mediatorVariable:
              definition.mediatorVariable,
          }),
    }),
  );

  for (const definition of definitions) {
    for (const variable of [
      ...definition.sources,
      ...definition.targets,
      ...(definition.mediatorVariable === undefined
        ? []
        : [definition.mediatorVariable]),
    ]) {
      ensureCausalNode(clone, variable);
    }

    for (const source of definition.sources) {
      for (const target of definition.targets) {
        clone.manifest.causalGraph.edges.push({
          parent: source,
          child: target,
          relationship:
            definition.kind === "mediation" ||
            definition.kind === "delayed"
              ? "mediated"
              : "interaction",
          mechanismId: definition.id,
          ...(definition.delaySeconds === undefined
            ? {}
            : {
                lagSeconds:
                  definition.delaySeconds,
              }),
        });
      }
    }
  }

  validateGroundTruthManifest(clone.manifest);
  return clone as GeneratedMerchantWorld;
}

function setReferenceIntensity(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
  referenceMinor: number,
): GeneratedMerchantWorld {
  const clone = structuredClone(world) as any;
  const mechanism = clone.manifest.channelIncrementality.find(
    (candidate: any) => candidate.channelId === channel,
  );
  const curve = mechanism?.responseCurveId
    ? clone.manifest.responseCurves.find(
        (candidate: any) =>
          candidate.id === mechanism.responseCurveId,
      )
    : undefined;

  if (!curve) {
    throw new RangeError(
      `missing response curve for ${channel}`,
    );
  }

  const reference = Math.max(1, Math.round(referenceMinor));
  if (curve.kind === "linear") {
    curve.maxSpend = reference;
  } else if (curve.kind === "hill") {
    curve.halfSaturationSpend = reference;
  } else if (curve.kind === "threshold") {
    curve.thresholdSpend = reference;
  } else if (curve.kind === "piecewise") {
    const positive = curve.points.find(
      (point: any) => Number(point.spend) > 0,
    );
    if (positive) positive.spend = reference;
  }

  validateGroundTruthManifest(clone.manifest);
  return clone as GeneratedMerchantWorld;
}

function setDirectEffects(
  world: GeneratedMerchantWorld,
  effects: Readonly<
    Partial<Record<MarketingChannel, number>>
  >,
): GeneratedMerchantWorld {
  const clone = structuredClone(world) as any;
  for (const mechanism of clone.manifest.channelIncrementality) {
    const value = effects[mechanism.channelId as MarketingChannel];
    if (value !== undefined) {
      mechanism.effect.value = value;
    }
  }
  validateGroundTruthManifest(clone.manifest);
  return clone as GeneratedMerchantWorld;
}

function zeroDirectEffects(
  world: GeneratedMerchantWorld,
  channels: readonly MarketingChannel[],
): GeneratedMerchantWorld {
  const clone = structuredClone(world) as any;
  for (const mechanism of clone.manifest.channelIncrementality) {
    if (channels.includes(mechanism.channelId)) {
      mechanism.effect.value = 0;
    }
  }
  validateGroundTruthManifest(clone.manifest);
  return clone as GeneratedMerchantWorld;
}

function populationFor(
  world: GeneratedMerchantWorld,
  populationSeed: number,
  maxExplicitAgents = 150,
): LatentCustomerPopulation {
  return generateCustomerPopulation({
    merchantWorld: world,
    populationSeed,
    populationConfig: {
      maxExplicitAgents,
      complexity: "adversarial",
      maxCategoryPreferences: 4,
      maxProductPreferences: 6,
    },
  });
}

function fixture(
  id: CrossChannelFixture["id"],
  world: GeneratedMerchantWorld,
  populationSeed: number,
  simulationSeed: number,
  maxExplicitAgents = 150,
): CrossChannelFixture {
  return {
    id,
    merchantWorld: world,
    latentPopulation: populationFor(
      world,
      populationSeed,
      maxExplicitAgents,
    ),
    simulationSeed,
  };
}

export function createZeroInteractionControlFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91001,
    ["meta", "google_search", "pinterest"],
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_zero_meta_google",
      channelIds: ["meta", "google_search"],
      kind: "zero",
      functionalForm: "additive",
      effect: 0,
      sources: ["marketing.meta.exposure"],
      targets: ["funnel.purchase_probability"],
    },
    {
      id: "step6_zero_pinterest_google",
      channelIds: ["pinterest", "google_search"],
      kind: "zero",
      functionalForm: "additive",
      effect: 0,
      sources: ["marketing.pinterest.exposure"],
      targets: ["marketing.google_search.branded_probability"],
    },
  ]);
  const world = zeroDirectEffects(
    interacted,
    ["meta", "google_search", "pinterest"],
  );
  return fixture(
    "zero_interaction_control",
    world,
    92001,
    93001,
  );
}

export function createPositiveSynergyFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91020,
    ["meta", "google_search", "email"],
    { marketingDependence: "balanced" },
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_meta_google_synergy",
      channelIds: ["meta", "google_search"],
      kind: "synergy",
      functionalForm: "multiplicative",
      effect: 2.5,
      sources: [
        "marketing.meta.exposure",
        "marketing.google_search.exposure",
      ],
      targets: ["funnel.purchase_probability"],
    },
    {
      id: "step6_meta_email_google_higher_order",
      channelIds: [
        "meta",
        "email",
        "google_search",
      ],
      kind: "synergy",
      functionalForm: "nonlinear",
      effect: 0.9,
      sources: [
        "marketing.meta.exposure",
        "marketing.email.exposure",
        "marketing.google_search.exposure",
      ],
      targets: ["funnel.purchase_probability"],
    },
  ]);
  const world = setDirectEffects(
    interacted,
    {
      meta: base.summary.expectedAnnualOrders / 12 * 0.32,
      google_search: base.summary.expectedAnnualOrders / 12 * 0.42,
      email: base.summary.expectedAnnualOrders / 12 * 0.12,
    },
  );
  return fixture(
    "positive_synergy",
    world,
    92020,
    93020,
  );
}

export function createCannibalizationFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91040,
    ["google_search", "meta"],
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_search_direct_substitution",
      channelIds: ["google_search", "meta"],
      kind: "cannibalization",
      functionalForm: "nonlinear",
      effect: -0.78,
      sources: ["marketing.google_search.exposure"],
      targets: [
        "demand.direct_probability",
        "demand.organic_probability",
      ],
    },
  ]);
  const world = setDirectEffects(
    interacted,
    {
      google_search: base.summary.expectedAnnualOrders / 12 * 0.12,
      meta: base.summary.expectedAnnualOrders / 12 * 0.08,
    },
  );
  return fixture(
    "cannibalization",
    world,
    92040,
    93040,
  );
}

export function createMediationFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91060,
    ["meta", "google_search", "pinterest"],
    {
      archetype: "home_furnishings_decor",
      marketingDependence: "balanced",
    },
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_meta_branded_search",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 2.4,
      sources: ["marketing.meta.exposure"],
      targets: [
        "marketing.google_search.branded_probability",
      ],
      delaySeconds: 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_pinterest_organic_direct",
      channelIds: ["pinterest", "google_search"],
      kind: "delayed",
      functionalForm: "multiplicative",
      effect: 0.62,
      sources: ["marketing.pinterest.exposure"],
      targets: [
        "demand.organic_probability",
        "demand.direct_probability",
      ],
      delaySeconds: 3 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
  ]);
  const world = setDirectEffects(
    interacted,
    {
      meta: 0,
      google_search: base.summary.expectedAnnualOrders / 12 * 0.28,
      pinterest: base.summary.expectedAnnualOrders / 12 * 0.14,
    },
  );
  return fixture(
    "mediation",
    world,
    92060,
    93060,
  );
}

export function createInteractionReversalFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91080,
    ["meta", "google_search"],
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_meta_google_conditional_synergy",
      channelIds: ["meta", "google_search"],
      kind: "synergy",
      functionalForm: "multiplicative",
      effect: 4.5,
      sources: [
        "marketing.meta.exposure",
        "marketing.google_search.exposure",
      ],
      targets: ["funnel.purchase_probability"],
    },
  ]);
  const world = setDirectEffects(
    interacted,
    {
      meta: base.summary.expectedAnnualOrders / 12 * 0.25,
      google_search: base.summary.expectedAnnualOrders / 12 * 0.35,
    },
  );
  return fixture(
    "interaction_reversal",
    world,
    92080,
    93080,
    320,
  );
}

export function createPortfolioReallocationTrapFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91100,
    ["meta", "google_search", "email"],
    {
      archetype: "beauty_cosmetics",
      marketingDependence: "balanced",
    },
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_trap_meta_google_mediation",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 3.2,
      sources: ["marketing.meta.exposure"],
      targets: [
        "marketing.google_search.branded_probability",
      ],
      delaySeconds: 2 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_trap_meta_retargeting_pool",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 2.4,
      sources: ["marketing.meta.exposure"],
      targets: ["marketing.retargeting_eligibility"],
      delaySeconds: 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_trap_google_direct_capture",
      channelIds: ["google_search", "meta"],
      kind: "cannibalization",
      functionalForm: "nonlinear",
      effect: -1.35,
      sources: ["marketing.google_search.exposure"],
      targets: [
        "demand.direct_probability",
        "demand.organic_probability",
      ],
    },
    {
      id: "step6_trap_email_promotion",
      channelIds: ["email", "meta"],
      kind: "synergy",
      functionalForm: "multiplicative",
      effect: 0.8,
      sources: [
        "marketing.email.exposure",
        "promotion.discount_active",
      ],
      targets: ["funnel.purchase_probability"],
    },
  ]);
  const world = setDirectEffects(
    interacted,
    {
      meta: base.summary.expectedAnnualOrders / 12 * 0.12,
      google_search: base.summary.expectedAnnualOrders / 12 * 0.52,
      email: base.summary.expectedAnnualOrders / 12 * 0.16,
    },
  );
  return fixture(
    "portfolio_reallocation_trap",
    world,
    92100,
    93100,
    220,
  );
}

export function createProspectingCutTrapFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91120,
    ["meta", "google_search", "email"],
    {
      archetype: "beauty_cosmetics",
      marketingDependence: "retention_heavy",
    },
  );
  const interacted = replaceInteractionNetwork(base, [
    {
      id: "step6_prospecting_branded_search",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 4.5,
      sources: ["marketing.meta.exposure"],
      targets: [
        "marketing.google_search.branded_probability",
      ],
      delaySeconds: 10 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_prospecting_retargeting",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 4.0,
      sources: ["marketing.meta.exposure"],
      targets: ["marketing.retargeting_eligibility"],
      delaySeconds: 21 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_prospecting_email_audience",
      channelIds: ["meta", "email"],
      kind: "delayed",
      functionalForm: "multiplicative",
      effect: 3.5,
      sources: ["marketing.meta.exposure"],
      targets: ["marketing.email.eligibility"],
      delaySeconds: 14 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
  ]);
  const world = setDirectEffects(
    interacted,
    {
      meta: 0,
      google_search: base.summary.expectedAnnualOrders / 12 * 0.34,
      email: base.summary.expectedAnnualOrders / 12 * 0.18,
    },
  );
  const calibratedWorld = setReferenceIntensity(
    world,
    "meta",
    20_000,
  );
  return fixture(
    "prospecting_cut_trap",
    calibratedWorld,
    92120,
    93120,
    420,
  );
}
