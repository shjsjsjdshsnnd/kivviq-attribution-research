import { z } from "zod";
import { constraintTargetSchema } from "../action_constraints/schema.js";
import { populationReferenceSchema } from "../population/schema.js";

const stableReferenceSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const versionedRiskReferenceSchema = z
  .object({
    registryRef: stableReferenceSchema,
    code: stableReferenceSchema,
    version: versionSchema,
  })
  .strict();

export const riskHorizonSchema = z
  .object({
    amount: z.number().int().positive().safe(),
    unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH"]),
  })
  .strict();

const common = {
  measurementId: stableReferenceSchema,
  metricRef: stableReferenceSchema,
  horizon: riskHorizonSchema,
  aggregation: z.enum(["SUM", "MAXIMUM", "DISTRIBUTION", "INTERVAL"]),
  evidencePolicyRef: stableReferenceSchema,
  sourceDefinitionRef: versionedRiskReferenceSchema,
};

const moneyValueTypeSchema = z
  .object({
    kind: z.literal("MONEY"),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const percentageValueTypeSchema = z.object({ kind: z.literal("PERCENTAGE") }).strict();

export const controlledQuantityUnitSchema = z.union([
  z.enum(["units", "customers", "orders", "messages"]),
  versionedRiskReferenceSchema,
]);

const quantityValueTypeSchema = z
  .object({
    kind: z.literal("QUANTITY"),
    unit: controlledQuantityUnitSchema,
  })
  .strict();

const scalarValueTypeSchema = z
  .object({
    kind: z.literal("SCALAR"),
    unit: versionedRiskReferenceSchema,
  })
  .strict();

export const financialDownsideMeasurementSchema = z
  .object({
    ...common,
    dimension: z.literal("FINANCIAL_DOWNSIDE"),
    target: constraintTargetSchema,
    valueType: moneyValueTypeSchema,
    lossBaselineRef: stableReferenceSchema,
  })
  .strict();

export const irreversibleEffectKindSchema = z.enum([
  "MESSAGE_DELIVERED",
  "INVENTORY_COMMITTED",
  "CUSTOMER_EXPOSED",
  "EXTERNAL_COMMITMENT",
  "CUSTOM",
]);

const irreversibilityMeasurementObjectSchema = z
  .object({
    ...common,
    dimension: z.literal("IRREVERSIBILITY"),
    target: constraintTargetSchema,
    valueType: z.union([quantityValueTypeSchema, percentageValueTypeSchema]),
    reversibilityContractRef: stableReferenceSchema,
    irreversibleEffectKinds: z.array(irreversibleEffectKindSchema).min(1),
    restorationCriterionRef: stableReferenceSchema,
  })
  .strict();

function rejectDuplicateIrreversibleEffects(
  irreversibleEffectKinds: readonly string[],
  context: z.RefinementCtx,
): void {
  if (new Set(irreversibleEffectKinds).size !== irreversibleEffectKinds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["irreversibleEffectKinds"],
      message: "Duplicate irreversible effect kind",
    });
  }
}

export const irreversibilityMeasurementSchema =
  irreversibilityMeasurementObjectSchema.superRefine(
    ({ irreversibleEffectKinds }, context) =>
      rejectDuplicateIrreversibleEffects(irreversibleEffectKinds, context),
  );

export const uncertaintySourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("PARAMETER_METRIC"),
      parameterRef: stableReferenceSchema,
      metricRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CUSTOM"),
      registryRef: stableReferenceSchema,
      code: stableReferenceSchema,
      version: versionSchema,
    })
    .strict(),
]);

export const uncertaintyMeasurementSchema = z
  .object({
    ...common,
    dimension: z.literal("UNCERTAINTY"),
    target: constraintTargetSchema,
    valueType: z.union([percentageValueTypeSchema, scalarValueTypeSchema]),
    uncertainQuantityRef: stableReferenceSchema,
    uncertaintySource: uncertaintySourceSchema,
  })
  .strict();

export const inventoryTargetSchema = z
  .object({
    productRef: stableReferenceSchema,
    variantRef: stableReferenceSchema.optional(),
    locationRef: stableReferenceSchema.optional(),
  })
  .strict();

const inventoryQuantityValueTypeSchema = z
  .object({
    kind: z.literal("QUANTITY"),
    unit: z.union([z.literal("units"), versionedRiskReferenceSchema]),
  })
  .strict();

export const inventoryExposureMeasurementSchema = z
  .object({
    ...common,
    dimension: z.literal("INVENTORY_EXPOSURE"),
    inventoryTarget: inventoryTargetSchema,
    valueType: z.union([moneyValueTypeSchema, inventoryQuantityValueTypeSchema]),
  })
  .strict();

export const customerImpactMeasurementSchema = z
  .object({
    ...common,
    dimension: z.literal("CUSTOMER_IMPACT"),
    population: populationReferenceSchema,
    impactFamily: versionedRiskReferenceSchema,
    valueType: z.union([
      percentageValueTypeSchema,
      z.object({ kind: z.literal("QUANTITY"), unit: z.literal("customers") }).strict(),
    ]),
  })
  .strict();

export const timeToRecoveryMeasurementSchema = z
  .object({
    ...common,
    dimension: z.literal("TIME_TO_RECOVERY"),
    target: constraintTargetSchema,
    recoveryBaselineRef: stableReferenceSchema,
    recoveryCriterionRef: stableReferenceSchema,
    startBoundary: z.enum([
      "ACTION_STARTED",
      "ACTION_EFFECTIVE",
      "DOWNSIDE_OBSERVED",
      "REVERSAL_STARTED",
    ]),
    valueType: z
      .object({
        kind: z.literal("DURATION"),
        unit: z.enum(["SECOND", "MINUTE", "HOUR", "DAY"]),
      })
      .strict(),
  })
  .strict();

const riskMeasurementObjectSchema = z
  .discriminatedUnion("dimension", [
  financialDownsideMeasurementSchema,
  irreversibilityMeasurementObjectSchema,
  uncertaintyMeasurementSchema,
  inventoryExposureMeasurementSchema,
  customerImpactMeasurementSchema,
  timeToRecoveryMeasurementSchema,
  ])
  .superRefine((measurement, context) => {
    if (measurement.dimension === "IRREVERSIBILITY") {
      rejectDuplicateIrreversibleEffects(
        measurement.irreversibleEffectKinds,
        context,
      );
    }
  });

const forbiddenRiskKeys = new Set([
  "value",
  "values",
  "score",
  "scores",
  "rating",
  "ratings",
  "grade",
  "grades",
  "probability",
  "probabilities",
  "estimate",
  "estimates",
  "estimatedvalue",
  "prediction",
  "predictions",
  "expectedloss",
  "expectedlosses",
  "confidence",
  "weight",
  "weights",
  "rank",
  "ranks",
  "recommendation",
  "recommendations",
  "compositerisk",
  "outcome",
  "outcomes",
  "result",
  "results",
]);

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

type RiskInputScan =
  | { kind: "VALID" }
  | { kind: "FORBIDDEN_KEY"; key: string }
  | { kind: "CYCLIC" }
  | { kind: "TOO_DEEP" }
  | { kind: "TOO_COMPLEX" };

const maximumRiskInputDepth = 48;
const maximumRiskInputNodes = 10_000;

function scanRiskInput(
  value: unknown,
  depth = 0,
  state: { nodes: number; ancestors: WeakSet<object> } = {
    nodes: 0,
    ancestors: new WeakSet<object>(),
  },
): RiskInputScan {
  if (depth > maximumRiskInputDepth) return { kind: "TOO_DEEP" };
  if (value === null || typeof value !== "object") return { kind: "VALID" };
  state.nodes += 1;
  if (state.nodes > maximumRiskInputNodes) return { kind: "TOO_COMPLEX" };
  if (state.ancestors.has(value)) return { kind: "CYCLIC" };
  state.ancestors.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = scanRiskInput(entry, depth + 1, state);
      if (result.kind !== "VALID") {
        state.ancestors.delete(value);
        return result;
      }
    }
  } else {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenRiskKeys.has(normalizedKey(key))) {
        state.ancestors.delete(value);
        return { kind: "FORBIDDEN_KEY", key };
      }
      const result = scanRiskInput(nested, depth + 1, state);
      if (result.kind !== "VALID") {
        state.ancestors.delete(value);
        return result;
      }
    }
  }
  state.ancestors.delete(value);
  return { kind: "VALID" };
}

const noRiskLeakageSchema = z.unknown().superRefine((value, context) => {
  const result = scanRiskInput(value);
  if (result.kind === "FORBIDDEN_KEY") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Risk value, score, prediction, or outcome field is forbidden: ${result.key}`,
    });
  } else if (result.kind === "CYCLIC") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Cyclic risk input is forbidden" });
  } else if (result.kind === "TOO_DEEP") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Risk input exceeds maximum depth" });
  } else if (result.kind === "TOO_COMPLEX") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Risk input is too complex" });
  }
});

export const riskMeasurementContractSchema = noRiskLeakageSchema.pipe(
  riskMeasurementObjectSchema,
);

const actionRiskMeasurementContractsObjectSchema = z
  .object({
    FINANCIAL_DOWNSIDE: z.array(financialDownsideMeasurementSchema).min(1),
    IRREVERSIBILITY: z.array(irreversibilityMeasurementSchema).min(1),
    UNCERTAINTY: z.array(uncertaintyMeasurementSchema).min(1),
    INVENTORY_EXPOSURE: z.array(inventoryExposureMeasurementSchema).min(1),
    CUSTOMER_IMPACT: z.array(customerImpactMeasurementSchema).min(1),
    TIME_TO_RECOVERY: z.array(timeToRecoveryMeasurementSchema).min(1),
  })
  .strict()
  .superRefine((contracts, context) => {
    const seen = new Set<string>();
    for (const measurements of Object.values(contracts)) {
      for (const measurement of measurements) {
        if (seen.has(measurement.measurementId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate risk measurement ID: ${measurement.measurementId}`,
          });
        }
        seen.add(measurement.measurementId);
      }
    }
  });

export const actionRiskMeasurementContractsSchema = noRiskLeakageSchema.pipe(
  actionRiskMeasurementContractsObjectSchema,
);

export type VersionedRiskReference = z.infer<typeof versionedRiskReferenceSchema>;
export type RiskHorizon = z.infer<typeof riskHorizonSchema>;
export type ControlledQuantityUnit = z.infer<typeof controlledQuantityUnitSchema>;
export type FinancialDownsideMeasurement = z.infer<typeof financialDownsideMeasurementSchema>;
export type IrreversibilityMeasurement = z.infer<typeof irreversibilityMeasurementSchema>;
export type UncertaintyMeasurement = z.infer<typeof uncertaintyMeasurementSchema>;
export type InventoryExposureMeasurement = z.infer<typeof inventoryExposureMeasurementSchema>;
export type CustomerImpactMeasurement = z.infer<typeof customerImpactMeasurementSchema>;
export type TimeToRecoveryMeasurement = z.infer<typeof timeToRecoveryMeasurementSchema>;
export type RiskMeasurementContract = z.infer<typeof riskMeasurementContractSchema>;
export type ActionRiskMeasurementContracts = z.infer<
  typeof actionRiskMeasurementContractsSchema
>;
