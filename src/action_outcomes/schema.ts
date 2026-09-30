import { z } from "zod";
import {
  constraintTargetSchema,
  constraintThresholdSchema,
} from "../action_constraints/schema.js";
import { populationReferenceSchema } from "../population/schema.js";

const stableReferenceSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const versionedOutcomeReferenceSchema = z
  .object({
    registryRef: stableReferenceSchema,
    code: stableReferenceSchema,
    version: versionSchema,
  })
  .strict();

export const outcomeMeasurementHorizonSchema = z
  .object({
    amount: z.number().int().positive().safe(),
    unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH"]),
    anchor: z.enum([
      "DECISION_TIME",
      "ACTION_EFFECTIVE",
      "ACTION_END",
      "EXPERIMENT_MEASUREMENT_START",
    ]),
  })
  .strict();

export const outcomeMetricFamilySchema = z.union([
  z.enum([
    "CONTRIBUTION_PROFIT",
    "INCREMENTAL_CUSTOMERS",
    "CONVERSION_RATE",
    "INVENTORY_POSITION",
    "RETENTION_RATE",
    "REVENUE",
    "ORDER_COUNT",
    "AOV",
    "CAC",
    "REPEAT_PURCHASE_RATE",
    "LIFECYCLE_ENGAGEMENT",
    "EVIDENCE_RESOLUTION",
    "INFORMATION_GAIN",
  ]),
  z
    .object({
      kind: z.literal("CUSTOM"),
      registryRef: stableReferenceSchema,
      code: stableReferenceSchema,
      version: versionSchema,
    })
    .strict(),
]);

export const outcomeValueTypeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("MONEY"),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
  z.object({ kind: z.literal("PERCENTAGE") }).strict(),
  z
    .object({
      kind: z.literal("QUANTITY"),
      unit: z.enum(["customers", "orders", "units", "sessions", "messages"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SCALAR"),
      unitRef: stableReferenceSchema,
    })
    .strict(),
]);

export const outcomeComparisonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NONE") }).strict(),
  z
    .object({
      kind: z.literal("BASELINE"),
      baselineRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("PRE_ACTION"),
      lookbackWindowRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CONTROL"),
      controlRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("EXTERNAL_BENCHMARK"),
      benchmarkRef: stableReferenceSchema,
    })
    .strict(),
]);

export const outcomeSuccessConditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("CHANGE"),
      direction: z.enum(["INCREASE", "DECREASE"]),
      minimumMagnitude: constraintThresholdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ABSOLUTE_THRESHOLD"),
      comparator: z.enum(["GTE", "LTE", "GT", "LT", "EQ"]),
      threshold: constraintThresholdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("RANGE"),
      minimum: constraintThresholdSchema,
      maximum: constraintThresholdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("RESOLUTION"),
      requiredStateRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("NON_INFERIOR"),
      tolerance: constraintThresholdSchema,
    })
    .strict(),
]);

const forbiddenOutcomeKeys = new Set([
  "observedvalue",
  "observedvalues",
  "actualvalue",
  "actualvalues",
  "result",
  "results",
  "winner",
  "winners",
  "score",
  "scores",
  "rank",
  "ranks",
  "probability",
  "probabilities",
  "prediction",
  "predictions",
  "expectedvalue",
  "expectedvalues",
  "groundtruth",
  "trueworld",
  "oracle",
  "regret",
  "optimalaction",
  "actualbest",
]);

const hiddenNamespacePattern =
  /(?:^|[._:-])(ground[_-]?truth|god[_-]?mode|true[_-]?world|oracle|latent[_-]?state|optimal[_-]?action|actual[_-]?best)(?:$|[._:-])/i;

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

type OutcomeInputScan =
  | { kind: "VALID" }
  | { kind: "FORBIDDEN_KEY"; key: string }
  | { kind: "HIDDEN_REFERENCE"; value: string }
  | { kind: "CYCLIC" }
  | { kind: "TOO_DEEP" }
  | { kind: "TOO_COMPLEX" };

function scanOutcomeInput(
  value: unknown,
  depth = 0,
  state: { nodes: number; ancestors: WeakSet<object> } = {
    nodes: 0,
    ancestors: new WeakSet<object>(),
  },
): OutcomeInputScan {
  if (depth > 48) return { kind: "TOO_DEEP" };
  if (typeof value === "string") {
    return hiddenNamespacePattern.test(value)
      ? { kind: "HIDDEN_REFERENCE", value }
      : { kind: "VALID" };
  }
  if (value === null || typeof value !== "object")
    return { kind: "VALID" };

  state.nodes += 1;
  if (state.nodes > 10_000) return { kind: "TOO_COMPLEX" };
  if (state.ancestors.has(value)) return { kind: "CYCLIC" };
  state.ancestors.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = scanOutcomeInput(entry, depth + 1, state);
      if (result.kind !== "VALID") {
        state.ancestors.delete(value);
        return result;
      }
    }
  } else {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenOutcomeKeys.has(normalizedKey(key))) {
        state.ancestors.delete(value);
        return { kind: "FORBIDDEN_KEY", key };
      }
      const result = scanOutcomeInput(nested, depth + 1, state);
      if (result.kind !== "VALID") {
        state.ancestors.delete(value);
        return result;
      }
    }
  }

  state.ancestors.delete(value);
  return { kind: "VALID" };
}

const noOutcomeLeakageSchema = z.unknown().superRefine((value, context) => {
  const result = scanOutcomeInput(value);
  if (result.kind === "FORBIDDEN_KEY")
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Observed result, ranking, prediction, or God-mode field is forbidden: ${result.key}`,
    });
  else if (result.kind === "HIDDEN_REFERENCE")
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Hidden evaluator or God-mode reference is forbidden: ${result.value}`,
    });
  else if (result.kind === "CYCLIC")
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cyclic outcome contract input is forbidden",
    });
  else if (result.kind === "TOO_DEEP")
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outcome contract input exceeds maximum depth",
    });
  else if (result.kind === "TOO_COMPLEX")
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outcome contract input is too complex",
    });
});

function thresholdValueType(value: z.infer<typeof constraintThresholdSchema>): string {
  return value.valueType;
}

function compatibleThreshold(
  valueType: z.infer<typeof outcomeValueTypeSchema>,
  threshold: z.infer<typeof constraintThresholdSchema>,
): boolean {
  if (valueType.kind !== thresholdValueType(threshold)) return false;
  if (valueType.kind === "MONEY" && threshold.valueType === "MONEY")
    return valueType.currency === threshold.currency;
  if (valueType.kind === "QUANTITY" && threshold.valueType === "QUANTITY")
    return valueType.unit === threshold.unit;
  if (valueType.kind === "SCALAR" && threshold.valueType === "SCALAR")
    return valueType.unitRef === threshold.unit;
  return true;
}

function numericThreshold(
  threshold: z.infer<typeof constraintThresholdSchema>,
): number {
  switch (threshold.valueType) {
    case "MONEY":
      return threshold.amountMinor;
    case "PERCENTAGE":
      return threshold.basisPoints;
    case "QUANTITY":
    case "SCALAR":
      return threshold.value;
  }
}

const actionOutcomeContractObjectSchema = z
  .object({
    outcomeId: stableReferenceSchema,
    role: z.enum(["PRIMARY", "SECONDARY", "GUARDRAIL"]),
    metricRef: stableReferenceSchema,
    metricFamily: outcomeMetricFamilySchema,
    target: constraintTargetSchema,
    population: populationReferenceSchema.optional(),
    valueType: outcomeValueTypeSchema,
    comparison: outcomeComparisonSchema,
    successCondition: outcomeSuccessConditionSchema,
    horizon: outcomeMeasurementHorizonSchema,
    evidencePolicyRef: stableReferenceSchema,
    sourceDefinitionRef: versionedOutcomeReferenceSchema,
    decisionLedger: z
      .object({
        outcomeKey: stableReferenceSchema,
        evidenceSlotRef: stableReferenceSchema,
      })
      .strict(),
    learning: z
      .object({
        signalRef: stableReferenceSchema,
        updateRuleRef: stableReferenceSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((contract, context) => {
    if (
      contract.successCondition.kind === "CHANGE" &&
      contract.comparison.kind === "NONE"
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comparison"],
        message: "A change-based success condition requires an explicit comparator",
      });

    const thresholds =
      contract.successCondition.kind === "CHANGE"
        ? contract.successCondition.minimumMagnitude
          ? [contract.successCondition.minimumMagnitude]
          : []
        : contract.successCondition.kind === "ABSOLUTE_THRESHOLD"
          ? [contract.successCondition.threshold]
          : contract.successCondition.kind === "RANGE"
            ? [
                contract.successCondition.minimum,
                contract.successCondition.maximum,
              ]
            : contract.successCondition.kind === "NON_INFERIOR"
              ? [contract.successCondition.tolerance]
              : [];

    for (const threshold of thresholds)
      if (!compatibleThreshold(contract.valueType, threshold))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["successCondition"],
          message: "Success-condition threshold type must match the outcome value type",
        });

    if (
      contract.successCondition.kind === "RANGE" &&
      numericThreshold(contract.successCondition.minimum) >
        numericThreshold(contract.successCondition.maximum)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["successCondition"],
        message: "Outcome success range minimum cannot exceed maximum",
      });

    if (
      contract.successCondition.kind === "RESOLUTION" &&
      contract.metricFamily !== "EVIDENCE_RESOLUTION" &&
      contract.metricFamily !== "INFORMATION_GAIN"
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metricFamily"],
        message: "Resolution success is reserved for evidence or information outcomes",
      });
  });

export const actionOutcomeContractSchema = noOutcomeLeakageSchema.pipe(
  actionOutcomeContractObjectSchema,
);

const actionOutcomeContractsObjectSchema = z
  .array(actionOutcomeContractObjectSchema)
  .min(1)
  .superRefine((contracts, context) => {
    if (contracts.filter(({ role }) => role === "PRIMARY").length !== 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every Action requires exactly one PRIMARY measurable outcome",
      });

    const outcomeIds = new Set<string>();
    const ledgerKeys = new Set<string>();
    for (const [index, contract] of contracts.entries()) {
      if (outcomeIds.has(contract.outcomeId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "outcomeId"],
          message: "Duplicate outcome ID",
        });
      outcomeIds.add(contract.outcomeId);

      if (ledgerKeys.has(contract.decisionLedger.outcomeKey))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "decisionLedger", "outcomeKey"],
          message: "Decision Ledger outcome keys must be unique within an Action",
        });
      ledgerKeys.add(contract.decisionLedger.outcomeKey);
    }
  });

export const actionOutcomeContractsSchema = noOutcomeLeakageSchema.pipe(
  actionOutcomeContractsObjectSchema,
);

export type VersionedOutcomeReference = z.infer<
  typeof versionedOutcomeReferenceSchema
>;
export type OutcomeMeasurementHorizon = z.infer<
  typeof outcomeMeasurementHorizonSchema
>;
export type OutcomeMetricFamily = z.infer<typeof outcomeMetricFamilySchema>;
export type OutcomeValueType = z.infer<typeof outcomeValueTypeSchema>;
export type OutcomeComparison = z.infer<typeof outcomeComparisonSchema>;
export type OutcomeSuccessCondition = z.infer<
  typeof outcomeSuccessConditionSchema
>;
export type ActionOutcomeContract = z.infer<
  typeof actionOutcomeContractSchema
>;
export type ActionOutcomeContracts = z.infer<
  typeof actionOutcomeContractsSchema
>;
