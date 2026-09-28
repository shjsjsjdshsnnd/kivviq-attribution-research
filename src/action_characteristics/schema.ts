import { z } from "zod";

const stableReferenceSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const fingerprintSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
const reasonSchema = z.string().trim().min(1);

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  context: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const identity = key(value);
    if (seen.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate ${label}: ${identity}`,
      });
    }
    seen.add(identity);
  });
}

export function knownRangeUnknownOrNASchema<T extends z.ZodTypeAny>(
  valueSchema: T,
  sameRangeType?: (minimum: z.infer<T>, maximum: z.infer<T>) => boolean,
): z.ZodType<
  | { state: "KNOWN"; value: z.infer<T> }
  | { state: "RANGE"; minimum: z.infer<T>; maximum: z.infer<T> }
  | { state: "UNKNOWN"; reason: string }
  | { state: "NOT_APPLICABLE"; reason: string }
> {
  return z.union([
    z.object({ state: z.literal("KNOWN"), value: valueSchema }).strict(),
    z
      .object({
        state: z.literal("RANGE"),
        minimum: valueSchema,
        maximum: valueSchema,
      })
      .strict()
      .superRefine(({ minimum, maximum }, context) => {
        if (sameRangeType !== undefined && !sameRangeType(minimum, maximum)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Range endpoints must use the same type, unit, and resource",
          });
        }
      }),
    z.object({ state: z.literal("UNKNOWN"), reason: reasonSchema }).strict(),
    z.object({ state: z.literal("NOT_APPLICABLE"), reason: reasonSchema }).strict(),
  ]) as unknown as z.ZodType<
    | { state: "KNOWN"; value: z.infer<T> }
    | { state: "RANGE"; minimum: z.infer<T>; maximum: z.infer<T> }
    | { state: "UNKNOWN"; reason: string }
    | { state: "NOT_APPLICABLE"; reason: string }
  >;
}

export const moneyValueSchema = z
  .object({
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const moneyAmountSchema = knownRangeUnknownOrNASchema(
  moneyValueSchema,
  (minimum, maximum) =>
    minimum.currency === maximum.currency &&
    minimum.amountMinor <= maximum.amountMinor,
);

export const operationalUnitSchema = z.union([
  z.enum(["minutes", "hours", "units", "orders", "messages", "placements"]),
  z
    .object({
      registryRef: stableReferenceSchema,
      code: stableReferenceSchema,
      version: versionSchema,
    })
    .strict(),
]);

export const operationalResourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STAFF"), resourceRef: stableReferenceSchema }).strict(),
  z.object({ kind: z.literal("WAREHOUSE"), resourceRef: stableReferenceSchema }).strict(),
  z.object({ kind: z.literal("FULFILLMENT"), resourceRef: stableReferenceSchema }).strict(),
  z.object({ kind: z.literal("CHANNEL"), resourceRef: stableReferenceSchema }).strict(),
  z.object({ kind: z.literal("PLACEMENT"), resourceRef: stableReferenceSchema }).strict(),
  z
    .object({
      kind: z.literal("CUSTOM"),
      registryRef: stableReferenceSchema,
      code: stableReferenceSchema,
      version: versionSchema,
    })
    .strict(),
]);

export const operationalQuantityValueSchema = z
  .object({
    quantity: z.number().finite().nonnegative(),
    unit: operationalUnitSchema,
    resource: operationalResourceSchema,
  })
  .strict();

function stableShape(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableShape).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${key}:${stableShape(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const operationalQuantitySchema = knownRangeUnknownOrNASchema(
  operationalQuantityValueSchema,
  (minimum, maximum) =>
    stableShape(minimum.unit) === stableShape(maximum.unit) &&
    stableShape(minimum.resource) === stableShape(maximum.resource) &&
    minimum.quantity <= maximum.quantity,
);

export const reversalReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ACTION"),
      actionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
      actionFingerprint: fingerprintSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("REGISTERED"),
      registryRef: stableReferenceSchema,
      code: stableReferenceSchema,
      version: versionSchema,
    })
    .strict(),
]);

export const irreversibleEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MESSAGE_DELIVERED"), channelRef: stableReferenceSchema }).strict(),
  z
    .object({
      kind: z.literal("INVENTORY_COMMITTED"),
      resourceRef: stableReferenceSchema,
      unit: stableReferenceSchema,
    })
    .strict(),
  z.object({ kind: z.literal("CUSTOMER_EXPOSED"), populationRef: stableReferenceSchema }).strict(),
  z
    .object({
      kind: z.literal("EXTERNAL_COMMITMENT"),
      contractRef: stableReferenceSchema,
      contractVersion: versionSchema,
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

const irreversibleEffectsSchema = z
  .array(irreversibleEffectSchema)
  .min(1)
  .superRefine((effects, context) =>
    uniqueBy(effects, stableShape, context, "irreversible effect"),
  );

export const reversibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FULLY_REVERSIBLE"), reversal: reversalReferenceSchema }).strict(),
  z
    .object({
      kind: z.literal("PARTIALLY_REVERSIBLE"),
      irreversibleEffects: irreversibleEffectsSchema,
      reversal: reversalReferenceSchema,
    })
    .strict(),
  z.object({ kind: z.literal("IRREVERSIBLE"), irreversibleEffects: irreversibleEffectsSchema }).strict(),
  z.object({ kind: z.literal("UNKNOWN"), reason: reasonSchema }).strict(),
  z.object({ kind: z.literal("NOT_APPLICABLE"), reason: reasonSchema }).strict(),
]);

export const costLineItemSchema = z
  .object({
    lineItemId: stableReferenceSchema,
    category: z.enum([
      "MEDIA",
      "LABOR",
      "PLATFORM",
      "PROCUREMENT",
      "FULFILLMENT",
      "CANCELLATION",
      "OTHER",
    ]),
    amount: moneyAmountSchema,
  })
  .strict();

const costLineItemsSchema = z
  .array(costLineItemSchema)
  .superRefine((items, context) =>
    uniqueBy(items, ({ lineItemId }) => lineItemId, context, "cost line-item ID"),
  );

export const cancellationStageSchema = z.enum([
  "BEFORE_START",
  "IMPLEMENTING",
  "EFFECTIVE",
  "COMPLETED",
]);

export const stageCancellationCostSchema = z
  .object({
    stage: cancellationStageSchema,
    cancellationAvailable: z.boolean(),
    cancellationCost: costLineItemsSchema,
    compensationCost: costLineItemsSchema,
    operationalBurden: z.array(operationalQuantitySchema),
  })
  .strict()
  .superRefine((stage, context) => {
    if (!stage.cancellationAvailable && stage.cancellationCost.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cancellationCost"],
        message: "Cancellation cost is invalid when cancellation is unavailable",
      });
    }
    if (stage.cancellationAvailable && stage.compensationCost.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compensationCost"],
        message: "Compensation cost applies only after cancellation is unavailable",
      });
    }
  });

const forbiddenDefinitionKey = /^(?:delay|leadtime|implementationdelay|implementationdelayseconds|implementationseconds|implementationtime|sourceref|sourcerefs|evidenceref|evidencerefs|provenance)$/i;

function findForbiddenDefinitionKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenDefinitionKey(entry);
      if (found !== undefined) return found;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenDefinitionKey.test(key)) return key;
      const found = findForbiddenDefinitionKey(nested);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const actionCharacteristicsObjectSchema = z
  .object({
    implementationCost: costLineItemsSchema,
    reversibility: reversibilitySchema,
    cancellationCosts: z.array(stageCancellationCostSchema),
    operationalBurden: z.array(operationalQuantitySchema),
  })
  .strict();

export const actionCharacteristicsSchema = actionCharacteristicsObjectSchema.superRefine(
  (characteristics, context) => {
    uniqueBy(
      characteristics.cancellationCosts,
      ({ stage }) => stage,
      context,
      "cancellation stage",
    );
    const forbidden = findForbiddenDefinitionKey(characteristics);
    if (forbidden !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Runtime evidence or implementation-delay field is forbidden: ${forbidden}`,
      });
    }
  },
);

export const stageReachabilityInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INSTANTANEOUS_SEND") }).strict(),
  z
    .object({
      kind: z.literal("PERSISTENT_POLICY"),
      hasExplicitCompletion: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("TEMPORARY_PRICE"),
      implementationPrecedesEffect: z.literal(true),
      hasFiniteCompletion: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("COMMITTED_INVENTORY_PURCHASE"),
      commitmentOccursDuringImplementation: z.literal(true),
      hasCompletion: z.boolean(),
    })
    .strict(),
]);

export type CancellationStage = z.infer<typeof cancellationStageSchema>;
export type StageReachabilityInput = z.infer<typeof stageReachabilityInputSchema>;

export function deriveReachableCancellationStages(
  input: StageReachabilityInput,
): readonly CancellationStage[] {
  const parsed = stageReachabilityInputSchema.parse(input);
  switch (parsed.kind) {
    case "INSTANTANEOUS_SEND":
      return ["BEFORE_START", "EFFECTIVE", "COMPLETED"];
    case "PERSISTENT_POLICY":
      return parsed.hasExplicitCompletion
        ? ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE", "COMPLETED"]
        : ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE"];
    case "TEMPORARY_PRICE":
      return ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE", "COMPLETED"];
    case "COMMITTED_INVENTORY_PURCHASE":
      return parsed.hasCompletion
        ? ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE", "COMPLETED"]
        : ["BEFORE_START", "IMPLEMENTING", "EFFECTIVE"];
  }
}

export type ActionCharacteristics = z.infer<typeof actionCharacteristicsSchema>;

export function assertReachableCancellationStages(
  input: StageReachabilityInput,
  characteristics: ActionCharacteristics,
): void {
  const parsed = actionCharacteristicsSchema.parse(characteristics);
  const expected = [...deriveReachableCancellationStages(input)].sort();
  const actual = parsed.cancellationCosts.map(({ stage }) => stage).sort();
  if (stableShape(expected) !== stableShape(actual)) {
    throw new Error(
      `Cancellation costs must describe exactly the reachable stages: ${expected.join(", ")}`,
    );
  }
  for (const stage of parsed.cancellationCosts) {
    const expectedAvailability =
      stage.stage === "BEFORE_START" || stage.stage === "IMPLEMENTING";
    if (stage.cancellationAvailable !== expectedAvailability) {
      throw new Error(
        `Cancellation availability contradicts ${input.kind} stage ${stage.stage}`,
      );
    }
  }
}

export type CostLineItem = z.infer<typeof costLineItemSchema>;
export type IrreversibleEffect = z.infer<typeof irreversibleEffectSchema>;
export type MoneyValue = z.infer<typeof moneyValueSchema>;
export type OperationalQuantity = z.infer<typeof operationalQuantityValueSchema>;
export type ReversalReference = z.infer<typeof reversalReferenceSchema>;
export type Reversibility = z.infer<typeof reversibilitySchema>;
export type StageCancellationCost = z.infer<typeof stageCancellationCostSchema>;
