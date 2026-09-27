import { z } from "zod";
import type { CanonicalAction } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { EligibilityCheck } from "./schema.js";
import { lifecycleWhatSchema } from "../lifecycle/canonical.js";

const ref = z.string().min(1);
const utcZ = z.string().datetime().regex(/Z$/);

export const domainFactIdSchema = z.enum([
  "TARGET_ACTIVE",
  "CHANNEL_MERCHANT_ENABLED",
  "ACTION_FAMILY_CAPABILITY",
  "SUPPLIER_AVAILABLE",
  "WAREHOUSE_AVAILABLE",
  "SURFACE_AVAILABLE",
  "AUDIENCE_AVAILABLE",
  "CONSENT_AVAILABLE",
  "DISCOUNT_APPLICABLE",
  "FULFILLMENT_AVAILABLE",
  "GEOGRAPHY_ELIGIBLE",
  "CART_ELIGIBLE",
  "PROVIDER_CAPACITY_AVAILABLE",
  "SLOT_AVAILABLE",
  "PAGE_AVAILABLE",
  "DEVICE_APPLICABLE",
  "COMPONENT_AVAILABLE",
  "CHANNEL_AVAILABLE",
  "CONTACT_POLICY_ALLOWS",
]);

export const domainEligibilityFactSchema = z.object({
  kind: z.literal("DOMAIN_FACT"),
  factId: domainFactIdSchema,
  value: z.boolean(),
  evidenceRef: ref,
  actionId: ref,
  actionFingerprint: ref,
  targetRef: z.string().regex(/^eligibility-target:fnv1a64:[0-9a-f]{16}$/),
  evaluationBoundary: z.enum(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"]),
  observedAt: utcZ,
  sourceRef: ref,
  provenance: z.array(ref).min(1),
}).strict();

export type DomainEligibilityFact = z.infer<typeof domainEligibilityFactSchema>;

type DomainFamily = "paid_media" | "pricing" | "promotion" | "shipping" | "merchandising" | "inventory" | "cro" | "lifecycle";
type Requirement = Readonly<{ factId: DomainEligibilityFact["factId"]; suffix: string; trueReason: string; falseReason: string }>;

const capability = (family: DomainFamily): Requirement => ({
  factId: "ACTION_FAMILY_CAPABILITY",
  suffix: "capability",
  trueReason: "ACTION_FAMILY_CAPABILITY_AVAILABLE",
  falseReason: "ACTION_FAMILY_CAPABILITY_UNAVAILABLE",
});
const targetActive: Requirement = { factId: "TARGET_ACTIVE", suffix: "target_active", trueReason: "TARGET_ACTIVE", falseReason: "TARGET_INACTIVE" };

const registry: Readonly<Record<DomainFamily, readonly Requirement[]>> = Object.freeze({
  paid_media: [capability("paid_media"), { factId: "CHANNEL_MERCHANT_ENABLED", suffix: "channel_enabled", trueReason: "CHANNEL_MERCHANT_ENABLED", falseReason: "CHANNEL_NOT_MERCHANT_ENABLED" }],
  pricing: [capability("pricing"), targetActive],
  promotion: [capability("promotion"), targetActive],
  shipping: [capability("shipping")],
  merchandising: [capability("merchandising"), targetActive],
  inventory: [capability("inventory"), targetActive],
  cro: [capability("cro")],
  lifecycle: [capability("lifecycle")],
});

const actionTypeRequirements: Readonly<Record<string, readonly Requirement[]>> = Object.freeze({
  "inventory.reorder": [
    { factId: "SUPPLIER_AVAILABLE", suffix: "supplier_available", trueReason: "SUPPLIER_AVAILABLE", falseReason: "SUPPLIER_UNAVAILABLE" },
    { factId: "WAREHOUSE_AVAILABLE", suffix: "warehouse_available", trueReason: "WAREHOUSE_AVAILABLE", falseReason: "WAREHOUSE_UNAVAILABLE" },
  ],
  "promotion.start": [
    { factId: "DISCOUNT_APPLICABLE", suffix: "discount_applicable", trueReason: "DISCOUNT_APPLICABLE", falseReason: "DISCOUNT_NOT_APPLICABLE" },
  ],
  "shipping.set_offer": [
    { factId: "FULFILLMENT_AVAILABLE", suffix: "fulfillment_available", trueReason: "FULFILLMENT_AVAILABLE", falseReason: "FULFILLMENT_UNAVAILABLE" },
    { factId: "GEOGRAPHY_ELIGIBLE", suffix: "geography_eligible", trueReason: "GEOGRAPHY_ELIGIBLE", falseReason: "GEOGRAPHY_INELIGIBLE" },
    { factId: "CART_ELIGIBLE", suffix: "cart_eligible", trueReason: "CART_ELIGIBLE", falseReason: "CART_INELIGIBLE" },
    { factId: "PROVIDER_CAPACITY_AVAILABLE", suffix: "provider_capacity", trueReason: "PROVIDER_CAPACITY_AVAILABLE", falseReason: "PROVIDER_CAPACITY_UNAVAILABLE" },
  ],
  "merchandising.feature": [
    { factId: "SURFACE_AVAILABLE", suffix: "surface_available", trueReason: "SURFACE_AVAILABLE", falseReason: "SURFACE_UNAVAILABLE" },
    { factId: "SLOT_AVAILABLE", suffix: "slot_available", trueReason: "SLOT_AVAILABLE", falseReason: "SLOT_UNAVAILABLE" },
  ],
  "cro.modify_experience": [
    { factId: "PAGE_AVAILABLE", suffix: "page_available", trueReason: "PAGE_AVAILABLE", falseReason: "PAGE_UNAVAILABLE" },
    { factId: "DEVICE_APPLICABLE", suffix: "device_applicable", trueReason: "DEVICE_APPLICABLE", falseReason: "DEVICE_NOT_APPLICABLE" },
    { factId: "COMPONENT_AVAILABLE", suffix: "component_available", trueReason: "COMPONENT_AVAILABLE", falseReason: "COMPONENT_UNAVAILABLE" },
  ],
  "lifecycle.send": [
    { factId: "AUDIENCE_AVAILABLE", suffix: "audience_available", trueReason: "AUDIENCE_AVAILABLE", falseReason: "AUDIENCE_UNAVAILABLE" },
    { factId: "CONSENT_AVAILABLE", suffix: "consent_available", trueReason: "CONSENT_AVAILABLE", falseReason: "CONSENT_UNAVAILABLE" },
    { factId: "CHANNEL_AVAILABLE", suffix: "channel_available", trueReason: "CHANNEL_AVAILABLE", falseReason: "CHANNEL_UNAVAILABLE" },
    { factId: "CONTACT_POLICY_ALLOWS", suffix: "contact_policy", trueReason: "CONTACT_POLICY_ALLOWS", falseReason: "CONTACT_POLICY_BLOCKS" },
  ],
});

function actionTypeOf(action: CanonicalAction): string | undefined {
  if ("kind" in action.what && action.what.kind === "legacy_business") return action.what.actionType;
  if ("actionType" in action.what && typeof action.what.actionType === "string") return action.what.actionType;
  return undefined;
}

function familyOf(action: CanonicalAction): DomainFamily | undefined {
  if ("kind" in action.what && action.what.kind === "legacy_business") {
    const family = action.what.actionCategory;
    if (family === "advertising") return "paid_media";
    return family in registry ? family as DomainFamily : undefined;
  }
  if ("actionType" in action.what && typeof action.what.actionType === "string" && action.what.actionType.startsWith("lifecycle.")) return "lifecycle";
  return undefined;
}

function unknown(checkId: string, reasonCodes: string[], evidenceRefs: string[] = []): EligibilityCheck {
  return { kind: "DOMAIN_RULE", checkId, status: "UNKNOWN", reasonCodes, evidenceRefs, missingInformation: [`domain_fact:${checkId}`] };
}

export function evaluateDomainEligibility(input: {
  action: CanonicalAction;
  targetRef: string;
  evaluatedAt: string;
  evaluationBoundary: DomainEligibilityFact["evaluationBoundary"];
  maximumAgeSeconds?: number;
  facts: readonly DomainEligibilityFact[];
}): EligibilityCheck[] {
  const family = familyOf(input.action);
  if (!family) return [];
  const fingerprint = fingerprintCanonicalAction(input.action);
  const bound = input.facts.filter((fact) => fact.actionId === input.action.actionId && fact.actionFingerprint === fingerprint && fact.targetRef === input.targetRef && fact.evaluationBoundary === input.evaluationBoundary);
  const actionType = actionTypeOf(input.action);
  const requirements = [...registry[family], ...(actionTypeRequirements[actionType ?? ""] ?? [])];
  const lifecycle = lifecycleWhatSchema.safeParse(input.action.what);
  if (actionType === "lifecycle.start_flow" && lifecycle.success && lifecycle.data.actionType === "lifecycle.start_flow") {
    const firstStep = lifecycle.data.flow.steps[0];
    requirements.push({ factId: "AUDIENCE_AVAILABLE", suffix: "audience_available", trueReason: "AUDIENCE_AVAILABLE", falseReason: "AUDIENCE_UNAVAILABLE" });
    if (firstStep?.eligibility.includes("consent")) requirements.push({ factId: "CONSENT_AVAILABLE", suffix: "consent_available", trueReason: "CONSENT_AVAILABLE", falseReason: "CONSENT_UNAVAILABLE" });
    if (firstStep?.eligibility.includes("valid_destination")) requirements.push({ factId: "CHANNEL_AVAILABLE", suffix: "channel_available", trueReason: "CHANNEL_AVAILABLE", falseReason: "CHANNEL_UNAVAILABLE" });
    if (firstStep?.suppression.some((entry) => entry.includes("contact"))) requirements.push({ factId: "CONTACT_POLICY_ALLOWS", suffix: "contact_policy", trueReason: "CONTACT_POLICY_ALLOWS", falseReason: "CONTACT_POLICY_BLOCKS" });
  }
  return requirements.map((requirement): EligibilityCheck => {
    const checkId = `domain.${family}.${requirement.suffix}`;
    const matches = bound.filter((fact) => fact.factId === requirement.factId);
    if (matches.length === 0) return unknown(checkId, ["MISSING_BOUND_DOMAIN_FACT"]);
    if (matches.length > 1) return unknown(checkId, ["AMBIGUOUS_BOUND_DOMAIN_FACT"], matches.map((fact) => fact.evidenceRef).sort());
    const fact = matches[0]!;
    const observed = Date.parse(fact.observedAt);
    const evaluated = Date.parse(input.evaluatedAt);
    if (observed > evaluated) return unknown(checkId, ["FUTURE_DOMAIN_FACT"], [fact.evidenceRef]);
    if (input.maximumAgeSeconds !== undefined && evaluated - observed > input.maximumAgeSeconds * 1000)
      return unknown(checkId, ["STALE_DOMAIN_FACT"], [fact.evidenceRef]);
    return {
      kind: "DOMAIN_RULE",
      checkId,
      status: fact.value ? "SATISFIED" : "VIOLATED",
      reasonCodes: [fact.value ? requirement.trueReason : requirement.falseReason],
      evidenceRefs: [fact.evidenceRef],
      missingInformation: [],
    };
  }).sort((left, right) => left.checkId.localeCompare(right.checkId));
}
