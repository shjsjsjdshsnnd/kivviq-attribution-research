import type { Action, ActionConstraint, ActionTarget, ScalarValue } from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { hardConstraintsSchema, type ConstraintTarget, type HardConstraint } from "./schema.js";

function family(action: Action): Extract<ConstraintTarget, { kind: "FAMILY" }>["family"] | undefined {
  const mapped: Record<string, Extract<ConstraintTarget, { kind: "FAMILY" }>["family"]> = {
    advertising: "PAID_MEDIA", pricing: "PRICING", promotion: "PROMOTION", shipping: "SHIPPING",
    merchandising: "MERCHANDISING", inventory: "INVENTORY", cro: "CRO", lifecycle: "LIFECYCLE",
    experimentation: "EXPERIMENT",
  };
  return mapped[action.actionCategory];
}

type CommerceConstraintTarget = Exclude<ConstraintTarget, { kind: "RESOURCE" }>;
function target(action: Action): CommerceConstraintTarget {
  const value: ActionTarget = action.target;
  if (value.kind === "sku") return { kind: "SKU", ref: value.skuId };
  if (value.kind === "product") return { kind: "PRODUCT", ref: value.productId };
  if (value.kind === "campaign") return { kind: "CAMPAIGN", ref: value.campaignId };
  if (value.kind === "advertising_channel") return { kind: "CHANNEL", ref: value.channelId };
  if (value.kind === "customer_segment") return { kind: "POPULATION", ref: value.segmentId };
  const actionFamily = family(action);
  return actionFamily ? { kind: "FAMILY", family: actionFamily } : { kind: "GLOBAL" };
}

function primitive(value: ScalarValue): { amount: number | boolean | string; dimension: string } {
  switch (value.kind) {
    case "money": return { amount: value.amountMinor, dimension: `money:${value.currency}` };
    case "money_rate": return { amount: value.amountMinor, dimension: `money_rate:${value.currency}:${value.per}` };
    case "percentage": return { amount: value.basisPoints, dimension: "percentage" };
    case "quantity": return { amount: value.value, dimension: `quantity:${value.unit}` };
    case "frequency": return { amount: value.count, dimension: `frequency:${value.per}` };
    case "boolean": return { amount: value.value, dimension: "boolean" };
    case "string": return { amount: value.value, dimension: "string" };
  }
}

function validateComparableBounds(constraints: readonly ActionConstraint[]): void {
  const groups = new Map<string, Extract<ActionConstraint["expression"], { kind: "property_comparison" }>[]>();
  for (const constraint of constraints) {
    if (constraint.constraintClass !== "hard" || constraint.expression.kind !== "property_comparison") continue;
    const values = groups.get(constraint.expression.propertyId) ?? [];
    values.push(constraint.expression);
    groups.set(constraint.expression.propertyId, values);
  }
  for (const [propertyId, expressions] of groups) {
    const dimensions = new Set(expressions.map((expression) => primitive(expression.value).dimension));
    if (dimensions.size > 1) throw new Error(`Legacy constraint currency or unit mismatch for ${propertyId}`);
    const numeric = expressions.filter((expression) => typeof primitive(expression.value).amount === "number");
    const lowers = numeric.filter((expression) => expression.operator === "GT" || expression.operator === "GTE");
    const uppers = numeric.filter((expression) => expression.operator === "LT" || expression.operator === "LTE");
    const equalities = expressions.filter((expression) => expression.operator === "EQ");
    const equalityValues = new Set(equalities.map((expression) => String(primitive(expression.value).amount)));
    if (equalityValues.size > 1) throw new Error(`Contradictory legacy equality bounds for ${propertyId}`);
    for (const equality of equalities) {
      const exact = primitive(equality.value).amount;
      if (typeof exact !== "number") continue;
      for (const lower of lowers) {
        const low = primitive(lower.value).amount as number;
        if (exact < low || (exact === low && lower.operator === "GT"))
          throw new Error(`Contradictory legacy equality and lower bound for ${propertyId}`);
      }
      for (const upper of uppers) {
        const high = primitive(upper.value).amount as number;
        if (exact > high || (exact === high && upper.operator === "LT"))
          throw new Error(`Contradictory legacy equality and upper bound for ${propertyId}`);
      }
    }
    for (const lower of lowers) for (const upper of uppers) {
      const low = primitive(lower.value).amount as number, high = primitive(upper.value).amount as number;
      if (low > high || (low === high && (lower.operator === "GT" || upper.operator === "LT")))
        throw new Error(`Contradictory legacy constraint bounds for ${propertyId}`);
    }
  }
}

function custom(action: Action, constraint: ActionConstraint): HardConstraint {
  return {
    constraintId: constraint.constraintId,
    kind: "CUSTOM",
    target: target(action),
    evaluationBoundary: "DECISION_TIME",
    whenUnknown: "UNKNOWN",
    registryRef: "legacy.constraint-expression.v1",
    code: `legacy.${constraint.expression.kind}`,
  };
}

function mapOne(action: Action, constraint: ActionConstraint): HardConstraint {
  const expression = constraint.expression;
  if (expression.kind !== "property_comparison") return custom(action, constraint);
  const common = { constraintId: constraint.constraintId, target: target(action), evaluationBoundary: "DECISION_TIME" as const, whenUnknown: "UNKNOWN" as const };
  if ((expression.propertyId.includes("gross_margin_rate") || expression.propertyId.includes("contribution_margin_rate")) && expression.operator === "GTE" && expression.value.kind === "percentage")
    return { ...common, kind: "MINIMUM_MARGIN", valueBasis: "PROJECTED_AFTER_ACTION", comparator: "GTE", threshold: { valueType: "PERCENTAGE", basisPoints: expression.value.basisPoints }, observedValue: { kind: "FACT", ref: expression.propertyId } };
  if (expression.propertyId === "price.floor_minor" && expression.operator === "LTE" && expression.value.kind === "money" && (common.target.kind === "SKU" || common.target.kind === "PRODUCT"))
    return { ...common, kind: "PRICE_FLOOR", target: common.target, valueBasis: "PROJECTED_AFTER_ACTION", comparator: "GTE", threshold: { valueType: "MONEY", amountMinor: expression.value.amountMinor, currency: expression.value.currency }, observedValue: { kind: "FACT", ref: "resulting.price" } };
  if (expression.propertyId === "promotion.maximum_discount_rate" && expression.operator === "GTE" && expression.value.kind === "percentage")
    return { ...common, kind: "MAXIMUM_DISCOUNT", valueBasis: "PROJECTED_AFTER_ACTION", comparator: "LTE", threshold: { valueType: "PERCENTAGE", basisPoints: expression.value.basisPoints }, observedValue: { kind: "FACT", ref: "resulting.discount" } };
  return custom(action, constraint);
}

export function mapLegacyHardConstraints(input: unknown): HardConstraint[] {
  const action = assertValidAction(input);
  validateComparableBounds(action.constraints);
  return hardConstraintsSchema.parse(action.constraints.filter((constraint) => constraint.constraintClass === "hard").map((constraint) => mapOne(action, constraint)));
}
