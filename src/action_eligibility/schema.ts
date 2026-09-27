import { z } from "zod";

const refSchema = z.string().min(1);
const utcZSchema = z.string().datetime().regex(/Z$/);

export const eligibilityCheckSchema = z
  .object({
    kind: z.enum(["PRECONDITION", "HARD_CONSTRAINT", "DOMAIN_RULE"]),
    checkId: refSchema,
    status: z.enum(["SATISFIED", "VIOLATED", "UNKNOWN"]),
    reasonCodes: z.array(refSchema).min(1).superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          context.addIssue({ code: "custom", path: [index], message: "Duplicate reason code" });
        seen.add(value);
      });
    }),
    evidenceRefs: z.array(refSchema).superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          context.addIssue({ code: "custom", path: [index], message: "Duplicate evidence reference" });
        seen.add(value);
      });
    }),
    missingInformation: z.array(refSchema).superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          context.addIssue({ code: "custom", path: [index], message: "Duplicate missing-information entry" });
        seen.add(value);
      });
    }),
  })
  .strict();

export const actionEligibilitySchema = z
  .object({
    actionId: refSchema,
    actionFingerprint: refSchema,
    evaluatedAt: utcZSchema,
    status: z.enum(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]),
    checks: z.array(eligibilityCheckSchema),
  })
  .strict();

export const eligibilityFailureSchema = z
  .object({
    code: z.enum(["INVALID_ACTION", "UNSUPPORTED_ACTION_FAMILY", "INVALID_CONTEXT", "INVALID_NATIVE_CONSTRAINTS"]),
    messages: z.array(z.string()),
  })
  .strict();

export type EligibilityCheck = z.infer<typeof eligibilityCheckSchema>;
export type ActionEligibility = z.infer<typeof actionEligibilitySchema>;
export type EligibilityFailure = z.infer<typeof eligibilityFailureSchema>;
