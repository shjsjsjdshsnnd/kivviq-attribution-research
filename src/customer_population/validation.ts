import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import {
  formatCustomerSchemaIssues,
  latentCustomerPopulationRuntimeSchema,
} from "./runtime-schema.js";
import type { LatentCustomerPopulation } from "./types.js";

export class LatentCustomerValidationError extends Error {}

const FORBIDDEN_REALIZED_KEYS = new Set([
  "name",
  "email",
  "phone",
  "address",
  "sessions",
  "impressions",
  "clicks",
  "adExposures",
  "searches",
  "pageViews",
  "carts",
  "checkouts",
  "orders",
  "events",
  "attributionRecords",
  "realizedJourney",
  "realizedMarketingJourney",
  "purchaseHistory",
]);

function assertNoRealizedBehaviorOrPii(
  value: unknown,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoRealizedBehaviorOrPii(entry, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_REALIZED_KEYS.has(key)) {
      throw new LatentCustomerValidationError(
        `forbidden realized/PII field at ${path}.${key}`,
      );
    }
    assertNoRealizedBehaviorOrPii(entry, `${path}.${key}`);
  }
}

export function validateLatentCustomerPopulation(
  population: LatentCustomerPopulation,
  merchantWorld: GeneratedMerchantWorld,
): void {
  validateGroundTruthManifest(merchantWorld.manifest);

  const parsed =
    latentCustomerPopulationRuntimeSchema.safeParse(population);
  if (!parsed.success) {
    throw new LatentCustomerValidationError(
      `invalid latent-customer population schema: ${formatCustomerSchemaIssues(
        parsed.error,
      )}`,
    );
  }

  assertNoRealizedBehaviorOrPii(population);

  if (population.merchantWorldId !== merchantWorld.manifest.worldId) {
    throw new LatentCustomerValidationError(
      "population merchantWorldId does not match merchant world",
    );
  }
  if (
    population.provenance.merchantWorldId !==
      merchantWorld.manifest.worldId ||
    population.provenance.merchantWorldSeed !==
      merchantWorld.manifest.seed ||
    population.provenance.merchantGeneratorVersion !==
      merchantWorld.provenance.generatorVersion
  ) {
    throw new LatentCustomerValidationError(
      "population provenance does not match frozen merchant world",
    );
  }

  if (population.explicitAgentCount !== population.customers.length) {
    throw new LatentCustomerValidationError(
      "explicitAgentCount must equal customers.length",
    );
  }

  const ids = new Set(population.customers.map((customer) => customer.customerId));
  if (ids.size !== population.customers.length) {
    throw new LatentCustomerValidationError(
      "latent customer IDs must be unique",
    );
  }

  const representedMass = population.customers.reduce(
    (sum, customer) => sum + customer.populationWeight,
    0,
  );
  const massTolerance = Math.max(
    1e-8,
    population.representedCustomerCount * 1e-10,
  );
  if (
    Math.abs(representedMass - population.representedCustomerCount) >
    massTolerance
  ) {
    throw new LatentCustomerValidationError(
      `population weights represent ${representedMass}, expected ${population.representedCustomerCount}`,
    );
  }

  const shouldBeWeighted =
    population.representedCustomerCount !== population.explicitAgentCount;
  if (population.weightedAgents !== shouldBeWeighted) {
    throw new LatentCustomerValidationError(
      "weightedAgents flag is inconsistent with represented and explicit population sizes",
    );
  }

  const productToCategory = new Map(
    merchantWorld.manifest.productDemandMechanisms.map(
      (mechanism) =>
        [mechanism.productId, mechanism.categoryId] as const,
    ),
  );
  const validCategories = new Set(productToCategory.values());
  const activeChannels = new Set(merchantWorld.summary.activeChannels);
  const mechanismByChannel = new Map(
    merchantWorld.manifest.channelIncrementality.map(
      (mechanism) => [mechanism.channelId, mechanism.id] as const,
    ),
  );

  let existingMass = 0;

  for (const customer of population.customers) {
    const categoryIds = new Set<string>();
    for (const preference of customer.categoryPreferences) {
      if (!validCategories.has(preference.categoryId)) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} references unknown category ${preference.categoryId}`,
        );
      }
      if (categoryIds.has(preference.categoryId)) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} has duplicate category preference ${preference.categoryId}`,
        );
      }
      categoryIds.add(preference.categoryId);
    }

    const productIds = new Set<string>();
    for (const preference of customer.productPreferences) {
      const category = productToCategory.get(preference.productId);
      if (!category) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} references unknown product ${preference.productId}`,
        );
      }
      if (category !== preference.categoryId) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} product/category preference mismatch`,
        );
      }
      if (productIds.has(preference.productId)) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} has duplicate product preference ${preference.productId}`,
        );
      }
      productIds.add(preference.productId);
    }

    const traitChannels = new Set<string>();
    for (const trait of customer.channelTraits) {
      if (!activeChannels.has(trait.channelId)) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} references inactive channel ${trait.channelId}`,
        );
      }
      if (traitChannels.has(trait.channelId)) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} has duplicate channel trait ${trait.channelId}`,
        );
      }
      traitChannels.add(trait.channelId);
      if (
        mechanismByChannel.get(trait.channelId) !==
        trait.merchantMechanismId
      ) {
        throw new LatentCustomerValidationError(
          `customer ${customer.customerId} channel trait does not reference the merchant mechanism`,
        );
      }
    }
    if (traitChannels.size !== activeChannels.size) {
      throw new LatentCustomerValidationError(
        `customer ${customer.customerId} does not cover every active merchant channel`,
      );
    }

    const deviceTotal =
      customer.devicePreference.mobileProbability +
      customer.devicePreference.desktopProbability +
      customer.devicePreference.tabletProbability;
    if (Math.abs(deviceTotal - 1) > 1e-9) {
      throw new LatentCustomerValidationError(
        `customer ${customer.customerId} device probabilities do not sum to 1`,
      );
    }

    if (customer.lifecycle.state === "prospect") {
      if (customer.lifecycle.preSimulationHistory !== "none") {
        throw new LatentCustomerValidationError(
          "prospect lifecycle cannot imply pre-simulation purchase history",
        );
      }
    } else {
      if (customer.lifecycle.preSimulationHistory === "none") {
        throw new LatentCustomerValidationError(
          "existing-oriented lifecycle must use abstract pre-simulation history",
        );
      }
      existingMass += customer.populationWeight;
    }
  }

  const impliedExistingShare =
    existingMass / population.representedCustomerCount;
  const targetExistingShare = Number(
    merchantWorld.manifest.customers.existingCustomerShare,
  );
  const lifecycleTolerance =
    1 / population.explicitAgentCount + 1e-9;
  if (
    Math.abs(impliedExistingShare - targetExistingShare) >
    lifecycleTolerance
  ) {
    throw new LatentCustomerValidationError(
      `lifecycle mix does not reconcile: target existing share ${targetExistingShare}, implied ${impliedExistingShare}`,
    );
  }

  if (
    !population.calibration.converged ||
    population.calibration.metrics.some((metric) => !metric.converged)
  ) {
    throw new LatentCustomerValidationError(
      "population calibration report is not fully converged",
    );
  }
}
