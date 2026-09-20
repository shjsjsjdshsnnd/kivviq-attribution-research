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

function populationFor(
  world: GeneratedMerchantWorld,
  populationSeed: number,
): LatentCustomerPopulation {
  return generateCustomerPopulation({
    merchantWorld: world,
    populationSeed,
    populationConfig: {
      maxExplicitAgents: 150,
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
): CrossChannelFixture {
  return {
    id,
    merchantWorld: world,
    latentPopulation: populationFor(
      world,
      populationSeed,
    ),
    simulationSeed,
  };
}

export function createZeroInteractionControlFixture(): CrossChannelFixture {
  const base = worldWithRequiredChannels(
    91001,
    ["meta", "google_search", "pinterest"],
  );
  const world = replaceInteractionNetwork(base, [
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
  const world = replaceInteractionNetwork(base, [
    {
      id: "step6_meta_google_synergy",
      channelIds: ["meta", "google_search"],
      kind: "synergy",
      functionalForm: "multiplicative",
      effect: 0.85,
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
      effect: 0.35,
      sources: [
        "marketing.meta.exposure",
        "marketing.email.exposure",
        "marketing.google_search.exposure",
      ],
      targets: ["funnel.purchase_probability"],
    },
  ]);
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
  const world = replaceInteractionNetwork(base, [
    {
      id: "step6_search_direct_substitution",
      channelIds: ["google_search"],
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
  const world = replaceInteractionNetwork(base, [
    {
      id: "step6_meta_branded_search",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 0.9,
      sources: ["marketing.meta.exposure"],
      targets: [
        "marketing.google_search.branded_probability",
      ],
      delaySeconds: 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_pinterest_organic_direct",
      channelIds: ["pinterest"],
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
  const world = replaceInteractionNetwork(base, [
    {
      id: "step6_meta_google_conditional_synergy",
      channelIds: ["meta", "google_search"],
      kind: "synergy",
      functionalForm: "multiplicative",
      effect: 1.15,
      sources: [
        "marketing.meta.exposure",
        "marketing.google_search.exposure",
      ],
      targets: ["funnel.purchase_probability"],
    },
  ]);
  return fixture(
    "interaction_reversal",
    world,
    92080,
    93080,
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
  const world = replaceInteractionNetwork(base, [
    {
      id: "step6_trap_meta_google_mediation",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 1.05,
      sources: ["marketing.meta.exposure"],
      targets: [
        "marketing.google_search.branded_probability",
      ],
      delaySeconds: 2 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_trap_meta_retargeting_pool",
      channelIds: ["meta"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 0.8,
      sources: ["marketing.meta.exposure"],
      targets: ["marketing.retargeting_eligibility"],
      delaySeconds: 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_trap_google_direct_capture",
      channelIds: ["google_search"],
      kind: "cannibalization",
      functionalForm: "nonlinear",
      effect: -0.55,
      sources: ["marketing.google_search.exposure"],
      targets: [
        "demand.direct_probability",
        "demand.organic_probability",
      ],
    },
    {
      id: "step6_trap_email_promotion",
      channelIds: ["email"],
      kind: "synergy",
      functionalForm: "multiplicative",
      effect: 0.45,
      sources: [
        "marketing.email.exposure",
        "promotion.discount_active",
      ],
      targets: ["funnel.purchase_probability"],
    },
  ]);
  return fixture(
    "portfolio_reallocation_trap",
    world,
    92100,
    93100,
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
  const world = replaceInteractionNetwork(base, [
    {
      id: "step6_prospecting_branded_search",
      channelIds: ["meta", "google_search"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 1.15,
      sources: ["marketing.meta.exposure"],
      targets: [
        "marketing.google_search.branded_probability",
      ],
      delaySeconds: 7 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_prospecting_retargeting",
      channelIds: ["meta"],
      kind: "mediation",
      functionalForm: "multiplicative",
      effect: 1,
      sources: ["marketing.meta.exposure"],
      targets: ["marketing.retargeting_eligibility"],
      delaySeconds: 5 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
    {
      id: "step6_prospecting_email_audience",
      channelIds: ["meta", "email"],
      kind: "delayed",
      functionalForm: "multiplicative",
      effect: 0.72,
      sources: ["marketing.meta.exposure"],
      targets: ["marketing.email.eligibility"],
      delaySeconds: 14 * 86_400,
      mediatorVariable: "customer.brand_awareness",
    },
  ]);
  return fixture(
    "prospecting_cut_trap",
    world,
    92120,
    93120,
  );
}
