export type DomainFamily =
  | "paid_media"
  | "pricing"
  | "promotion"
  | "shipping"
  | "merchandising"
  | "inventory"
  | "cro"
  | "lifecycle";

export const DOMAIN_ELIGIBILITY_FACT_IDS = [
  "TARGET_ACTIVE", "CHANNEL_MERCHANT_ENABLED", "ACTION_FAMILY_CAPABILITY",
  "SUPPLIER_AVAILABLE", "WAREHOUSE_AVAILABLE", "SURFACE_AVAILABLE",
  "AUDIENCE_AVAILABLE", "CONSENT_AVAILABLE", "DISCOUNT_APPLICABLE",
  "FULFILLMENT_AVAILABLE", "GEOGRAPHY_ELIGIBLE", "CART_ELIGIBLE",
  "PROVIDER_CAPACITY_AVAILABLE", "SLOT_AVAILABLE", "PAGE_AVAILABLE",
  "DEVICE_APPLICABLE", "COMPONENT_AVAILABLE", "CHANNEL_AVAILABLE",
  "CONTACT_POLICY_ALLOWS", "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS",
  "LIFECYCLE_SUPPRESSION_RULE_CLEAR",
] as const;
export type DomainEligibilityFactId = (typeof DOMAIN_ELIGIBILITY_FACT_IDS)[number];

export interface DomainEligibilityRequirement {
  readonly factId: DomainEligibilityFactId;
  readonly suffix: string;
  readonly trueReason: string;
  readonly falseReason: string;
  readonly ruleRef?: string;
}

type Requirement = DomainEligibilityRequirement;
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
  "promotion.start": [{ factId: "DISCOUNT_APPLICABLE", suffix: "discount_applicable", trueReason: "DISCOUNT_APPLICABLE", falseReason: "DISCOUNT_NOT_APPLICABLE" }],
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function domainFamilyOfWhat(what: unknown): DomainFamily | undefined {
  if (!record(what)) return undefined;
  if (what["kind"] === "legacy_business") {
    const family = what["actionCategory"] === "advertising" ? "paid_media" : what["actionCategory"];
    return typeof family === "string" && family in registry ? family as DomainFamily : undefined;
  }
  return typeof what["actionType"] === "string" && what["actionType"].startsWith("lifecycle.") ? "lifecycle" : undefined;
}

export function domainEligibilityRequirementsForWhat(what: unknown): readonly DomainEligibilityRequirement[] {
  if (!record(what)) return [];
  const family = domainFamilyOfWhat(what);
  if (!family) return [];
  const actionType = typeof what["actionType"] === "string" ? what["actionType"] : undefined;
  const requirements = [...registry[family], ...(actionTypeRequirements[actionType ?? ""] ?? [])];
  if (actionType === "lifecycle.start_flow" && record(what["flow"]) && Array.isArray(what["flow"]["steps"])) {
    requirements.push({ factId: "AUDIENCE_AVAILABLE", suffix: "audience_available", trueReason: "AUDIENCE_AVAILABLE", falseReason: "AUDIENCE_UNAVAILABLE" });
    const firstStep = what["flow"]["steps"][0];
    if (record(firstStep)) {
      requirements.push({ factId: "CHANNEL_AVAILABLE", suffix: "channel_available", trueReason: "CHANNEL_AVAILABLE", falseReason: "CHANNEL_UNAVAILABLE" });
      if (Array.isArray(firstStep["eligibility"])) for (const ruleRef of firstStep["eligibility"])
        if (typeof ruleRef === "string") requirements.push({ factId: "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS", ruleRef, suffix: `eligibility_rule.${ruleRef}`, trueReason: "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS", falseReason: "LIFECYCLE_ELIGIBILITY_RULE_BLOCKS" });
      if (Array.isArray(firstStep["suppression"])) for (const ruleRef of firstStep["suppression"])
        if (typeof ruleRef === "string") requirements.push({ factId: "LIFECYCLE_SUPPRESSION_RULE_CLEAR", ruleRef, suffix: `suppression_rule.${ruleRef}`, trueReason: "LIFECYCLE_SUPPRESSION_RULE_CLEAR", falseReason: "LIFECYCLE_SUPPRESSION_RULE_BLOCKS" });
    }
  }
  return requirements;
}

export function expectedDomainEligibilityCheckIdsForWhat(what: unknown): readonly string[] {
  const family = domainFamilyOfWhat(what);
  if (!family) return [];
  return domainEligibilityRequirementsForWhat(what)
    .map((requirement) => `domain.${family}.${requirement.suffix}`)
    .sort();
}
