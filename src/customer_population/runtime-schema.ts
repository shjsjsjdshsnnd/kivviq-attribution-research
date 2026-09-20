import { z } from "zod";

const finite = z.number().finite();
const probability = finite.min(0).max(1);
const positive = finite.gt(0);
const nonNegative = finite.min(0);
const factor = finite.min(-8).max(8);

const latentFactorsSchema = z
  .object({
    purchaseUrgency: factor,
    brandAttachment: factor,
    dealOrientation: factor,
    categoryInvolvement: factor,
    marketingReceptivity: factor,
    loyaltyTendency: factor,
    digitalBehavior: factor,
    explorationTendency: factor,
  })
  .strict();

const categoryPreferenceSchema = z
  .object({
    categoryId: z.string().min(1),
    affinity: probability,
  })
  .strict();

const productPreferenceSchema = z
  .object({
    productId: z.string().min(1),
    categoryId: z.string().min(1),
    affinity: probability,
  })
  .strict();

const channelTraitSchema = z
  .object({
    channelId: z.enum([
      "meta",
      "google_search",
      "google_shopping",
      "pinterest",
      "email",
      "sms",
      "affiliate",
    ]),
    merchantMechanismId: z.string().min(1),
    causalEffectMultiplier: finite.min(-1.5).max(4.5),
    naturalUseProbability: probability,
  })
  .strict();

const naturalSelectionSchema = z
  .object({
    searchUseProbability: probability,
    organicDiscoveryProbability: probability,
    brandedDirectProbability: probability,
    emailSubscriptionProbability: probability,
    promotionWaitingProbability: probability,
    retargetingEligibilityProbability: probability,
  })
  .strict();

const devicePreferenceSchema = z
  .object({
    mobileProbability: probability,
    desktopProbability: probability,
    tabletProbability: probability,
  })
  .strict()
  .superRefine((value, ctx) => {
    const total =
      value.mobileProbability +
      value.desktopProbability +
      value.tabletProbability;
    if (Math.abs(total - 1) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "device probabilities must sum to 1",
      });
    }
  });

const lifecycleSchema = z
  .object({
    state: z.enum([
      "prospect",
      "abstract_recent_buyer",
      "abstract_active_repeat",
      "abstract_lapsing",
      "abstract_dormant",
      "abstract_subscriber",
    ]),
    preSimulationHistory: z.enum([
      "none",
      "abstract_existing_customer",
      "abstract_subscriber",
    ]),
  })
  .strict();

const derivedSegmentSchema = z.enum([
  "new_or_prospect",
  "returning_oriented",
  "high_value",
  "discount_sensitive",
  "brand_loyal",
  "category_enthusiast",
  "gift_oriented",
  "replenishment_oriented",
  "low_intent_browser",
  "advertising_resistant",
  "mobile_dominant",
]);

export const latentCustomerRuntimeSchema = z
  .object({
    customerId: z.string().regex(/^customer_\d{9}$/),
    populationWeight: positive,
    latentFactors: latentFactorsSchema,
    purchaseIntent: probability,
    currentPurchaseNeed: probability,
    priceSensitivityMultiplier: finite.min(0.08).max(5),
    promotionSensitivityMultiplier: finite.min(-1.5).max(4.5),
    brandAffinity: probability,
    categoryPreferences: z.array(categoryPreferenceSchema).min(1).max(12),
    productPreferences: z.array(productPreferenceSchema).min(1).max(24),
    channelTraits: z.array(channelTraitSchema),
    naturalSelection: naturalSelectionSchema,
    devicePreference: devicePreferenceSchema,
    repeatPropensity: probability,
    expectedPurchaseIntervalDays: positive,
    annualPurchaseHazard: nonNegative,
    expectedFuturePurchases: nonNegative,
    expectedOrderValueMinor: positive,
    expectedLifetimeValueMinor: finite,
    lifecycle: lifecycleSchema,
    derivedSegments: z.array(derivedSegmentSchema),
  })
  .strict();

const calibrationMetricSchema = z
  .object({
    metric: z.string().min(1),
    target: finite,
    implied: finite,
    absoluteError: nonNegative,
    tolerance: positive,
    converged: z.boolean(),
  })
  .strict();

const populationConfigSchema = z
  .object({
    maxExplicitAgents: z.number().int().min(10).max(50_000).optional(),
    complexity: z
      .enum(["simple", "normal", "complex", "adversarial", "inherit"])
      .optional(),
    maxCategoryPreferences: z.number().int().min(1).max(12).optional(),
    maxProductPreferences: z.number().int().min(1).max(24).optional(),
    calibrationTolerance: finite.gt(0).max(0.01).optional(),
  })
  .strict();

const provenanceSchema = z
  .object({
    generatorVersion: z.literal("latent-customer-population-3.0.0"),
    merchantWorldId: z.string().min(1),
    merchantWorldFingerprint: z.string().min(1),
    merchantGeneratorVersion: z.string().min(1),
    merchantGroundTruthSchemaVersion: z.literal("1.0.0"),
    merchantWorldSeed: z.number().int().safe().min(0),
    populationSeed: z.number().int().safe().min(0),
    populationConfig: populationConfigSchema,
    inheritedComplexity: z.enum([
      "simple",
      "normal",
      "complex",
      "adversarial",
    ]),
  })
  .strict();

export const latentCustomerPopulationRuntimeSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    generatorVersion: z.literal("latent-customer-population-3.0.0"),
    merchantWorldId: z.string().min(1),
    populationSeed: z.number().int().safe().min(0),
    representedCustomerCount: z.number().int().positive(),
    explicitAgentCount: z.number().int().positive(),
    weightedAgents: z.boolean(),
    customers: z.array(latentCustomerRuntimeSchema).min(1),
    calibration: z
      .object({
        converged: z.boolean(),
        metrics: z.array(calibrationMetricSchema).min(1),
      })
      .strict(),
    provenance: provenanceSchema,
  })
  .strict();

export function formatCustomerSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`;
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
