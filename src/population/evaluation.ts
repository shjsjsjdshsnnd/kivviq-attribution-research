import { z } from "zod";
import {
  populationDefinitionSchema,
  populationContextSchema,
  populationEvaluationSchema,
  customerSchema,
} from "./schema.js";
import type {
  MembershipStatus,
  PopulationRule,
  PopulationDefinition,
  PopulationEvaluation,
  Window,
  Operator,
} from "./schema.js";
import { canonical } from "./identity.js";
import { fingerprintPopulationDefinition } from "./fingerprint.js";
const yes: MembershipStatus = "ELIGIBLE",
  no: MembershipStatus = "INELIGIBLE",
  unknown: MembershipStatus = "UNKNOWN";
function and(values: MembershipStatus[]): MembershipStatus {
  return values.includes(no) ? no : values.includes(unknown) ? unknown : yes;
}
function or(values: MembershipStatus[]): MembershipStatus {
  return values.includes(yes) ? yes : values.includes(unknown) ? unknown : no;
}
function not(value: MembershipStatus): MembershipStatus {
  return value === unknown ? unknown : value === yes ? no : yes;
}
function bool(value: boolean | undefined): MembershipStatus {
  return value === undefined ? unknown : value ? yes : no;
}
function compare(
  value: number | undefined,
  op: Operator,
  target: number,
): MembershipStatus {
  if (value === undefined) return unknown;
  return bool(
    op === "EQ"
      ? value === target
      : op === "GT"
        ? value > target
        : op === "GTE"
          ? value >= target
          : op === "LT"
            ? value < target
            : value <= target,
  );
}
function inWindow(time: string, window: Window, at: number): boolean {
  const t = Date.parse(time);
  return (
    t <= at && (window.kind === "LIFETIME" || t >= at - window.days * 86400000)
  );
}
function rule(
  r: PopulationRule,
  c: z.infer<typeof customerSchema>,
  at: number,
): MembershipStatus {
  switch (r.kind) {
    case "AND":
    case "INTERSECTION":
      return and(r.operands.map((x) => rule(x, c, at)));
    case "OR":
    case "UNION":
      return or(r.operands.map((x) => rule(x, c, at)));
    case "NOT":
      return not(rule(r.operand, c, at));
    case "DIFFERENCE":
      return and([rule(r.left, c, at), not(rule(r.right, c, at))]);
    case "COMPLETED_ORDER_COUNT":
      return compare(c.completedOrderCount, r.operator, r.value);
    case "DAYS_SINCE_LAST_COMPLETED_ORDER":
      return compare(
        c.lastCompletedOrderAt && Date.parse(c.lastCompletedOrderAt) <= at
          ? (at - Date.parse(c.lastCompletedOrderAt)) / 86400000
          : undefined,
        r.operator,
        r.value,
      );
    case "NET_REVENUE":
      return compare(
        c.revenues?.find(
          (x) =>
            x.asOf !== undefined &&
            Date.parse(x.asOf) === at &&
            x.currency === r.currency &&
            canonical(x.window) === canonical(r.window),
        )?.amount,
        r.operator,
        r.amount,
      );
    case "CONSENT": {
      const v = r.channel === "EMAIL" ? c.emailEligible : c.smsEligible;
      return v === undefined ? unknown : bool(v === r.eligible);
    }
    case "PURCHASED_PRODUCT":
      return c.purchases?.some(
        (x) =>
          x.productId === r.productId && inWindow(x.completedAt, r.window, at),
      )
        ? yes
        : c.purchaseEvidenceComplete
          ? no
          : unknown;
    case "OBSERVED_CART_ABANDONMENT":
      return c.observedCartAbandonments?.some((x) => inWindow(x, r.window, at))
        ? yes
        : c.cartEvidenceComplete
          ? no
          : unknown;
  }
}
function universe(
  d: PopulationDefinition,
  c: z.infer<typeof customerSchema>,
): MembershipStatus {
  switch (d.universe) {
    case "ALL_CUSTOMERS":
      return yes;
    case "KNOWN_CUSTOMERS":
      return bool(c.known);
    case "MARKETING_CONTACTS":
      return bool(c.marketingContact);
    case "PURCHASERS":
      return compare(c.completedOrderCount, "GT", 0);
    case "EMAIL_ELIGIBLE_CUSTOMERS":
      return bool(c.emailEligible);
    case "SMS_ELIGIBLE_CUSTOMERS":
      return bool(c.smsEligible);
  }
}
export function evaluatePopulation(
  definition: unknown,
  context: unknown,
): PopulationEvaluation {
  const d = populationDefinitionSchema.parse(definition),
    ctx = populationContextSchema.parse(context),
    at = Date.parse(ctx.evaluatedAt);
  const members = ctx.customers
    .map((c) => ({
      customerId: c.customerId,
      status: and([
        universe(d, c),
        rule(d.inclusion, c, at),
        not(or(d.exclusions.map((x) => rule(x, c, at)))),
      ]),
    }))
    .sort((a, b) => a.customerId.localeCompare(b.customerId));
  const eligibleCount = members.filter((x) => x.status === yes).length,
    ineligibleCount = members.filter((x) => x.status === no).length,
    unknownCount = members.filter((x) => x.status === unknown).length;
  return populationEvaluationSchema.parse({
    schemaVersion: 1,
    populationId: d.populationId,
    version: d.version,
    definitionFingerprint: fingerprintPopulationDefinition(d),
    binding: d.binding,
    membershipMode: d.membershipMode,
    evaluatedAt: ctx.evaluatedAt,
    members,
    eligibleCount,
    ineligibleCount,
    unknownCount,
    evidenceCoverage: members.length
      ? (members.length - unknownCount) / members.length
      : 1,
    provenance: d.provenance,
  });
}
