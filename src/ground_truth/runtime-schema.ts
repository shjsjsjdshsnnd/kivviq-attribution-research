import { z } from "zod";

export const finiteNumberSchema = z.number().finite();
export const probabilitySchema = finiteNumberSchema.min(0).max(1);
export const nonNegativeNumberSchema = finiteNumberSchema.min(0);
export const positiveNumberSchema = finiteNumberSchema.gt(0);
export const moneyMinorSchema = finiteNumberSchema.int();
export const nonNegativeMoneyMinorSchema = moneyMinorSchema.min(0);
export const positiveMoneyMinorSchema = moneyMinorSchema.gt(0);
export const durationSecondsSchema = finiteNumberSchema.int().min(0);
export const positiveDurationSecondsSchema = finiteNumberSchema.int().gt(0);
export const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "timestamp must be UTC and end in Z");
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const idSchema = z.string().min(1);

export const causalUnitSchema = z.enum([
  "probability",
  "money_minor",
  "units",
  "orders",
  "customers",
  "impressions",
  "clicks",
  "sessions",
  "seconds",
  "dimensionless",
  "boolean",
  "category",
]);

export const effectScaleSchema = z.enum([
  "absolute",
  "relative",
  "multiplicative",
  "log",
  "probability_point",
  "money_minor",
  "units",
]);

export const causalEffectValueSchema = z
  .object({
    scale: effectScaleSchema,
    value: finiteNumberSchema,
    unit: causalUnitSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scale === "probability_point") {
      if (value.unit !== "probability") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "probability_point effects must use probability units",
          path: ["unit"],
        });
      }
      if (value.value < -1 || value.value > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "probability_point effects must be within [-1,1]",
          path: ["value"],
        });
      }
    }

    if (value.scale === "money_minor" && value.unit !== "money_minor") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "money_minor effects must use money_minor units",
        path: ["unit"],
      });
    }

    if (value.scale === "units" && value.unit !== "units") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "units effects must use units units",
        path: ["unit"],
      });
    }

    if (
      ["relative", "multiplicative", "log"].includes(value.scale) &&
      value.unit !== "dimensionless"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.scale} effects must be dimensionless`,
        path: ["unit"],
      });
    }
  });

const customerTypeSchema = z.enum(["new", "existing"]);
const deviceTypeSchema = z.enum(["mobile", "desktop", "tablet"]);

export const populationSelectorSchema = z
  .object({
    segmentIds: z.array(idSchema).min(1).optional(),
    productIds: z.array(idSchema).min(1).optional(),
    categoryIds: z.array(idSchema).min(1).optional(),
    customerTypes: z.array(customerTypeSchema).min(1).optional(),
    devices: z.array(deviceTypeSchema).min(1).optional(),
  })
  .strict();

export const heterogeneousModifierSchema = z
  .object({
    selector: populationSelectorSchema,
    multiplier: finiteNumberSchema.optional(),
    probabilityPointChange: finiteNumberSchema.min(-1).max(1).optional(),
    absoluteChange: finiteNumberSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.multiplier !== undefined ||
      value.probabilityPointChange !== undefined ||
      value.absoluteChange !== undefined,
    "heterogeneous modifier must define at least one change",
  );

export const merchantLatentParametersSchema = z
  .object({
    currency: currencyCodeSchema,
    marketSize: positiveNumberSchema,
    timezone: z.string().min(1),
    baselineBrandAwareness: probabilitySchema,
    baselineBrandPreference: probabilitySchema,
  })
  .strict();

const segmentShareSchema = z
  .object({
    segmentId: idSchema,
    probability: probabilitySchema,
  })
  .strict();

export const customerGenerationParametersSchema = z
  .object({
    populationSize: positiveNumberSchema,
    segmentShares: z.array(segmentShareSchema).min(1),
    latentIntentDistribution: z
      .object({
        kind: z.literal("beta"),
        alpha: positiveNumberSchema,
        beta: positiveNumberSchema,
      })
      .strict(),
    existingCustomerShare: probabilitySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const segmentIds = new Set(value.segmentShares.map((item) => item.segmentId));
    if (segmentIds.size !== value.segmentShares.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "segmentShares must use unique segmentIds",
        path: ["segmentShares"],
      });
    }

    const total = value.segmentShares.reduce(
      (sum, item) => sum + item.probability,
      0,
    );
    if (Math.abs(total - 1) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "segmentShares probabilities must sum to 1",
        path: ["segmentShares"],
      });
    }
  });

export const baselineDemandMechanismSchema = z
  .object({
    id: idSchema,
    component: z.enum([
      "latent",
      "organic",
      "brand",
      "category",
      "existing_customer",
      "new_customer",
      "product",
    ]),
    outcome: z.enum(["units", "orders"]),
    cadence: z.enum(["hour", "day", "week"]),
    baseRate: nonNegativeNumberSchema,
    paidMarketingIncluded: z.literal(false),
    selector: populationSelectorSchema.optional(),
    heterogeneity: z.array(heterogeneousModifierSchema).optional(),
    timeVarying: z.boolean(),
  })
  .strict();

const linearResponseCurveSchema = z
  .object({
    id: idSchema,
    kind: z.literal("linear"),
    inputUnit: z.literal("money_minor"),
    outputUnit: causalUnitSchema,
    slopePerMoneyMinor: finiteNumberSchema,
    maxSpend: nonNegativeMoneyMinorSchema.optional(),
  })
  .strict();

const hillResponseCurveSchema = z
  .object({
    id: idSchema,
    kind: z.literal("hill"),
    inputUnit: z.literal("money_minor"),
    outputUnit: causalUnitSchema,
    maxIncrementalOutcome: positiveNumberSchema,
    halfSaturationSpend: positiveMoneyMinorSchema,
    hillCoefficient: positiveNumberSchema,
  })
  .strict();

const thresholdResponseCurveSchema = z
  .object({
    id: idSchema,
    kind: z.literal("threshold"),
    inputUnit: z.literal("money_minor"),
    outputUnit: causalUnitSchema,
    thresholdSpend: nonNegativeMoneyMinorSchema,
    belowThresholdSlope: finiteNumberSchema,
    aboveThresholdSlope: finiteNumberSchema,
    maximumOutcome: nonNegativeNumberSchema.optional(),
  })
  .strict();

const piecewiseResponseCurveSchema = z
  .object({
    id: idSchema,
    kind: z.literal("piecewise"),
    inputUnit: z.literal("money_minor"),
    outputUnit: causalUnitSchema,
    points: z
      .array(
        z
          .object({
            spend: nonNegativeMoneyMinorSchema,
            outcome: finiteNumberSchema,
          })
          .strict(),
      )
      .min(2),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (let index = 1; index < value.points.length; index += 1) {
      if (value.points[index]!.spend <= value.points[index - 1]!.spend) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "piecewise response-curve spend points must be strictly increasing",
          path: ["points", index, "spend"],
        });
      }
    }
  });

export const responseCurveSchema = z.discriminatedUnion("kind", [
  linearResponseCurveSchema,
  hillResponseCurveSchema,
  thresholdResponseCurveSchema,
  piecewiseResponseCurveSchema,
]);

const fixedDelayDistributionSchema = z
  .object({
    kind: z.literal("fixed"),
    fixedSeconds: durationSecondsSchema,
  })
  .strict();

const discreteDelayDistributionSchema = z
  .object({
    kind: z.literal("discrete"),
    values: z
      .array(
        z
          .object({
            seconds: durationSecondsSchema,
            probability: probabilitySchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const total = value.values.reduce((sum, item) => sum + item.probability, 0);
    if (Math.abs(total - 1) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "discrete delay probabilities must sum to 1",
        path: ["values"],
      });
    }
  });

export const delayDistributionSchema = z.discriminatedUnion("kind", [
  fixedDelayDistributionSchema,
  discreteDelayDistributionSchema,
]);

export const channelIncrementalityMechanismSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    outcomeVariable: idSchema,
    effect: causalEffectValueSchema,
    responseCurveId: idSchema.optional(),
    delay: delayDistributionSchema.optional(),
    selector: populationSelectorSchema.optional(),
    heterogeneity: z.array(heterogeneousModifierSchema).optional(),
    saturationMechanismId: idSchema.optional(),
    timeDependent: z.boolean(),
  })
  .strict();

export const cacMechanismSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    averageIncrementalCAC: nonNegativeMoneyMinorSchema,
    marginalCACCurveId: idSchema,
    definition: z.literal("incremental_new_customers_only"),
  })
  .strict();

export const conversionModifierSchema = z
  .object({
    condition: z.enum([
      "intent",
      "segment",
      "product",
      "price",
      "device",
      "channel_exposure",
      "journey_state",
      "promotion",
      "website_state",
      "inventory",
      "time",
      "previous_purchase",
    ]),
    selector: populationSelectorSchema.optional(),
    multiplier: finiteNumberSchema.optional(),
    probabilityPointChange: finiteNumberSchema.min(-1).max(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.multiplier !== undefined ||
      value.probabilityPointChange !== undefined,
    "conversion modifier must define multiplier or probabilityPointChange",
  );

export const conversionMechanismSchema = z
  .object({
    id: idSchema,
    outcome: z.enum([
      "purchase",
      "checkout",
      "add_to_cart",
      "product_view",
    ]),
    baseProbability: probabilitySchema,
    modifiers: z.array(conversionModifierSchema),
  })
  .strict();

const constantPriceElasticitySchema = z
  .object({
    id: idSchema,
    kind: z.enum(["own_price", "cross_price"]),
    sourceProductId: idSchema,
    targetProductId: idSchema,
    relationship: z.enum(["self", "substitute", "complement"]),
    form: z.literal("constant"),
    elasticity: finiteNumberSchema,
    selector: populationSelectorSchema.optional(),
  })
  .strict();

const piecewisePriceElasticitySchema = z
  .object({
    id: idSchema,
    kind: z.enum(["own_price", "cross_price"]),
    sourceProductId: idSchema,
    targetProductId: idSchema,
    relationship: z.enum(["self", "substitute", "complement"]),
    form: z.literal("piecewise"),
    points: z
      .array(
        z
          .object({
            relativePriceChange: finiteNumberSchema,
            relativeDemandChange: finiteNumberSchema,
          })
          .strict(),
      )
      .min(2),
    selector: populationSelectorSchema.optional(),
  })
  .strict();

export const priceElasticityMechanismSchema = z
  .discriminatedUnion("form", [
    constantPriceElasticitySchema,
    piecewisePriceElasticitySchema,
  ])
  .superRefine((value, ctx) => {
    if (
      value.kind === "own_price" &&
      (value.relationship !== "self" ||
        value.sourceProductId !== value.targetProductId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "own_price elasticity must use relationship=self and identical source/target products",
      });
    }

    if (value.kind === "cross_price" && value.relationship === "self") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cross_price elasticity cannot use relationship=self",
      });
    }
  });

const promotionOutcomeSchema = z.enum([
  "units",
  "conversion_probability",
  "aov",
  "margin",
  "purchase_timing",
  "repeat_probability",
  "channel_response",
]);

export const promotionElasticityMechanismSchema = z
  .object({
    id: idSchema,
    promotionType: z.enum([
      "percentage_discount",
      "fixed_discount",
      "free_shipping",
      "threshold",
      "bundle",
      "coupon",
      "sitewide",
      "collection",
    ]),
    selector: populationSelectorSchema.optional(),
    effects: z
      .array(
        z
          .object({
            outcome: promotionOutcomeSchema,
            effect: causalEffectValueSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const clvMechanismSchema = z
  .object({
    id: idSchema,
    horizonDays: positiveNumberSchema,
    expectedFuturePurchases: nonNegativeNumberSchema,
    expectedGrossMarginMinor: nonNegativeMoneyMinorSchema,
    expectedDiscountsMinor: nonNegativeMoneyMinorSchema,
    expectedReturnsMinor: nonNegativeMoneyMinorSchema,
    expectedFulfillmentCostsMinor: nonNegativeMoneyMinorSchema,
    expectedAcquisitionCostsMinor: nonNegativeMoneyMinorSchema.optional(),
    retentionProbability: probabilitySchema,
    annualDiscountRate: probabilitySchema.optional(),
    selector: populationSelectorSchema.optional(),
    valueKind: z.literal("expected_future_value"),
  })
  .strict();

export const repeatPurchaseMechanismSchema = z
  .object({
    id: idSchema,
    baseRepeatProbability: probabilitySchema,
    dependsOn: z
      .array(
        z.enum([
          "previous_purchases",
          "product",
          "category",
          "acquisition_source",
          "customer_type",
          "satisfaction_state",
          "promotion_exposure",
          "elapsed_time",
          "lifecycle_state",
        ]),
      )
      .min(1),
    modifiers: z.array(heterogeneousModifierSchema).optional(),
  })
  .strict();

export const productDemandMechanismSchema = z
  .object({
    id: idSchema,
    productId: idSchema,
    categoryId: idSchema,
    baseLatentDemandUnits: nonNegativeNumberSchema,
    cadence: z.enum(["hour", "day", "week"]),
    segmentModifiers: z.array(heterogeneousModifierSchema).optional(),
    substitutionProductIds: z.array(idSchema).optional(),
    complementaryProductIds: z.array(idSchema).optional(),
    timeVarying: z.boolean(),
  })
  .strict();

export const inventoryMechanismSchema = z
  .object({
    id: idSchema,
    productId: idSchema,
    initialAvailableUnits: nonNegativeNumberSchema,
    initialReservedUnits: nonNegativeNumberSchema,
    replenishmentUnits: nonNegativeNumberSchema,
    replenishmentEverySeconds: positiveDurationSecondsSchema.optional(),
    supplierLeadTimeSeconds: durationSecondsSchema,
    allowBackorders: z.boolean(),
    stockoutBehavior: z.enum(["lost_demand", "substitute", "backorder"]),
    substituteProductIds: z.array(idSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.initialReservedUnits > value.initialAvailableUnits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reserved inventory cannot exceed available inventory",
        path: ["initialReservedUnits"],
      });
    }

    if (value.stockoutBehavior === "backorder" && !value.allowBackorders) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "backorder stockout behavior requires allowBackorders=true",
        path: ["allowBackorders"],
      });
    }

    if (
      value.stockoutBehavior === "substitute" &&
      (!value.substituteProductIds || value.substituteProductIds.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "substitute stockout behavior requires substituteProductIds",
        path: ["substituteProductIds"],
      });
    }
  });

export const seasonalityMechanismSchema = z
  .object({
    id: idSchema,
    kind: z.enum([
      "weekday",
      "week",
      "month",
      "quarter",
      "holiday",
      "annual",
      "merchant_specific",
      "product_specific",
    ]),
    selector: populationSelectorSchema.optional(),
    multipliers: z
      .array(
        z
          .object({
            key: z.string().min(1),
            multiplier: nonNegativeNumberSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set(value.multipliers.map((item) => item.key));
    if (keys.size !== value.multipliers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "seasonality multiplier keys must be unique",
        path: ["multipliers"],
      });
    }
  });

export const deviceEffectMechanismSchema = z
  .object({
    id: idSchema,
    device: deviceTypeSchema,
    outcome: z.enum([
      "traffic",
      "funnel_progression",
      "conversion_probability",
      "aov",
      "channel_response",
    ]),
    effect: causalEffectValueSchema,
    populationAdjusted: z.literal(true),
  })
  .strict();

const funnelStateSchema = z.enum([
  "impression",
  "click",
  "session",
  "landing_page",
  "collection",
  "pdp",
  "add_to_cart",
  "checkout",
  "purchase",
  "exit",
]);

export const funnelTransitionMechanismSchema = z
  .object({
    id: idSchema,
    from: funnelStateSchema,
    to: funnelStateSchema,
    baseProbability: probabilitySchema,
    allowsReentry: z.boolean(),
    allowsMultipleSessions: z.boolean(),
    selector: populationSelectorSchema.optional(),
    modifiers: z.array(heterogeneousModifierSchema).optional(),
  })
  .strict()
  .refine((value) => value.from !== value.to, "funnel transition must change state");

export const channelInteractionMechanismSchema = z
  .object({
    id: idSchema,
    channelIds: z.array(idSchema).min(2),
    kind: z.enum([
      "synergy",
      "cannibalization",
      "mediation",
      "zero",
      "delayed",
    ]),
    functionalForm: z.enum(["additive", "multiplicative", "nonlinear"]),
    effect: causalEffectValueSchema,
    delaySeconds: positiveDurationSecondsSchema.optional(),
    mediatorVariable: idSchema.optional(),
    selector: populationSelectorSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.channelIds).size !== value.channelIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel interaction channelIds must be unique",
        path: ["channelIds"],
      });
    }

    if (value.kind === "mediation" && !value.mediatorVariable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediation interaction requires mediatorVariable",
        path: ["mediatorVariable"],
      });
    }

    if (value.kind === "delayed" && value.delaySeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "delayed interaction requires delaySeconds",
        path: ["delaySeconds"],
      });
    }

    if (value.kind === "zero" && value.effect.value !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "zero interaction must have zero causal effect",
        path: ["effect", "value"],
      });
    }
  });

export const saturationMechanismSchema = z
  .object({
    id: idSchema,
    channelId: idSchema,
    responseCurveId: idSchema,
    selector: populationSelectorSchema.optional(),
    finiteOptimalSpendPossible: z.literal(true),
  })
  .strict();

export const organicDemandMechanismSchema = z
  .object({
    id: idSchema,
    counterfactualDefinition: z.literal(
      "demand_without_modeled_paid_intervention",
    ),
    baselineDemandMechanismIds: z.array(idSchema).min(1),
  })
  .strict();

export const marginEconomicsSchema = z
  .object({
    currency: currencyCodeSchema,
    accountingIdentity: z.literal("contribution_profit_v1"),
    includeVariableOperatingCosts: z.boolean(),
  })
  .strict();

export const externalShockSchema = z
  .object({
    id: idSchema,
    kind: z.enum([
      "competitor_promotion",
      "economic_demand",
      "weather",
      "viral",
      "platform_change",
      "supplier_disruption",
      "shipping_disruption",
      "market_trend",
    ]),
    start: utcTimestampSchema,
    durationSeconds: positiveDurationSecondsSchema,
    selector: populationSelectorSchema.optional(),
    affectedVariables: z.array(idSchema).min(1),
    mechanism: z
      .object({
        functionalForm: z.enum(["additive", "multiplicative", "nonlinear"]),
        effect: causalEffectValueSchema,
      })
      .strict(),
  })
  .strict();

const causalDomainSchema = z.enum([
  "customer",
  "demand",
  "marketing",
  "pricing",
  "promotion",
  "inventory",
  "funnel",
  "commerce",
  "economics",
  "external",
]);

const informationVisibilitySchema = z.enum([
  "latent",
  "perfect_observation",
  "merchant_observation",
]);

export const causalNodeSchema = z
  .object({
    id: idSchema,
    domain: causalDomainSchema,
    temporalScope: z.enum(["static", "time_indexed"]),
    valueType: z.enum(["number", "boolean", "category"]),
    unit: causalUnitSchema,
    intervenable: z.boolean(),
    visibility: informationVisibilitySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.valueType === "boolean" && value.unit !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "boolean causal nodes must use boolean units",
        path: ["unit"],
      });
    }
    if (value.valueType === "category" && value.unit !== "category") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "category causal nodes must use category units",
        path: ["unit"],
      });
    }
    if (
      value.valueType === "number" &&
      ["boolean", "category"].includes(value.unit)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "numeric causal nodes cannot use boolean/category units",
        path: ["unit"],
      });
    }
  });

export const causalEdgeSchema = z
  .object({
    parent: idSchema,
    child: idSchema,
    relationship: z.enum(["direct", "mediated", "interaction", "constraint"]),
    mechanismId: idSchema,
    lagSeconds: durationSecondsSchema.optional(),
  })
  .strict();

export const causalGraphSchema = z
  .object({
    nodes: z.array(causalNodeSchema).min(1),
    edges: z.array(causalEdgeSchema),
  })
  .strict();

export const interventionDefinitionSchema = z
  .object({
    variable: idSchema,
    allowedOperation: z.literal("set"),
    description: z.string().min(1),
  })
  .strict();

export const groundTruthManifestRuntimeSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    simulatorVersion: z.string().min(1),
    worldId: idSchema,
    seed: finiteNumberSchema.int().safe().min(0),
    merchant: merchantLatentParametersSchema,
    customers: customerGenerationParametersSchema,
    baselineDemand: z.array(baselineDemandMechanismSchema),
    channelIncrementality: z.array(channelIncrementalityMechanismSchema),
    responseCurves: z.array(responseCurveSchema),
    cacMechanisms: z.array(cacMechanismSchema),
    conversionMechanisms: z.array(conversionMechanismSchema),
    priceElasticities: z.array(priceElasticityMechanismSchema),
    promotionElasticities: z.array(promotionElasticityMechanismSchema),
    clvMechanisms: z.array(clvMechanismSchema),
    repeatPurchaseMechanisms: z.array(repeatPurchaseMechanismSchema),
    productDemandMechanisms: z.array(productDemandMechanismSchema),
    inventoryMechanisms: z.array(inventoryMechanismSchema),
    seasonality: z.array(seasonalityMechanismSchema),
    deviceEffects: z.array(deviceEffectMechanismSchema),
    funnelMechanisms: z.array(funnelTransitionMechanismSchema),
    channelInteractions: z.array(channelInteractionMechanismSchema),
    saturationMechanisms: z.array(saturationMechanismSchema),
    organicDemand: organicDemandMechanismSchema,
    marginEconomics: marginEconomicsSchema,
    externalShocks: z.array(externalShockSchema),
    causalGraph: causalGraphSchema,
    interventionDefinitions: z.array(interventionDefinitionSchema),
  })
  .strict();

export function formatRuntimeSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`;
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
