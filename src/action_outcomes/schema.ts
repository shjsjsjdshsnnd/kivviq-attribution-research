import { z } from "zod";

const stableReferenceSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const outcomeFamilySchema = z.enum([
  "CONTRIBUTION_PROFIT",
  "INCREMENTAL_CUSTOMERS",
  "CONVERSION_RATE",
  "INVENTORY_POSITION",
  "RETENTION_RATE",
  "REVENUE",
  "ORDERS",
  "REPEAT_PURCHASE_RATE",
  "CUSTOMER_VALUE",
  "RETURN_RATE",
  "ENGAGEMENT",
  "EXPERIENCE_PERFORMANCE",
  "MESSAGING_DELIVERY",
  "SUBSCRIPTION_STATUS",
  "EVIDENCE_QUALITY",
]);

export const outcomeRoleSchema = z.enum([
  "PRIMARY",
  "SECONDARY",
  "GUARDRAIL",
]);

export const outcomeHorizonSchema = z
  .object({
    amount: z.number().int().positive().safe(),
    unit: z.enum(["SECOND", "MINUTE", "HOUR", "DAY", "WEEK"]),
  })
  .strict();

const versionedReferenceSchema = z
  .object({
    registryRef: stableReferenceSchema,
    code: stableReferenceSchema,
    version: versionSchema,
  })
  .strict();

const valueTypeSchema = z.discriminatedUnion("kind", [
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
      unit: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("SCALAR"),
      unit: versionedReferenceSchema,
    })
    .strict(),
]);

const comparisonReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("PRE_ACTION_BASELINE"),
      baselineRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CONCURRENT_CONTROL"),
      controlRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("HOLDOUT_POPULATION"),
      populationRef: stableReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("REGISTERED_REFERENCE"),
      reference: versionedReferenceSchema,
    })
    .strict(),
  z.object({ kind: z.literal("ABSOLUTE_METRIC") }).strict(),
]);

const successCriterionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DIRECTIONAL"),
      direction: z.enum(["INCREASE", "DECREASE", "MAINTAIN"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("THRESHOLD"),
      comparator: z.enum(["LT", "LTE", "EQ", "GTE", "GT"]),
      thresholdRef: stableReferenceSchema,
    })
    .strict(),
  z.object({ kind: z.literal("OBSERVE_ONLY") }).strict(),
]);

const measurementWindowSchema = z
  .object({
    anchor: z.enum(["ACTION_EFFECTIVE", "ACTION_COMPLETED"]),
    earliestMeaningful: outcomeHorizonSchema,
    primaryEvaluation: outcomeHorizonSchema,
    longTermFollowUp: outcomeHorizonSchema.optional(),
  })
  .strict()
  .superRefine((window, context) => {
    const earliest = horizonSeconds(window.earliestMeaningful);
    const primary = horizonSeconds(window.primaryEvaluation);
    const longTerm = window.longTermFollowUp
      ? horizonSeconds(window.longTermFollowUp)
      : undefined;
    if (earliest > primary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["earliestMeaningful"],
        message:
          "Earliest meaningful evaluation cannot be later than the primary evaluation",
      });
    }
    if (longTerm !== undefined && primary > longTerm) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["longTermFollowUp"],
        message:
          "Long-term follow-up cannot be earlier than the primary evaluation",
      });
    }
  });

const actionOutcomeMeasurementObjectSchema = z
  .object({
    outcomeId: stableReferenceSchema,
    family: outcomeFamilySchema,
    metricRef: stableReferenceSchema,
    role: outcomeRoleSchema,
    valueType: valueTypeSchema,
    comparison: comparisonReferenceSchema,
    successCriterion: successCriterionSchema,
    measurementWindow: measurementWindowSchema,
    sourceDefinitionRef: versionedReferenceSchema,
    evidencePolicyRef: stableReferenceSchema,
  })
  .strict();

const forbiddenOutcomeKeys = new Set([
  "actual",
  "actualvalue",
  "observedvalue",
  "realizedvalue",
  "result",
  "results",
  "winner",
  "lift",
  "significance",
  "posterior",
  "probability",
  "prediction",
  "predictions",
  "expectedrevenue",
  "expectedprofit",
  "expectedroas",
  "expectedlift",
  "expectedvalue",
  "recommendationscore",
  "confidencescore",
  "bestcandidate",
  "bestaction",
  "futuredemand",
  "futureconversion",
  "futureconversions",
  "counterfactualrevenue",
  "counterfactualprofit",
  "trueincrementalroas",
  "groundtruth",
  "oraclestate",
  "latentstate",
]);

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

type ScanResult =
  | { kind: "VALID" }
  | { kind: "FORBIDDEN_KEY"; key: string }
  | { kind: "CYCLIC" }
  | { kind: "TOO_DEEP" }
  | { kind: "TOO_COMPLEX" };

function scanOutcomeDefinition(
  value: unknown,
  depth = 0,
  state: { nodes: number; ancestors: WeakSet<object> } = {
    nodes: 0,
    ancestors: new WeakSet<object>(),
  },
): ScanResult {
  if (depth > 48) return { kind: "TOO_DEEP" };
  if (value === null || typeof value !== "object") return { kind: "VALID" };
  state.nodes += 1;
  if (state.nodes > 10_000) return { kind: "TOO_COMPLEX" };
  if (state.ancestors.has(value)) return { kind: "CYCLIC" };
  state.ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);
  for (const [key, nested] of entries) {
    if (!Array.isArray(value) && forbiddenOutcomeKeys.has(normalizedKey(key))) {
      state.ancestors.delete(value);
      return { kind: "FORBIDDEN_KEY", key };
    }
    const result = scanOutcomeDefinition(nested, depth + 1, state);
    if (result.kind !== "VALID") {
      state.ancestors.delete(value);
      return result;
    }
  }
  state.ancestors.delete(value);
  return { kind: "VALID" };
}

const noOutcomeLeakageSchema = z.unknown().superRefine((value, context) => {
  const result = scanOutcomeDefinition(value);
  if (result.kind === "FORBIDDEN_KEY") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Outcome definitions may specify measurement contracts, never realized, predicted, counterfactual, or God-mode values: " +
        result.key,
    });
  } else if (result.kind === "CYCLIC") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cyclic outcome definitions are forbidden",
    });
  } else if (result.kind === "TOO_DEEP") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outcome definition exceeds maximum depth",
    });
  } else if (result.kind === "TOO_COMPLEX") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Outcome definition is too complex",
    });
  }
});

export const actionOutcomeMeasurementSchema = noOutcomeLeakageSchema.pipe(
  actionOutcomeMeasurementObjectSchema,
);

const actionOutcomePlanObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    outcomes: z.array(actionOutcomeMeasurementObjectSchema).min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    const seen = new Set<string>();
    plan.outcomes.forEach((outcome, index) => {
      if (seen.has(outcome.outcomeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomes", index, "outcomeId"],
          message: "Duplicate outcomeId",
        });
      }
      seen.add(outcome.outcomeId);
    });
    if (!plan.outcomes.some(({ role }) => role === "PRIMARY")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcomes"],
        message: "Every measurable Action requires at least one PRIMARY outcome",
      });
    }
  });

export const actionOutcomePlanSchema = noOutcomeLeakageSchema.pipe(
  actionOutcomePlanObjectSchema,
);

export type ActionOutcomeFamily = z.infer<typeof outcomeFamilySchema>;
export type ActionOutcomeRole = z.infer<typeof outcomeRoleSchema>;
export type ActionOutcomeHorizon = z.infer<typeof outcomeHorizonSchema>;
export type ActionOutcomeMeasurement = z.infer<
  typeof actionOutcomeMeasurementSchema
>;
export type ActionOutcomePlan = z.infer<typeof actionOutcomePlanSchema>;

export function horizonSeconds(horizon: ActionOutcomeHorizon): number {
  const multiplier = {
    SECOND: 1,
    MINUTE: 60,
    HOUR: 60 * 60,
    DAY: 24 * 60 * 60,
    WEEK: 7 * 24 * 60 * 60,
  }[horizon.unit];
  return horizon.amount * multiplier;
}

export function canonicalizeActionOutcomePlan(
  input: ActionOutcomePlan,
): ActionOutcomePlan {
  const parsed = actionOutcomePlanSchema.parse(input);
  return {
    ...parsed,
    outcomes: [...parsed.outcomes].sort((left, right) =>
      left.outcomeId.localeCompare(right.outcomeId),
    ),
  };
}
