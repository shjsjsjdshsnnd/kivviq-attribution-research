import type { CanonicalAction } from "../canonical_action/schema.js";
import type { ConflictScope } from "./schema.js";

export type PriceOperation =
  | { kind: "SET"; amountMinor: number; currency: string }
  | { kind: "DELTA"; amountMinor: number; currency: string; baselineRef?: string; baselineFingerprint?: string }
  | { kind: "MULTIPLY"; factor: number; currency?: string; baselineRef?: string; baselineFingerprint?: string };

export interface AdaptedConflictSemantics {
  readonly adapterId: string;
  readonly kind: "CONTRADICTORY_VALUE_CHANGE" | "EXCLUSIVE_RESOURCE" | "POLICY_PROHIBITION" | "MUTUALLY_EXCLUSIVE_INTENT";
  readonly scope: ConflictScope;
  readonly operation?: PriceOperation;
}

export function priceBaselineBinding(reference: unknown): { baselineRef: string; baselineFingerprint: string } | undefined {
  const value = object(reference);
  if (!value) return undefined;
  if (value.kind === "explicit_baseline" && value.value?.kind === "money")
    return { baselineRef: `explicit:${value.value.currency}:${value.value.amountMinor}`, baselineFingerprint: `fnv1a64:${hash(`${value.value.currency}:${value.value.amountMinor}`)}` };
  if (value.kind === "current_at_decision" && typeof value.decisionTime === "string")
    return { baselineRef: `pricing.current_at_decision:${value.decisionTime}`, baselineFingerprint: `fnv1a64:${hash(JSON.stringify(value))}` };
  return undefined;
}

type Loose = any;
const object = (value: unknown): Loose | undefined => value && typeof value === "object" ? value as Loose : undefined;

function legacy(action: CanonicalAction): Loose | undefined {
  const what = object(action.what);
  return what?.kind === "legacy_business" ? what : undefined;
}

function pricing(action: CanonicalAction): AdaptedConflictSemantics | undefined {
  const value = legacy(action);
  const parameters = object(value?.parameters);
  const operation = object(parameters?.operation);
  const target = object(value?.target);
  if (value?.actionType !== "pricing.adjust_price" || parameters?.kind !== "price_adjustment" || !operation || !target) return undefined;
  const scope: ConflictScope | undefined = target.kind === "sku"
    ? { coordinates: [{ kind: "VARIANT", productRef: target.productId, variantRef: target.skuId }] }
    : target.kind === "product"
      ? { coordinates: [{ kind: "PRODUCT", productRef: target.productId }] }
      : undefined;
  if (!scope) return undefined;
  let normalized: PriceOperation | undefined;
  if (operation.kind === "SET" && operation.value?.kind === "money")
    normalized = { kind: "SET", amountMinor: operation.value.amountMinor, currency: operation.value.currency };
  else if (operation.kind === "DELTA" && operation.amount?.kind === "money") {
    const sign = operation.direction === "decrease" ? -1 : 1;
    const binding = priceBaselineBinding(operation.reference);
    normalized = {
      kind: "DELTA", amountMinor: sign * operation.amount.amountMinor, currency: operation.amount.currency,
      ...(binding ?? {}),
    };
  } else if (operation.kind === "MULTIPLY" && Number.isFinite(operation.factor)) {
    const explicit = operation.reference?.kind === "explicit_baseline" && operation.reference.value?.kind === "money" ? operation.reference.value : undefined;
    normalized = { kind: "MULTIPLY", factor: operation.factor, ...(explicit ? { currency: explicit.currency } : {}), ...(priceBaselineBinding(operation.reference) ?? {}) };
  }
  return normalized ? { adapterId: "domain.pricing.adjust_price@1", kind: "CONTRADICTORY_VALUE_CHANGE", scope, operation: normalized } : undefined;
}

function hash(value: string): string {
  let result = 0xcbf29ce484222325n;
  for (const character of value) result = ((result ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return result.toString(16).padStart(16, "0");
}

/** Closed, typed adapters only. Labels and descriptions are never inspected. */
export function registeredConflictSemantics(action: CanonicalAction): readonly AdaptedConflictSemantics[] {
  const price = pricing(action);
  if (price) return [price];
  const value = legacy(action), parameters = object(value?.parameters), target = object(value?.target);
  if (!value || !parameters) return [];
  if (parameters.kind === "promotion_start" && parameters.definition?.stacking?.kind === "NON_STACKABLE")
    return [{ adapterId: "domain.promotion.non_stackable@1", kind: "MUTUALLY_EXCLUSIVE_INTENT", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "promotion.scope", code: String(parameters.definition.promotionId ?? value.actionId), version: "1" }] } }];
  if (parameters.kind === "shipping_policy_adjustment" && target?.kind === "shipping_policy")
    return [{ adapterId: "domain.shipping.policy@1", kind: "CONTRADICTORY_VALUE_CHANGE", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "shipping.policy", code: String(target.shippingPolicyId), version: "1" }] } }];
  if (["shipping_offer_set", "shipping_offer_modify", "shipping_offer_stop"].includes(parameters.kind) && target?.kind === "shipping_offer")
    return [{ adapterId: "domain.shipping.offer@1", kind: "MUTUALLY_EXCLUSIVE_INTENT", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "shipping.offer", code: String(target.shippingOfferId), version: "1" }] } }];
  if (["merchandising_position", "merchandising_visibility", "merchandising_rank", "merchandising_remove_placement", "merchandising_rank_rollback"].includes(parameters.kind) && target?.kind === "merchandising_placement")
    return [{ adapterId: "domain.merchandising.placement@1", kind: "CONTRADICTORY_VALUE_CHANGE", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "merchandising.placement", code: String(target.placementId), version: "1" }] } }];
  if (["merchandising_relationship", "merchandising_remove_relationship"].includes(parameters.kind) && target?.kind === "merchandising_relationship")
    return [{ adapterId: "domain.merchandising.relationship@1", kind: "CONTRADICTORY_VALUE_CHANGE", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "merchandising.relationship", code: String(target.relationshipId), version: "1" }] } }];
  if (parameters.kind === "cro_intervention" && target?.kind === "cro_experience")
    return [{ adapterId: "domain.cro.experience@1", kind: "MUTUALLY_EXCLUSIVE_INTENT", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "cro.experience", code: String(target.experienceId), version: "1" }] } }];
  if (["lifecycle_flow_start", "lifecycle_flow_stop", "lifecycle_flow_modify"].includes(parameters.kind) && target?.kind === "lifecycle_flow")
    return [{ adapterId: "domain.lifecycle.flow@1", kind: "MUTUALLY_EXCLUSIVE_INTENT", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "lifecycle.flow", code: String(target.flowId), version: "1" }] } }];
  if (parameters.kind === "lifecycle_targeting" && target?.kind === "lifecycle_program")
    return [{ adapterId: "domain.lifecycle.targeting@1", kind: "CONTRADICTORY_VALUE_CHANGE", scope: { coordinates: [{ kind: "CUSTOM", registryRef: "lifecycle.program", code: String(target.programId), version: "1" }] } }];
  if (parameters.kind === "paid_media_budget" || parameters.kind === "budget_adjustment") {
    const resourceRef = parameters.control?.campaignId ?? target?.campaignId ?? target?.channel ?? "paid_media";
    return [{ adapterId: "domain.paid_media.budget@1", kind: "EXCLUSIVE_RESOURCE", scope: { coordinates: [{ kind: "RESOURCE", resourceRef: String(resourceRef), unit: String(parameters.amount?.currency ?? parameters.value?.currency ?? "MONEY") }] } }];
  }
  return [];
}
