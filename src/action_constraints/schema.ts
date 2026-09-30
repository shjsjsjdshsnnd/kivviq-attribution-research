import { z } from "zod";

export const constraintReferenceSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

const ref = constraintReferenceSchema;
const familySchema = z.enum([
  "PAID_MEDIA",
  "PRICING",
  "PROMOTION",
  "SHIPPING",
  "MERCHANDISING",
  "INVENTORY",
  "CRO",
  "LIFECYCLE",
  "EXPERIMENT",
]);

export const constraintTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("GLOBAL") }).strict(),
  z.object({ kind: z.literal("FAMILY"), family: familySchema }).strict(),
  z.object({ kind: z.literal("CHANNEL"), ref }).strict(),
  z.object({ kind: z.literal("CAMPAIGN"), ref }).strict(),
  z.object({ kind: z.literal("PRODUCT"), ref }).strict(),
  z.object({ kind: z.literal("SKU"), ref }).strict(),
  z.object({ kind: z.literal("POPULATION"), ref }).strict(),
  z.object({ kind: z.literal("RESOURCE"), ref }).strict(),
]);

const commerceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("GLOBAL") }).strict(),
  z.object({ kind: z.literal("FAMILY"), family: familySchema }).strict(),
  z.object({ kind: z.literal("CHANNEL"), ref }).strict(),
  z.object({ kind: z.literal("CAMPAIGN"), ref }).strict(),
  z.object({ kind: z.literal("PRODUCT"), ref }).strict(),
  z.object({ kind: z.literal("SKU"), ref }).strict(),
  z.object({ kind: z.literal("POPULATION"), ref }).strict(),
]);
const productTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PRODUCT"), ref }).strict(),
  z.object({ kind: z.literal("SKU"), ref }).strict(),
]);
const channelTargetSchema = z.object({ kind: z.literal("CHANNEL"), ref }).strict();
const resourceTargetSchema = z.object({ kind: z.literal("RESOURCE"), ref }).strict();

export const moneyThresholdSchema = z
  .object({
    valueType: z.literal("MONEY"),
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const percentageThresholdSchema = z
  .object({
    valueType: z.literal("PERCENTAGE"),
    basisPoints: z.number().int().min(0).max(10_000),
  })
  .strict();
export const quantityThresholdSchema = z
  .object({
    valueType: z.literal("QUANTITY"),
    value: z.number().positive().finite(),
    unit: ref,
  })
  .strict();
export const scalarThresholdSchema = z
  .object({
    valueType: z.literal("SCALAR"),
    value: z.number().finite(),
    unit: ref,
  })
  .strict();
export const constraintThresholdSchema = z.discriminatedUnion("valueType", [
  moneyThresholdSchema,
  percentageThresholdSchema,
  quantityThresholdSchema,
  scalarThresholdSchema,
]);

export const constraintValueReferenceSchema = z
  .object({ kind: z.enum(["METRIC", "FACT"]), ref })
  .strict();

const evaluationBoundarySchema = z.enum([
  "DECISION_TIME",
  "TRANSLATION_TIME",
  "EFFECTIVE_TIME",
]);
const whenUnknownSchema = z.enum(["UNKNOWN", "INELIGIBLE"]);
const valueBasisSchema = z.enum(["CURRENT_STATE", "PROJECTED_AFTER_ACTION"]);
const gteComparatorSchema = z.literal("GTE");
const lteComparatorSchema = z.literal("LTE");
const comparatorSchema = z.enum(["LTE", "GTE", "EQ"]);

const common = {
  constraintId: ref,
  evaluationBoundary: evaluationBoundarySchema,
  whenUnknown: whenUnknownSchema,
};

export const versionedRuleIdentitySchema = z
  .object({
    registryRef: ref,
    ruleId: ref,
    version: versionSchema,
    effectiveFrom: z.string().datetime(),
    effectiveUntil: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    ({ effectiveFrom, effectiveUntil }) =>
      effectiveUntil === undefined ||
      Date.parse(effectiveFrom) < Date.parse(effectiveUntil),
    { message: "Rule effective interval must increase" },
  );

const availableBudgetSchema = z
  .object({
    ...common,
    kind: z.literal("AVAILABLE_BUDGET"),
    target: commerceTargetSchema,
    resourceRequirementId: ref,
    availableValue: constraintValueReferenceSchema,
  })
  .strict();
const minimumMarginSchema = z
  .object({
    ...common,
    kind: z.literal("MINIMUM_MARGIN"),
    target: commerceTargetSchema,
    valueBasis: valueBasisSchema,
    comparator: gteComparatorSchema,
    threshold: percentageThresholdSchema,
    observedValue: constraintValueReferenceSchema,
  })
  .strict();
const priceFloorSchema = z
  .object({
    ...common,
    kind: z.literal("PRICE_FLOOR"),
    target: productTargetSchema,
    valueBasis: valueBasisSchema,
    comparator: gteComparatorSchema,
    threshold: moneyThresholdSchema,
    observedValue: constraintValueReferenceSchema,
  })
  .strict();
const inventoryAvailabilitySchema = z
  .object({
    ...common,
    kind: z.literal("INVENTORY_AVAILABILITY"),
    target: productTargetSchema,
    resourceRequirementId: ref,
    availableValue: constraintValueReferenceSchema,
  })
  .strict();
const merchantPolicySchema = z
  .object({
    ...common,
    kind: z.literal("MERCHANT_POLICY"),
    target: commerceTargetSchema,
    rule: versionedRuleIdentitySchema,
    expectedDecision: z.enum(["ALLOW", "DENY"]),
  })
  .strict();
const channelAvailabilitySchema = z
  .object({
    ...common,
    kind: z.literal("CHANNEL_AVAILABILITY"),
    target: channelTargetSchema,
    availabilityFact: constraintValueReferenceSchema,
    expectedStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  })
  .strict();
const operationalCapacitySchema = z
  .object({
    ...common,
    kind: z.literal("OPERATIONAL_CAPACITY"),
    target: resourceTargetSchema,
    resourceRequirementId: ref,
    availableValue: constraintValueReferenceSchema,
  })
  .strict();
const maximumDiscountSchema = z
  .object({
    ...common,
    kind: z.literal("MAXIMUM_DISCOUNT"),
    target: commerceTargetSchema,
    valueBasis: valueBasisSchema,
    comparator: lteComparatorSchema,
    threshold: percentageThresholdSchema,
    observedValue: constraintValueReferenceSchema,
  })
  .strict();
const contractualRestrictionSchema = z
  .object({
    ...common,
    kind: z.literal("CONTRACTUAL_RESTRICTION"),
    target: commerceTargetSchema,
    rule: versionedRuleIdentitySchema,
    expectedDecision: z.enum(["ALLOW", "DENY"]),
  })
  .strict();
const riskLimitSchema = z
  .object({
    ...common,
    kind: z.literal("RISK_LIMIT"),
    target: commerceTargetSchema,
    valueBasis: valueBasisSchema,
    metricRef: ref,
    comparator: comparatorSchema,
    threshold: z.union([scalarThresholdSchema, percentageThresholdSchema, moneyThresholdSchema]),
    horizon: z
      .object({
        amount: z.number().int().positive().safe(),
        unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH"]),
      })
      .strict(),
  })
  .strict();
const customConstraintSchema = z
  .object({
    ...common,
    kind: z.literal("CUSTOM"),
    target: constraintTargetSchema,
    registryRef: ref,
    code: ref,
  })
  .strict();

const hardConstraintObjectSchema = z.discriminatedUnion("kind", [
  availableBudgetSchema,
  minimumMarginSchema,
  priceFloorSchema,
  inventoryAvailabilitySchema,
  merchantPolicySchema,
  channelAvailabilitySchema,
  operationalCapacitySchema,
  maximumDiscountSchema,
  contractualRestrictionSchema,
  riskLimitSchema,
  customConstraintSchema,
]);

const forbiddenOutcomeKeys = new Set([
  "winner",
  "lift",
  "significance",
  "posterior",
  "expectedRevenue",
  "expectedProfit",
  "expectedROAS",
  "expectedValue",
  "recommendationScore",
  "confidenceScore",
  "bestCandidate",
]);

function findForbiddenKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item);
      if (found) return found;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenOutcomeKeys.has(key)) return key;
      const found = findForbiddenKey(nested);
      if (found) return found;
    }
  }
  return undefined;
}

export const hardConstraintSchema = hardConstraintObjectSchema.superRefine(
  (value, context) => {
    const forbidden = findForbiddenKey(value);
    if (forbidden) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Outcome or recommendation field is forbidden: ${forbidden}`,
      });
    }
  },
);

export const hardConstraintsSchema = z
  .array(hardConstraintSchema)
  .superRefine((constraints, context) => {
    const seen = new Set<string>();
    constraints.forEach((constraint, index) => {
      if (seen.has(constraint.constraintId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "constraintId"],
          message: `Duplicate constraintId: ${constraint.constraintId}`,
        });
      }
      seen.add(constraint.constraintId);
    });
  });

export type ConstraintTarget = z.infer<typeof constraintTargetSchema>;
export type ConstraintThreshold = z.infer<typeof constraintThresholdSchema>;
export type ConstraintValueReference = z.infer<typeof constraintValueReferenceSchema>;
export type VersionedRuleIdentity = z.infer<typeof versionedRuleIdentitySchema>;
export type HardConstraint = z.infer<typeof hardConstraintSchema>;
