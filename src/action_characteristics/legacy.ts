import { actionCharacteristicsSchema, costLineItemSchema, deriveReachableCancellationStages, operationalBurdenLineItemSchema, reversibilitySchema, stageCancellationCostSchema, stageReachabilityInputSchema, type ActionCharacteristics, type CostLineItem, type OperationalBurdenLineItem, type Reversibility, type StageCancellationCost, type StageReachabilityInput } from "./schema.js";

export type LegacyCostSourceKind =
  | "PAID_SPEND" | "STAFF_SERVICE" | "PROVIDER_LICENSE"
  | "INVENTORY_ACQUISITION" | "SHIPPING_HANDLING"
  | "PRE_EFFECT_CANCELLATION" | "OTHER_TYPED_MONETARY";

export interface LegacyActionCharacteristicsInput {
  costs: readonly { sourceKind: LegacyCostSourceKind; fieldRef: string; amountMinor: number; currency?: string }[];
  implementationDelaySeconds?: number;
  burdens: readonly {
    fieldRef: string;
    resourceKind: "STAFF" | "SERVICE" | "WAREHOUSE" | "FULFILLMENT" | "CHANNEL" | "PLACEMENT" | "INVENTORY_COMMITMENT" | "AD_BUDGET_COMMITMENT";
    resourceRef: string;
    quantity: number;
    unit: "minutes" | "hours" | "units" | "orders" | "messages" | "placements";
  }[];
  reversibility?: {
    classification: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
    reversal?: { kind: "ACTION"; actionId: string; actionFingerprint: string } | { kind: "REGISTERED"; registryRef: string; code: string; version: string };
    irreversibleEffects?: ActionCharacteristics["reversibility"] extends infer _ ? readonly unknown[] : never;
    minimumDelaySeconds?: number;
  };
  cancellationStages: readonly unknown[];
  reachability?: StageReachabilityInput;
}

const categories: Record<LegacyCostSourceKind, CostLineItem["category"]> = {
  PAID_SPEND: "MEDIA", STAFF_SERVICE: "LABOR", PROVIDER_LICENSE: "PLATFORM",
  INVENTORY_ACQUISITION: "PROCUREMENT", SHIPPING_HANDLING: "FULFILLMENT",
  PRE_EFFECT_CANCELLATION: "CANCELLATION", OTHER_TYPED_MONETARY: "OTHER",
};
const slug = (value: string) => value.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/^[^A-Za-z]/, "legacy_$&");

export function adaptLegacyActionCharacteristics(input: LegacyActionCharacteristicsInput) {
  if (!input || typeof input !== "object" || !Array.isArray(input.costs) || !Array.isArray(input.burdens) || !Array.isArray(input.cancellationStages)) {
    return {
      characteristics: actionCharacteristicsSchema.parse({ implementationCost: [], operationalBurden: [], reversibility: { kind: "UNKNOWN", reason: "Legacy projection rejected" }, cancellationCosts: [] }),
      provenance: [],
      rejected: [{ fieldRef: "input", reason: "Invalid legacy characteristics input" }],
      cancellation: { state: "UNKNOWN" as const, reason: "Legacy input has no typed stage-specific cancellation data" },
    };
  }
  const rejected: { fieldRef: string; reason: string }[] = [];
  const provenance: { lineItemId: string; fieldRef: string; sourceKind: LegacyCostSourceKind; amountMinor: number; currency: string }[] = [];
  const implementationCost: CostLineItem[] = [];
  const rawCosts = input.costs.flatMap((cost, index) => cost && typeof cost === "object" && !Array.isArray(cost) && typeof (cost as { fieldRef?: unknown }).fieldRef === "string" ? [cost] : (rejected.push({ fieldRef: `costs.${index}`, reason: "Invalid legacy cost element" }), []));
  const costKeys = rawCosts.map((cost) => ({ field: cost.fieldRef, id: `legacy.cost.${slug(cost.fieldRef)}` }));
  const collidingCostFields = new Set(costKeys.filter((key, index, all) => all.some((other, otherIndex) => otherIndex !== index && (other.field === key.field || other.id === key.id))).map((key) => key.field));
  for (const cost of rawCosts) {
    const category = categories[cost.sourceKind as LegacyCostSourceKind];
    if (category === undefined || collidingCostFields.has(cost.fieldRef) || !Number.isSafeInteger(cost.amountMinor) || cost.amountMinor < 0 || !cost.currency || !/^[A-Z]{3}$/.test(cost.currency)) {
      rejected.push({ fieldRef: cost.fieldRef, reason: "Legacy money must have an exact non-negative minor-unit amount and currency" });
      continue;
    }
    const lineItemId = `legacy.cost.${slug(cost.fieldRef)}`;
    const projected = costLineItemSchema.safeParse({ lineItemId, category, amount: { state: "KNOWN", value: { amountMinor: cost.amountMinor, currency: cost.currency } } });
    if (!projected.success) { rejected.push({ fieldRef: cost.fieldRef, reason: "Projected cost is invalid" }); continue; }
    implementationCost.push(projected.data);
    provenance.push({ lineItemId, fieldRef: cost.fieldRef, sourceKind: cost.sourceKind, amountMinor: cost.amountMinor, currency: cost.currency });
  }
  const operationalBurden: OperationalBurdenLineItem[] = [];
  const rawBurdens = input.burdens.flatMap((burden, index) => burden && typeof burden === "object" && !Array.isArray(burden) && typeof (burden as { fieldRef?: unknown }).fieldRef === "string" ? [burden] : (rejected.push({ fieldRef: `burdens.${index}`, reason: "Invalid legacy burden element" }), []));
  const burdenKeys = rawBurdens.map((burden) => ({ field: burden.fieldRef, id: `legacy.burden.${slug(burden.fieldRef)}` }));
  const collidingBurdenFields = new Set(burdenKeys.filter((key, index, all) => all.some((other, otherIndex) => otherIndex !== index && (other.field === key.field || other.id === key.id))).map((key) => key.field));
  const compatibleUnit = (kind: LegacyActionCharacteristicsInput["burdens"][number]["resourceKind"], unit: LegacyActionCharacteristicsInput["burdens"][number]["unit"]) =>
    (kind === "STAFF" || kind === "SERVICE") ? unit === "minutes" || unit === "hours"
      : kind === "WAREHOUSE" || kind === "FULFILLMENT" ? unit === "units" || unit === "orders"
        : kind === "CHANNEL" ? unit === "messages" : kind === "PLACEMENT" ? unit === "placements" : false;
  for (const burden of rawBurdens) {
    if (collidingBurdenFields.has(burden.fieldRef) || !compatibleUnit(burden.resourceKind, burden.unit) || !Number.isFinite(burden.quantity) || burden.quantity < 0 || !/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(burden.resourceRef)) {
      rejected.push({ fieldRef: burden.fieldRef, reason: "Commitments and invalid quantities are not operational burden" });
      continue;
    }
    const kind = burden.resourceKind === "SERVICE" ? "STAFF" : burden.resourceKind;
    const projected = operationalBurdenLineItemSchema.safeParse({ burdenId: `legacy.burden.${slug(burden.fieldRef)}`, amount: { state: "KNOWN", value: { quantity: burden.quantity, unit: burden.unit, resource: { kind, resourceRef: burden.resourceRef } } } });
    if (!projected.success) { rejected.push({ fieldRef: burden.fieldRef, reason: "Projected burden is invalid" }); continue; }
    operationalBurden.push(projected.data);
  }
  let reversibility: Reversibility = { kind: "UNKNOWN", reason: "Legacy reversal lacks an exact typed identity" };
  const legacy = input.reversibility;
  if (legacy?.classification === "FULLY_REVERSIBLE" && legacy.reversal)
    reversibility = { kind: "FULLY_REVERSIBLE", reversal: legacy.reversal };
  else if (legacy?.classification === "IRREVERSIBLE" && Array.isArray(legacy.irreversibleEffects) && legacy.irreversibleEffects.length)
    reversibility = { kind: "IRREVERSIBLE", irreversibleEffects: legacy.irreversibleEffects as never };
  else if (legacy?.classification === "PARTIALLY_REVERSIBLE" && legacy.reversal && Array.isArray(legacy.irreversibleEffects) && legacy.irreversibleEffects.length)
    reversibility = { kind: "PARTIALLY_REVERSIBLE", reversal: legacy.reversal, irreversibleEffects: legacy.irreversibleEffects as never };
  const cancellationCosts: StageCancellationCost[] = [];
  const seenCancellationStages = new Set<string>();
  for (const [index, stage] of input.cancellationStages.entries()) {
    const parsed = stageCancellationCostSchema.safeParse(stage);
    if (parsed.success && !seenCancellationStages.has(parsed.data.stage)) {
      cancellationCosts.push(parsed.data);
      seenCancellationStages.add(parsed.data.stage);
    }
    else rejected.push({ fieldRef: `cancellationStages.${index}`, reason: "Cancellation stage data is not exact native-compatible data" });
  }
  const parsedReversibility = reversibilitySchema.safeParse(reversibility);
  if (!parsedReversibility.success) {
    rejected.push({ fieldRef: "reversibility", reason: "Invalid legacy reversibility projection" });
    reversibility = { kind: "UNKNOWN", reason: "Legacy reversal lacks an exact typed identity" };
  } else reversibility = parsedReversibility.data;
  const characteristics = actionCharacteristicsSchema.parse({ implementationCost, operationalBurden, reversibility, cancellationCosts }) as ActionCharacteristics;
  const reachability = input.reachability === undefined ? undefined : stageReachabilityInputSchema.safeParse(input.reachability);
  if (reachability && !reachability.success) rejected.push({ fieldRef: "reachability", reason: "Invalid cancellation reachability input" });
  return {
    characteristics, provenance, rejected,
    ...(Number.isSafeInteger(input.implementationDelaySeconds) && input.implementationDelaySeconds! >= 0 ? { timingImplementationDelay: { amount: input.implementationDelaySeconds!, unit: "SECOND" as const } } : {}),
    ...(reversibility.kind !== "UNKNOWN" && reversibility.kind !== "NOT_APPLICABLE" && Number.isSafeInteger(legacy?.minimumDelaySeconds) && legacy!.minimumDelaySeconds! >= 0 ? { reversibilityMinimumDelay: { amount: legacy!.minimumDelaySeconds!, unit: "SECOND" as const } } : {}),
    cancellation: reachability?.success
      ? { state: cancellationCosts.length ? "PRESENT" as const : "UNKNOWN" as const, stages: deriveReachableCancellationStages(reachability.data).map((stage) => { const known = cancellationCosts.find((item) => item.stage === stage); return known ? { stage, state: "KNOWN" as const, value: known } : { stage, state: "UNKNOWN" as const, reason: "Legacy input has no typed stage-specific cancellation data" }; }) }
      : cancellationCosts.length ? { state: "PRESENT" as const, stages: cancellationCosts.map((value) => ({ stage: value.stage, state: "KNOWN" as const, value })) } : { state: "UNKNOWN" as const, reason: "Legacy input has no typed stage-specific cancellation data" },
  };
}
