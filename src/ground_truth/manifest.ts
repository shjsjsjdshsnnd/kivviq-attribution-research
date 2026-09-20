import type { CausalEffectValue, MoneyMinor } from "../core/units.js";
import { validateCausalGraph, type CausalGraph, type CausalNode } from "./causal-graph.js";
import { validateIntervention, type InterventionDefinition } from "./interventions.js";
import type {
  BaselineDemandMechanism,
  CACMechanism,
  ChannelIncrementalityMechanism,
  ChannelInteractionMechanism,
  CLVMechanism,
  ContributionProfitInputs,
  ConversionMechanism,
  CustomerGenerationParameters,
  DeviceEffectMechanism,
  ExternalShock,
  FunnelTransitionMechanism,
  InventoryMechanism,
  MarginEconomics,
  MerchantLatentParameters,
  OrganicDemandMechanism,
  PriceElasticityMechanism,
  ProductDemandMechanism,
  PromotionElasticityMechanism,
  RepeatPurchaseMechanism,
  ResponseCurve,
  SaturationMechanism,
  SeasonalityMechanism,
  WorldId,
} from "./ontology.js";
import {
  formatRuntimeSchemaIssues,
  groundTruthManifestRuntimeSchema,
} from "./runtime-schema.js";

export const CURRENT_GROUND_TRUTH_SCHEMA_VERSION = "1.0.0" as const;
export type GroundTruthSchemaVersion =
  typeof CURRENT_GROUND_TRUTH_SCHEMA_VERSION;

export interface GroundTruthManifest {
  readonly schemaVersion: GroundTruthSchemaVersion;
  readonly simulatorVersion: string;
  readonly worldId: WorldId;
  readonly seed: number;

  readonly merchant: MerchantLatentParameters;
  readonly customers: CustomerGenerationParameters;

  readonly baselineDemand: readonly BaselineDemandMechanism[];
  readonly channelIncrementality: readonly ChannelIncrementalityMechanism[];
  readonly responseCurves: readonly ResponseCurve[];
  readonly cacMechanisms: readonly CACMechanism[];
  readonly conversionMechanisms: readonly ConversionMechanism[];
  readonly priceElasticities: readonly PriceElasticityMechanism[];
  readonly promotionElasticities: readonly PromotionElasticityMechanism[];
  readonly clvMechanisms: readonly CLVMechanism[];
  readonly repeatPurchaseMechanisms: readonly RepeatPurchaseMechanism[];
  readonly productDemandMechanisms: readonly ProductDemandMechanism[];
  readonly inventoryMechanisms: readonly InventoryMechanism[];
  readonly seasonality: readonly SeasonalityMechanism[];
  readonly deviceEffects: readonly DeviceEffectMechanism[];
  readonly funnelMechanisms: readonly FunnelTransitionMechanism[];
  readonly channelInteractions: readonly ChannelInteractionMechanism[];
  readonly saturationMechanisms: readonly SaturationMechanism[];
  readonly organicDemand: OrganicDemandMechanism;
  readonly marginEconomics: MarginEconomics;
  readonly externalShocks: readonly ExternalShock[];
  readonly causalGraph: CausalGraph;
  readonly interventionDefinitions: readonly InterventionDefinition[];
}

export class GroundTruthValidationError extends Error {}

function assertRuntimeShape(value: unknown): void {
  const parsed = groundTruthManifestRuntimeSchema.safeParse(value);
  if (!parsed.success) {
    throw new GroundTruthValidationError(
      `invalid GroundTruth runtime schema: ${formatRuntimeSchemaIssues(
        parsed.error,
      )}`,
    );
  }
}

function effectCompatibleWithNode(
  effect: CausalEffectValue,
  node: CausalNode,
): boolean {
  if (
    effect.scale === "relative" ||
    effect.scale === "multiplicative" ||
    effect.scale === "log"
  ) {
    return effect.unit === "dimensionless" && node.valueType === "number";
  }

  if (effect.scale === "probability_point") {
    return node.valueType === "number" && node.unit === "probability";
  }

  if (effect.scale === "money_minor") {
    return node.valueType === "number" && node.unit === "money_minor";
  }

  if (effect.scale === "units") {
    return node.valueType === "number" && node.unit === "units";
  }

  return effect.unit === node.unit;
}

function assertUniqueMechanismIds(manifest: GroundTruthManifest): Set<string> {
  const entries: Array<readonly [string, string]> = [];

  const push = (collection: string, values: readonly { readonly id: string }[]) => {
    for (const value of values) entries.push([value.id, collection]);
  };

  push("baselineDemand", manifest.baselineDemand);
  push("channelIncrementality", manifest.channelIncrementality);
  push("responseCurves", manifest.responseCurves);
  push("cacMechanisms", manifest.cacMechanisms);
  push("conversionMechanisms", manifest.conversionMechanisms);
  push("priceElasticities", manifest.priceElasticities);
  push("promotionElasticities", manifest.promotionElasticities);
  push("clvMechanisms", manifest.clvMechanisms);
  push("repeatPurchaseMechanisms", manifest.repeatPurchaseMechanisms);
  push("productDemandMechanisms", manifest.productDemandMechanisms);
  push("inventoryMechanisms", manifest.inventoryMechanisms);
  push("seasonality", manifest.seasonality);
  push("deviceEffects", manifest.deviceEffects);
  push("funnelMechanisms", manifest.funnelMechanisms);
  push("channelInteractions", manifest.channelInteractions);
  push("saturationMechanisms", manifest.saturationMechanisms);
  push("externalShocks", manifest.externalShocks);
  entries.push([manifest.organicDemand.id, "organicDemand"]);

  const ownerById = new Map<string, string>();
  for (const [id, collection] of entries) {
    const existing = ownerById.get(id);
    if (existing) {
      throw new GroundTruthValidationError(
        `duplicate mechanism id "${id}" appears in ${existing} and ${collection}`,
      );
    }
    ownerById.set(id, collection);
  }

  return new Set([
    ...ownerById.keys(),
    manifest.marginEconomics.accountingIdentity,
  ]);
}

function validateGroundTruthSemantics(
  manifest: GroundTruthManifest,
): void {
  validateCausalGraph(manifest.causalGraph);

  if (manifest.merchant.currency !== manifest.marginEconomics.currency) {
    throw new GroundTruthValidationError(
      "merchant currency must match margin-economics currency",
    );
  }

  const knownMechanismIds = assertUniqueMechanismIds(manifest);
  const nodeById = new Map(
    manifest.causalGraph.nodes.map((node) => [node.id, node] as const),
  );
  const curveById = new Map(
    manifest.responseCurves.map((curve) => [curve.id, curve] as const),
  );
  const saturationById = new Map(
    manifest.saturationMechanisms.map(
      (mechanism) => [mechanism.id, mechanism] as const,
    ),
  );
  const baselineIds = new Set(
    manifest.baselineDemand.map((mechanism) => mechanism.id),
  );

  for (const edge of manifest.causalGraph.edges) {
    if (!knownMechanismIds.has(edge.mechanismId)) {
      throw new GroundTruthValidationError(
        `causal edge references unknown mechanism: ${edge.mechanismId}`,
      );
    }
  }

  for (const channel of manifest.channelIncrementality) {
    const outcomeNode = nodeById.get(channel.outcomeVariable);
    if (!outcomeNode) {
      throw new GroundTruthValidationError(
        `channel incrementality references unknown outcome variable: ${channel.outcomeVariable}`,
      );
    }

    if (!effectCompatibleWithNode(channel.effect, outcomeNode)) {
      throw new GroundTruthValidationError(
        `channel incrementality effect units are incompatible with ${channel.outcomeVariable}`,
      );
    }

    if (channel.responseCurveId) {
      const curve = curveById.get(channel.responseCurveId);
      if (!curve) {
        throw new GroundTruthValidationError(
          `channel incrementality references unknown response curve: ${channel.responseCurveId}`,
        );
      }
      if (curve.outputUnit !== outcomeNode.unit) {
        throw new GroundTruthValidationError(
          `response curve ${curve.id} output unit ${curve.outputUnit} does not match outcome variable unit ${outcomeNode.unit}`,
        );
      }
    }

    if (channel.saturationMechanismId) {
      const saturation = saturationById.get(channel.saturationMechanismId);
      if (!saturation) {
        throw new GroundTruthValidationError(
          `channel incrementality references unknown saturation mechanism: ${channel.saturationMechanismId}`,
        );
      }
      if (saturation.channelId !== channel.channelId) {
        throw new GroundTruthValidationError(
          `saturation mechanism ${saturation.id} belongs to a different channel`,
        );
      }
    }
  }

  for (const saturation of manifest.saturationMechanisms) {
    if (!curveById.has(saturation.responseCurveId)) {
      throw new GroundTruthValidationError(
        `saturation references unknown response curve: ${saturation.responseCurveId}`,
      );
    }
  }

  for (const cac of manifest.cacMechanisms) {
    if (!curveById.has(cac.marginalCACCurveId)) {
      throw new GroundTruthValidationError(
        `CAC mechanism references unknown marginal curve: ${cac.marginalCACCurveId}`,
      );
    }
  }

  for (const baselineId of manifest.organicDemand.baselineDemandMechanismIds) {
    if (!baselineIds.has(baselineId)) {
      throw new GroundTruthValidationError(
        `organic demand references unknown baseline-demand mechanism: ${baselineId}`,
      );
    }
  }

  for (const interaction of manifest.channelInteractions) {
    if (
      interaction.mediatorVariable &&
      !nodeById.has(interaction.mediatorVariable)
    ) {
      throw new GroundTruthValidationError(
        `channel interaction references unknown mediator variable: ${interaction.mediatorVariable}`,
      );
    }
  }

  for (const shock of manifest.externalShocks) {
    for (const variable of shock.affectedVariables) {
      const node = nodeById.get(variable);
      if (!node) {
        throw new GroundTruthValidationError(
          `external shock references unknown causal variable: ${variable}`,
        );
      }
      if (!effectCompatibleWithNode(shock.mechanism.effect, node)) {
        throw new GroundTruthValidationError(
          `external shock effect units are incompatible with ${variable}`,
        );
      }
    }
  }

  const interventionTargets = new Set(
    manifest.interventionDefinitions.map((item) => item.variable),
  );

  if (
    interventionTargets.size !==
    manifest.interventionDefinitions.length
  ) {
    throw new GroundTruthValidationError(
      "duplicate intervention definition",
    );
  }

  for (const definition of manifest.interventionDefinitions) {
    const node = nodeById.get(definition.variable);
    if (!node) {
      throw new GroundTruthValidationError(
        `unknown intervention variable: ${definition.variable}`,
      );
    }

    const value =
      node.valueType === "number"
        ? { kind: "number" as const, value: 0, unit: node.unit }
        : node.valueType === "boolean"
          ? { kind: "boolean" as const, value: false }
          : { kind: "category" as const, value: "__validation__" };

    validateIntervention(manifest.causalGraph, {
      variable: definition.variable,
      operation: "set",
      value,
    });
  }
}

export function validateGroundTruthManifest(
  manifest: GroundTruthManifest,
): void {
  assertRuntimeShape(manifest);
  validateGroundTruthSemantics(manifest);
}

export function parseGroundTruthManifest(
  raw: unknown,
): GroundTruthManifest {
  const parsed = groundTruthManifestRuntimeSchema.safeParse(raw);

  if (!parsed.success) {
    throw new GroundTruthValidationError(
      `invalid GroundTruth runtime schema: ${formatRuntimeSchemaIssues(
        parsed.error,
      )}`,
    );
  }

  const manifest = parsed.data as unknown as GroundTruthManifest;
  validateGroundTruthSemantics(manifest);
  return manifest;
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableSort(entry)]),
  );
}

export function serializeGroundTruthManifest(
  manifest: GroundTruthManifest,
): string {
  validateGroundTruthManifest(manifest);
  return JSON.stringify(stableSort(manifest));
}

export function deserializeGroundTruthManifest(
  serialized: string,
): GroundTruthManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized) as unknown;
  } catch {
    throw new GroundTruthValidationError(
      "GroundTruth manifest must be valid JSON",
    );
  }
  return parseGroundTruthManifest(raw);
}

export function reproducibilityKey(
  manifest: GroundTruthManifest,
): string {
  return [
    manifest.schemaVersion,
    manifest.simulatorVersion,
    manifest.worldId,
    String(manifest.seed),
    serializeGroundTruthManifest(manifest),
  ].join("|");
}

export function contributionProfitMinor(
  input: ContributionProfitInputs,
): MoneyMinor {
  const values = Object.entries(input);
  for (const [key, value] of values) {
    if (!Number.isSafeInteger(value)) {
      throw new GroundTruthValidationError(
        `${key} must be a finite integer in minor currency units`,
      );
    }
    if (value < 0) {
      throw new GroundTruthValidationError(
        `${key} must be non-negative`,
      );
    }
  }

  const result =
    Number(input.grossRevenueMinor) -
    Number(input.discountsMinor) -
    Number(input.returnsMinor) -
    Number(input.cogsMinor) -
    Number(input.paymentFeesMinor) -
    Number(input.shippingSubsidyMinor) -
    Number(input.fulfillmentCostsMinor) -
    Number(input.variableOperatingCostsMinor) -
    Number(input.marketingSpendMinor);

  if (!Number.isSafeInteger(result)) {
    throw new GroundTruthValidationError(
      "contribution profit must reconcile to integer minor currency units",
    );
  }

  return result as MoneyMinor;
}
