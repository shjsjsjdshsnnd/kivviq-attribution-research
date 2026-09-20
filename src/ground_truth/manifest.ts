import type { MoneyMinor } from "../core/units.js";
import { validateCausalGraph, type CausalGraph } from "./causal-graph.js";
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

const REQUIRED_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "simulatorVersion",
  "worldId",
  "seed",
  "merchant",
  "customers",
  "baselineDemand",
  "channelIncrementality",
  "responseCurves",
  "cacMechanisms",
  "conversionMechanisms",
  "priceElasticities",
  "promotionElasticities",
  "clvMechanisms",
  "repeatPurchaseMechanisms",
  "productDemandMechanisms",
  "inventoryMechanisms",
  "seasonality",
  "deviceEffects",
  "funnelMechanisms",
  "channelInteractions",
  "saturationMechanisms",
  "organicDemand",
  "marginEconomics",
  "externalShocks",
  "causalGraph",
  "interventionDefinitions",
] as const;

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GroundTruthValidationError(`${label} must be an object`);
  }
}

function assertNoNonFiniteNumbers(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GroundTruthValidationError(
        `${path} contains NaN or Infinity`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoNonFiniteNumbers(entry, `${path}[${index}]`),
    );
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      assertNoNonFiniteNumbers(entry, `${path}.${key}`);
    }
  }
}

function assertProbabilityFields(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertProbabilityFields(entry, `${path}[${index}]`),
    );
    return;
  }

  if (typeof value !== "object" || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    const isProbabilityField =
      /probability$/i.test(key) ||
      /probabilities$/i.test(key) ||
      key === "baselineBrandAwareness" ||
      key === "baselineBrandPreference" ||
      key === "existingCustomerShare" ||
      key === "annualDiscountRate";

    if (
      isProbabilityField &&
      typeof entry === "number" &&
      (entry < 0 || entry > 1)
    ) {
      throw new GroundTruthValidationError(
        `${path}.${key} must be within [0,1]`,
      );
    }

    assertProbabilityFields(entry, `${path}.${key}`);
  }
}

function assertRequiredArrays(raw: Record<string, unknown>): void {
  const arrayFields = [
    "baselineDemand",
    "channelIncrementality",
    "responseCurves",
    "cacMechanisms",
    "conversionMechanisms",
    "priceElasticities",
    "promotionElasticities",
    "clvMechanisms",
    "repeatPurchaseMechanisms",
    "productDemandMechanisms",
    "inventoryMechanisms",
    "seasonality",
    "deviceEffects",
    "funnelMechanisms",
    "channelInteractions",
    "saturationMechanisms",
    "externalShocks",
    "interventionDefinitions",
  ] as const;

  for (const key of arrayFields) {
    if (!Array.isArray(raw[key])) {
      throw new GroundTruthValidationError(`${key} must be an array`);
    }
  }
}

function exampleValueForNode(graph: CausalGraph, variable: string) {
  const node = graph.nodes.find((candidate) => candidate.id === variable);

  if (!node) {
    throw new GroundTruthValidationError(
      `unknown intervention variable: ${variable}`,
    );
  }

  if (node.valueType === "number") {
    return {
      kind: "number" as const,
      value: 0,
      unit: node.unit,
    };
  }

  if (node.valueType === "boolean") {
    return { kind: "boolean" as const, value: false };
  }

  return { kind: "category" as const, value: "__validation__" };
}

export function validateGroundTruthManifest(
  manifest: GroundTruthManifest,
): void {
  assertNoNonFiniteNumbers(manifest);
  assertProbabilityFields(manifest);

  if (
    manifest.schemaVersion !== CURRENT_GROUND_TRUTH_SCHEMA_VERSION
  ) {
    throw new GroundTruthValidationError(
      `unsupported GroundTruth schema version: ${String(
        manifest.schemaVersion,
      )}`,
    );
  }

  if (!Number.isSafeInteger(manifest.seed) || manifest.seed < 0) {
    throw new GroundTruthValidationError(
      "seed must be a non-negative safe integer",
    );
  }

  if (
    manifest.baselineDemand.some(
      (item) => item.paidMarketingIncluded !== false,
    )
  ) {
    throw new GroundTruthValidationError(
      "baseline demand must exclude modeled paid-marketing effects",
    );
  }

  for (const inventory of manifest.inventoryMechanisms) {
    if (
      Number(inventory.initialAvailableUnits) < 0 ||
      Number(inventory.initialReservedUnits) < 0
    ) {
      throw new GroundTruthValidationError(
        "inventory cannot be negative",
      );
    }

    if (
      Number(inventory.initialReservedUnits) >
      Number(inventory.initialAvailableUnits)
    ) {
      throw new GroundTruthValidationError(
        "reserved inventory cannot exceed available inventory",
      );
    }
  }

  if (
    manifest.marginEconomics.accountingIdentity !==
    "contribution_profit_v1"
  ) {
    throw new GroundTruthValidationError(
      "unsupported contribution-profit accounting identity",
    );
  }

  validateCausalGraph(manifest.causalGraph);

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
    validateIntervention(manifest.causalGraph, {
      variable: definition.variable,
      operation: "set",
      value: exampleValueForNode(
        manifest.causalGraph,
        definition.variable,
      ),
    });
  }

  const curveIds = new Set(
    manifest.responseCurves.map((curve) => curve.id),
  );

  for (const channel of manifest.channelIncrementality) {
    if (
      channel.responseCurveId &&
      !curveIds.has(channel.responseCurveId)
    ) {
      throw new GroundTruthValidationError(
        `channel incrementality references unknown response curve: ${channel.responseCurveId}`,
      );
    }
  }

  for (const saturation of manifest.saturationMechanisms) {
    if (!curveIds.has(saturation.responseCurveId)) {
      throw new GroundTruthValidationError(
        `saturation references unknown response curve: ${saturation.responseCurveId}`,
      );
    }
  }
}

export function parseGroundTruthManifest(
  raw: unknown,
): GroundTruthManifest {
  assertPlainObject(raw, "GroundTruthManifest");

  for (const required of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(required in raw)) {
      throw new GroundTruthValidationError(
        `missing required field: ${required}`,
      );
    }
  }

  for (const key of Object.keys(raw)) {
    if (
      !(REQUIRED_TOP_LEVEL_KEYS as readonly string[]).includes(key)
    ) {
      throw new GroundTruthValidationError(
        `unknown top-level field: ${key}`,
      );
    }
  }

  assertRequiredArrays(raw);

  const manifest = raw as unknown as GroundTruthManifest;
  validateGroundTruthManifest(manifest);
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
  return parseGroundTruthManifest(
    JSON.parse(serialized) as unknown,
  );
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
