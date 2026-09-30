import { z } from "zod";
import { canonical, hash } from "./identity.js";
export const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,80}$`));
const provenance = z.array(id("evidence")).min(1);
const timestamp = z.string().datetime({ offset: true });
const fingerprint = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
export const membershipBindingSchema = z.enum([
  "DECISION_TIME",
  "EXECUTION_TIME",
  "SEND_TIME",
  "TRIGGER_TIME",
  "EFFECTIVE_TIME",
]);
export const membershipModeSchema = z.enum([
  "FROZEN_MEMBERSHIP",
  "DYNAMIC_MEMBERSHIP",
]);
const operator = z.enum(["EQ", "GT", "GTE", "LT", "LTE"]);
const windowSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LIFETIME") }).strict(),
  z
    .object({
      kind: z.literal("TRAILING_DAYS"),
      days: z.number().int().positive(),
    })
    .strict(),
]);
export type Window = z.infer<typeof windowSchema>;
export type Operator = z.infer<typeof operator>;
export type PopulationRule =
  | { kind: "COMPLETED_ORDER_COUNT"; operator: Operator; value: number }
  | {
      kind: "DAYS_SINCE_LAST_COMPLETED_ORDER";
      operator: Operator;
      value: number;
    }
  | {
      kind: "NET_REVENUE";
      operator: Operator;
      amount: number;
      currency: string;
      window: Window;
    }
  | { kind: "PURCHASED_PRODUCT"; productId: string; window: Window }
  | { kind: "OBSERVED_CART_ABANDONMENT"; window: Window }
  | { kind: "CONSENT"; channel: "EMAIL" | "SMS"; eligible: boolean }
  | {
      kind: "AND" | "OR" | "INTERSECTION" | "UNION";
      operands: PopulationRule[];
    }
  | { kind: "NOT"; operand: PopulationRule }
  | { kind: "DIFFERENCE"; left: PopulationRule; right: PopulationRule };
export const populationRuleSchema: z.ZodType<PopulationRule> = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal("COMPLETED_ORDER_COUNT"),
        operator,
        value: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("DAYS_SINCE_LAST_COMPLETED_ORDER"),
        operator,
        value: z.number().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("NET_REVENUE"),
        operator,
        amount: z.number().finite(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        window: windowSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("PURCHASED_PRODUCT"),
        productId: id("product"),
        window: windowSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("OBSERVED_CART_ABANDONMENT"),
        window: windowSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("CONSENT"),
        channel: z.enum(["EMAIL", "SMS"]),
        eligible: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.enum(["AND", "OR", "INTERSECTION", "UNION"]),
        operands: z.array(populationRuleSchema).min(1),
      })
      .strict(),
    z
      .object({ kind: z.literal("NOT"), operand: populationRuleSchema })
      .strict(),
    z
      .object({
        kind: z.literal("DIFFERENCE"),
        left: populationRuleSchema,
        right: populationRuleSchema,
      })
      .strict(),
  ]),
);
export const populationDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    populationId: id("population"),
    version: z.number().int().positive(),
    universe: z.enum([
      "ALL_CUSTOMERS",
      "KNOWN_CUSTOMERS",
      "MARKETING_CONTACTS",
      "PURCHASERS",
      "EMAIL_ELIGIBLE_CUSTOMERS",
      "SMS_ELIGIBLE_CUSTOMERS",
    ]),
    inclusion: populationRuleSchema,
    exclusions: z.array(populationRuleSchema),
    membershipMode: membershipModeSchema,
    binding: membershipBindingSchema,
    provenance,
  })
  .strict();
export type PopulationDefinition = z.infer<typeof populationDefinitionSchema>;
export const populationReferenceSchema = z
  .object({
    populationId: id("population"),
    version: z.number().int().positive(),
    definitionFingerprint: fingerprint,
    binding: membershipBindingSchema,
    membershipMode: membershipModeSchema,
    snapshotRef: id("snapshot").optional(),
  })
  .strict();
export type PopulationReference = z.infer<typeof populationReferenceSchema>;
export const customerSchema = z
  .object({
    customerId: id("customer"),
    known: z.boolean().optional(),
    marketingContact: z.boolean().optional(),
    completedOrderCount: z.number().int().nonnegative().optional(),
    lastCompletedOrderAt: timestamp.optional(),
    emailEligible: z.boolean().optional(),
    smsEligible: z.boolean().optional(),
    revenues: z
      .array(
        z
          .object({
            asOf: timestamp.optional(),
            amount: z.number().finite(),
            currency: z.string().regex(/^[A-Z]{3}$/),
            window: windowSchema,
          })
          .strict(),
      )
      .optional(),
    purchases: z
      .array(
        z.object({ productId: id("product"), completedAt: timestamp }).strict(),
      )
      .optional(),
    observedCartAbandonments: z.array(timestamp).optional(),
    purchaseEvidenceComplete: z.boolean().optional(),
    cartEvidenceComplete: z.boolean().optional(),
  })
  .strict();
export const populationContextSchema = z
  .object({ evaluatedAt: timestamp, customers: z.array(customerSchema) })
  .strict()
  .superRefine((x, c) => {
    if (
      new Set(x.customers.map((a) => a.customerId)).size !== x.customers.length
    )
      c.addIssue({ code: "custom", message: "Duplicate customer IDs" });
    for (const customer of x.customers) {
      const keys =
        customer.revenues?.map((r) =>
          canonical([r.currency, r.window, r.asOf === undefined ? null : Date.parse(r.asOf)]),
        ) ?? [];
      if (new Set(keys).size !== keys.length)
        c.addIssue({
          code: "custom",
          message: "Ambiguous duplicate revenue evidence",
        });
    }
  });
export type PopulationContext = z.infer<typeof populationContextSchema>;
export const membershipStatusSchema = z.enum([
  "ELIGIBLE",
  "INELIGIBLE",
  "UNKNOWN",
]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
const memberSchema = z
  .object({ customerId: id("customer"), status: membershipStatusSchema })
  .strict();
const evaluationBase = z
  .object({
    schemaVersion: z.literal(1),
    populationId: id("population"),
    version: z.number().int().positive(),
    definitionFingerprint: fingerprint,
    binding: membershipBindingSchema,
    membershipMode: membershipModeSchema,
    evaluatedAt: timestamp,
    members: z.array(memberSchema),
    eligibleCount: z.number().int().nonnegative(),
    ineligibleCount: z.number().int().nonnegative(),
    unknownCount: z.number().int().nonnegative(),
    evidenceCoverage: z.number().min(0).max(1),
    provenance,
    snapshotRef: id("snapshot").optional(),
  })
  .strict();
export const populationEvaluationSchema = evaluationBase.superRefine((x, c) => {
  const count = (s: MembershipStatus) =>
    x.members.filter((m) => m.status === s).length;
  if (
    count("ELIGIBLE") !== x.eligibleCount ||
    count("INELIGIBLE") !== x.ineligibleCount ||
    count("UNKNOWN") !== x.unknownCount ||
    new Set(x.members.map((m) => m.customerId)).size !== x.members.length ||
    x.evidenceCoverage !==
      (x.members.length
        ? (x.members.length - x.unknownCount) / x.members.length
        : 1)
  )
    c.addIssue({
      code: "custom",
      message: "Inconsistent membership counts or coverage",
    });
});
export type PopulationEvaluation = z.infer<typeof populationEvaluationSchema>;
const snapshotBase = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: id("snapshot"),
    populationId: id("population"),
    version: z.number().int().positive(),
    definitionFingerprint: fingerprint,
    binding: membershipBindingSchema,
    membershipMode: membershipModeSchema,
    evaluatedAt: timestamp,
    customerIds: z.array(id("customer")),
    unknownCustomerIds: z.array(id("customer")),
    provenance,
    snapshotFingerprint: fingerprint,
  })
  .strict();
export const populationSnapshotSchema = snapshotBase.superRefine((x, c) => {
  const { snapshotFingerprint, ...body } = x;
  const ids = [...x.customerIds, ...x.unknownCustomerIds];
  if (new Set(ids).size !== ids.length || hash(body) !== snapshotFingerprint)
    c.addIssue({
      code: "custom",
      message: "Invalid snapshot identity or fingerprint",
    });
});
export type PopulationSnapshot = z.infer<typeof populationSnapshotSchema>;
