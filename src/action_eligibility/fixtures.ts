import { adaptLegacyAction } from "../canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import { googleBudgetUp2000, metaBudgetDown2000 } from "../action_translation/fixtures.js";
import { reorderSkuA100, reorderSkuB50SupplierX } from "../inventory/fixtures.js";
import { canonicalEligibilityTargetRef } from "./evaluate.js";
import type { DomainEligibilityFact } from "./adapters.js";

export const DOMAIN_FIXTURE_TIME = "2026-09-27T12:00:00.000Z";
export const inventoryIncreaseSkuA = adaptLegacyAction(reorderSkuA100);
export const inventoryIncreaseSkuB = adaptLegacyAction(reorderSkuB50SupplierX);
export const metaPaidMediaAction = adaptLegacyAction(metaBudgetDown2000);
export const googlePaidMediaAction = adaptLegacyAction(googleBudgetUp2000);

export function domainFactFixture(
  action: typeof inventoryIncreaseSkuA,
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

export const unusedMetaChannelFacts = [
  domainFactFixture(metaPaidMediaAction, "ACTION_FAMILY_CAPABILITY", true),
  domainFactFixture(metaPaidMediaAction, "CHANNEL_MERCHANT_ENABLED", false),
] as const;

