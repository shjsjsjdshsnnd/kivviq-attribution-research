import { adaptLegacyAction } from "../canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import { googleBudgetUp2000, metaBudgetDown2000 } from "../action_translation/fixtures.js";
import { reorderSkuA100, reorderSkuB50SupplierX } from "../inventory/fixtures.js";
import { canonicalEligibilityTargetRef } from "./evaluate.js";
import type { DomainEligibilityFact } from "./adapters.js";
import { canonicalActionSchema, type CanonicalAction } from "../canonical_action/schema.js";
import type { HardConstraint, ConstraintThreshold } from "../action_constraints/schema.js";
import type { ConstraintEvidenceReceipt } from "../action_constraints/assessment.js";
import { startAutomaticCollectionX15FourDays, stopCollectionXAutomatic15 } from "../promotion/fixtures.js";
import { freeStandardShippingAllOrders, permanentThreshold150To125 } from "../shipping/fixtures.js";
import { featureProductAHomepage, deprioritizeProductBCollectionY } from "../merchandising/fixtures.js";
import { modifyHomepageHeroPresentation, addFeaturedCollectionHomepage } from "../cro/fixtures.js";
import { setSkuA849Cad } from "../pricing/fixtures.js";
import { createCanonicalFixtures } from "../canonical_action/fixtures.js";
import { lifecycleWhatSchema } from "../lifecycle/canonical.js";

export const DOMAIN_FIXTURE_TIME = "2026-09-27T12:00:00.000Z";
export const inventoryIncreaseSkuA = adaptLegacyAction(reorderSkuA100);
export const inventoryIncreaseSkuB = adaptLegacyAction(reorderSkuB50SupplierX);
export const metaPaidMediaAction = adaptLegacyAction(metaBudgetDown2000);
export const googlePaidMediaAction = adaptLegacyAction(googleBudgetUp2000);

export function domainFactFixture(
  action: CanonicalAction,
  factId: DomainEligibilityFact["factId"],
  value: boolean,
  suffix = "current",
): DomainEligibilityFact {
  return {
    kind: "DOMAIN_FACT",
    factId,
    value,
    evidenceRef: `domain-evidence:${factId.toLowerCase()}:${suffix}`,
    actionId: action.actionId,
    actionFingerprint: fingerprintCanonicalAction(action),
    targetRef: canonicalEligibilityTargetRef(action),
    evaluationBoundary: "DECISION_TIME",
    observedAt: DOMAIN_FIXTURE_TIME,
    sourceRef: "merchant-state:v1",
    provenance: ["merchant-snapshot:2026-09-27"],
  };
}

export const discontinuedInventoryProductFacts = [
  domainFactFixture(inventoryIncreaseSkuA, "ACTION_FAMILY_CAPABILITY", true),
  domainFactFixture(inventoryIncreaseSkuA, "SUPPLIER_AVAILABLE", true),
  domainFactFixture(inventoryIncreaseSkuA, "TARGET_ACTIVE", false),
  domainFactFixture(inventoryIncreaseSkuA, "WAREHOUSE_AVAILABLE", true),
] as const;

export const activeInventoryProductFacts = discontinuedInventoryProductFacts.map((fact) =>
  fact.factId === "TARGET_ACTIVE" ? { ...fact, value: true, evidenceRef: "domain-evidence:target_active:active" } : fact,
);

export const inventoryAvailabilityScenarios = [
  {
    action: inventoryIncreaseSkuA,
    factId: "SUPPLIER_AVAILABLE" as const,
    checkId: "domain.inventory.supplier_available",
    reasonCode: "SUPPLIER_UNAVAILABLE",
    facts: activeInventoryProductFacts.map((fact) =>
      fact.factId === "SUPPLIER_AVAILABLE"
        ? { ...fact, value: false, evidenceRef: "domain-evidence:supplier_available:unavailable" }
        : fact,
    ),
  },
  {
    action: inventoryIncreaseSkuA,
    factId: "WAREHOUSE_AVAILABLE" as const,
    checkId: "domain.inventory.warehouse_available",
    reasonCode: "WAREHOUSE_UNAVAILABLE",
    facts: activeInventoryProductFacts.map((fact) =>
      fact.factId === "WAREHOUSE_AVAILABLE"
        ? { ...fact, value: false, evidenceRef: "domain-evidence:warehouse_available:unavailable" }
        : fact,
    ),
  },
] as const;

export const unusedMetaChannelFacts = [
  domainFactFixture(metaPaidMediaAction, "ACTION_FAMILY_CAPABILITY", true),
  domainFactFixture(metaPaidMediaAction, "CHANNEL_MERCHANT_ENABLED", false),
] as const;

function facts(action: CanonicalAction, factIds: readonly DomainEligibilityFact["factId"][]): DomainEligibilityFact[] {
  return factIds.map((factId) => domainFactFixture(action, factId, true, action.actionId));
}

function lifecycleRuleFact(action: CanonicalAction, factId: "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS" | "LIFECYCLE_SUPPRESSION_RULE_CLEAR", ruleRef: string): DomainEligibilityFact {
  return { ...domainFactFixture(action, factId, true, ruleRef), ruleRef };
}

const promotionAction = adaptLegacyAction(startAutomaticCollectionX15FourDays);
const shippingAction = adaptLegacyAction(freeStandardShippingAllOrders);
const merchandisingAction = adaptLegacyAction(featureProductAHomepage);
const croAction = adaptLegacyAction(modifyHomepageHeroPresentation);
const lifecycleAction = createCanonicalFixtures().find((fixture) => fixture.number === 1)?.action;
if (!lifecycleAction) throw new Error("Missing canonical lifecycle fixture");
const lifecycleFlowAction = createCanonicalFixtures().find((fixture) => fixture.number === 6)?.action;
if (!lifecycleFlowAction) throw new Error("Missing canonical lifecycle flow fixture");
const lifecycleFlowWhat = lifecycleWhatSchema.parse(lifecycleFlowAction.what);
if (lifecycleFlowWhat.actionType !== "lifecycle.start_flow") throw new Error("Expected lifecycle flow fixture");
export const arbitraryLifecycleRuleAction = canonicalActionSchema.parse({
  ...lifecycleFlowAction,
  actionId: "action_lifecycle_arbitrary_rule_refs",
  what: {
    ...lifecycleFlowWhat,
    flow: {
      ...lifecycleFlowWhat.flow,
      steps: lifecycleFlowWhat.flow.steps.map((step, index) => index === 0 ? { ...step, eligibility: ["blocked"], suppression: ["contactless_delivery"] } : step),
    },
  },
});

export const domainAdapterScenarios = [
  {
    family: "promotion",
    action: promotionAction,
    representativeFactId: "DISCOUNT_APPLICABLE" as const,
    facts: facts(promotionAction, ["ACTION_FAMILY_CAPABILITY", "TARGET_ACTIVE", "DISCOUNT_APPLICABLE"]),
  },
  {
    family: "shipping",
    action: shippingAction,
    representativeFactId: "GEOGRAPHY_ELIGIBLE" as const,
    facts: facts(shippingAction, ["ACTION_FAMILY_CAPABILITY", "FULFILLMENT_AVAILABLE", "GEOGRAPHY_ELIGIBLE", "CART_ELIGIBLE", "PROVIDER_CAPACITY_AVAILABLE"]),
  },
  {
    family: "merchandising",
    action: merchandisingAction,
    representativeFactId: "SLOT_AVAILABLE" as const,
    facts: facts(merchandisingAction, ["ACTION_FAMILY_CAPABILITY", "TARGET_ACTIVE", "SURFACE_AVAILABLE", "SLOT_AVAILABLE"]),
  },
  {
    family: "cro",
    action: croAction,
    representativeFactId: "COMPONENT_AVAILABLE" as const,
    facts: facts(croAction, ["ACTION_FAMILY_CAPABILITY", "PAGE_AVAILABLE", "DEVICE_APPLICABLE", "COMPONENT_AVAILABLE"]),
  },
  {
    family: "lifecycle",
    action: lifecycleAction,
    representativeFactId: "CONSENT_AVAILABLE" as const,
    facts: facts(lifecycleAction, ["ACTION_FAMILY_CAPABILITY", "AUDIENCE_AVAILABLE", "CONSENT_AVAILABLE", "CHANNEL_AVAILABLE", "CONTACT_POLICY_ALLOWS"]),
  },
  {
    family: "lifecycle_flow",
    action: lifecycleFlowAction,
    representativeFactId: "CHANNEL_AVAILABLE" as const,
    facts: [
      ...facts(lifecycleFlowAction, ["ACTION_FAMILY_CAPABILITY", "AUDIENCE_AVAILABLE", "CHANNEL_AVAILABLE"]),
      lifecycleRuleFact(lifecycleFlowAction, "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS", "consent"),
      lifecycleRuleFact(lifecycleFlowAction, "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS", "valid_destination"),
      lifecycleRuleFact(lifecycleFlowAction, "LIFECYCLE_SUPPRESSION_RULE_CLEAR", "channel_suppressed"),
      lifecycleRuleFact(lifecycleFlowAction, "LIFECYCLE_SUPPRESSION_RULE_CLEAR", "contact_cap_reached"),
    ],
  },
] as const;

export const arbitraryLifecycleRuleFacts = [
  ...facts(arbitraryLifecycleRuleAction, ["ACTION_FAMILY_CAPABILITY", "AUDIENCE_AVAILABLE", "CHANNEL_AVAILABLE"]),
  lifecycleRuleFact(arbitraryLifecycleRuleAction, "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS", "blocked"),
  lifecycleRuleFact(arbitraryLifecycleRuleAction, "LIFECYCLE_SUPPRESSION_RULE_CLEAR", "contactless_delivery"),
] as const;

const stoppedPromotion = adaptLegacyAction(stopCollectionXAutomatic15);
const adjustedShippingPolicy = adaptLegacyAction(permanentThreshold150To125);
const deprioritizedMerchandising = adaptLegacyAction(deprioritizeProductBCollectionY);
const addedCroElement = adaptLegacyAction(addFeaturedCollectionHomepage);
export const actionTypeIsolationScenarios = [
  { action: stoppedPromotion, facts: facts(stoppedPromotion, ["ACTION_FAMILY_CAPABILITY", "TARGET_ACTIVE"]), excludedFactId: "DISCOUNT_APPLICABLE" },
  { action: adjustedShippingPolicy, facts: facts(adjustedShippingPolicy, ["ACTION_FAMILY_CAPABILITY"]), excludedFactId: "CART_ELIGIBLE" },
  { action: deprioritizedMerchandising, facts: facts(deprioritizedMerchandising, ["ACTION_FAMILY_CAPABILITY", "TARGET_ACTIVE"]), excludedFactId: "SLOT_AVAILABLE" },
  { action: addedCroElement, facts: facts(addedCroElement, ["ACTION_FAMILY_CAPABILITY"]), excludedFactId: "DEVICE_APPLICABLE" },
] as const;

const constraintAction = adaptLegacyAction(setSkuA849Cad);
const constraintDomainFacts = facts(constraintAction, ["ACTION_FAMILY_CAPABILITY", "TARGET_ACTIVE"]);
const constraintTarget = { kind: "SKU" as const, ref: "sku:A" };
const rule = {
  registryRef: "merchant.rules",
  ruleId: "eligibility.rule",
  version: "v1",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

function hardScenario(
  constraint: HardConstraint,
  receiptFact: ConstraintEvidenceReceipt["fact"],
  resourceRequirements: readonly { resourceRequirementId: string; value: ConstraintThreshold }[] = [],
) {
  const action = canonicalActionSchema.parse({ ...constraintAction, constraints: [constraint] });
  const fingerprint = fingerprintCanonicalAction(action);
  const receipt: ConstraintEvidenceReceipt = {
    evidenceRef: `evidence.${constraint.constraintId}`,
    actionId: action.actionId,
    actionFingerprint: fingerprint,
    constraintId: constraint.constraintId,
    target: constraint.target,
    evaluationBoundary: constraint.evaluationBoundary,
    observedAt: DOMAIN_FIXTURE_TIME,
    sourceRef: "merchant.snapshot",
    provenance: ["merchant-snapshot:2026-09-27"],
    fact: receiptFact,
  } as ConstraintEvidenceReceipt;
  return {
    kind: constraint.kind,
    action,
    nativeConstraints: { constraints: [constraint], resourceRequirements: [...resourceRequirements] },
    domainFacts: facts(action, ["ACTION_FAMILY_CAPABILITY", "TARGET_ACTIVE"]),
    receipts: [receipt],
  };
}

const common = { evaluationBoundary: "DECISION_TIME" as const, whenUnknown: "UNKNOWN" as const };
const money = (amountMinor: number) => ({ valueType: "MONEY" as const, amountMinor, currency: "CAD" });
const percentage = (basisPoints: number) => ({ valueType: "PERCENTAGE" as const, basisPoints });
const quantity = (value: number, unit: string) => ({ valueType: "QUANTITY" as const, value, unit });
const valueFact = (ref: string, value: ConstraintThreshold, valueBasis?: "CURRENT_STATE" | "PROJECTED_AFTER_ACTION") => ({
  kind: "VALUE" as const,
  valueRef: { kind: "FACT" as const, ref },
  ...(valueBasis ? { valueBasis } : {}),
  value,
});

export const hardConstraintEligibilityScenarios = [
  hardScenario({ ...common, constraintId: "price.floor", kind: "PRICE_FLOOR", target: constraintTarget, valueBasis: "PROJECTED_AFTER_ACTION", comparator: "GTE", threshold: money(8_000), observedValue: { kind: "FACT", ref: "resulting.price" } }, valueFact("resulting.price", money(7_999), "PROJECTED_AFTER_ACTION")),
  hardScenario({ ...common, constraintId: "margin.minimum", kind: "MINIMUM_MARGIN", target: constraintTarget, valueBasis: "PROJECTED_AFTER_ACTION", comparator: "GTE", threshold: percentage(3_000), observedValue: { kind: "FACT", ref: "resulting.gross_margin" } }, valueFact("resulting.gross_margin", percentage(2_999), "PROJECTED_AFTER_ACTION")),
  hardScenario({ ...common, constraintId: "inventory.available", kind: "INVENTORY_AVAILABILITY", target: constraintTarget, resourceRequirementId: "inventory.required", availableValue: { kind: "FACT", ref: "inventory.available" } }, valueFact("inventory.available", quantity(9, "units")), [{ resourceRequirementId: "inventory.required", value: quantity(10, "units") }]),
  hardScenario({ ...common, constraintId: "budget.available", kind: "AVAILABLE_BUDGET", target: { kind: "FAMILY", family: "PRICING" }, resourceRequirementId: "budget.required", availableValue: { kind: "FACT", ref: "budget.available" } }, valueFact("budget.available", money(999)), [{ resourceRequirementId: "budget.required", value: money(1_000) }]),
  hardScenario({ ...common, constraintId: "capacity.available", kind: "OPERATIONAL_CAPACITY", target: { kind: "RESOURCE", ref: "pricing.team" }, resourceRequirementId: "capacity.required", availableValue: { kind: "FACT", ref: "capacity.available" } }, valueFact("capacity.available", quantity(7, "hours")), [{ resourceRequirementId: "capacity.required", value: quantity(8, "hours") }]),
  hardScenario({ ...common, constraintId: "discount.maximum", kind: "MAXIMUM_DISCOUNT", target: constraintTarget, valueBasis: "PROJECTED_AFTER_ACTION", comparator: "LTE", threshold: percentage(2_000), observedValue: { kind: "FACT", ref: "resulting.discount" } }, valueFact("resulting.discount", percentage(2_001), "PROJECTED_AFTER_ACTION")),
  hardScenario({ ...common, constraintId: "merchant.policy", kind: "MERCHANT_POLICY", target: constraintTarget, rule, expectedDecision: "ALLOW" }, { kind: "RULE_DECISION", rule, decision: "DENY" }),
  hardScenario({ ...common, constraintId: "contract.restriction", kind: "CONTRACTUAL_RESTRICTION", target: constraintTarget, rule: { ...rule, ruleId: "contract.rule" }, expectedDecision: "ALLOW" }, { kind: "RULE_DECISION", rule: { ...rule, ruleId: "contract.rule" }, decision: "DENY" }),
  hardScenario({ ...common, constraintId: "risk.limit", kind: "RISK_LIMIT", target: constraintTarget, valueBasis: "PROJECTED_AFTER_ACTION", metricRef: "merchant.risk", comparator: "LTE", threshold: { valueType: "SCALAR", value: 5, unit: "risk_points" }, horizon: { amount: 7, unit: "DAY" } }, { kind: "RISK", metricRef: "merchant.risk", valueBasis: "PROJECTED_AFTER_ACTION", horizon: { amount: 7, unit: "DAY" }, value: { valueType: "SCALAR", value: 6, unit: "risk_points" } }),
] as const;
