import { z } from "zod";
import type { BusinessStateSnapshot } from "../business_state/schema.js";
import type { OpportunityTemplate } from "./templates.js";
import {
  boundedEstimateSchema,
  estimatedRange,
  responseCurveSchema,
  unknownEstimate,
  type BoundedEstimate,
  type OpportunityImpact,
  type OpportunityConsequence,
  type ResponseCurve,
} from "./contract.js";

const evidenceRef = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const effectMethod = z.enum(["EXPERIMENT", "CAUSAL_MODEL", "OBSERVATIONAL_BOUND"]);

const effectSchema = z.object({
  metric: z.string().min(1),
  unit: z.enum(["MONEY", "COUNT", "RATIO", "PERCENTAGE", "DAYS", "HOURS", "UNITS"]),
  low: z.number().finite(),
  base: z.number().finite(),
  high: z.number().finite(),
  evidenceRefs: z.array(evidenceRef).min(1),
  method: effectMethod,
}).strict().superRefine((value, ctx) => {
  if (value.low > value.base || value.base > value.high) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["base"], message: "Effect estimate must satisfy low <= base <= high" });
  }
});

const addressableSchema = effectSchema.extend({
  method: z.enum(["ACCOUNTING", "OBSERVATIONAL_BOUND", "CAUSAL_MODEL", "EXPERIMENT"]),
}).strict();

const consequenceEvidenceSchema = z.object({
  dimension: z.enum(["CANNIBALIZATION", "CROSS_CHANNEL", "INVENTORY", "CUSTOMER", "PROMOTION", "OPERATIONAL"]),
  direction: z.enum(["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL"]),
  impact: effectSchema,
  notes: z.array(z.string().min(1)).default([]),
}).strict();

export const opportunityEstimateEvidenceSchema = z.object({
  templateId: z.string().min(1),
  addressableUpside: addressableSchema.optional(),
  incrementalEffect: effectSchema.optional(),
  responseCurve: responseCurveSchema.optional(),
  requestedInput: z.number().finite().optional(),
  responseUncertaintyRatio: z.number().min(0).max(2).optional(),
  grossMarginRate: z.number().min(-1).max(1).optional(),
  contributionMarginRate: z.number().min(-1).max(1).optional(),
  executionCost: z.object({
    low: z.number().finite().nonnegative(),
    base: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    evidenceRefs: z.array(evidenceRef).min(1),
  }).strict().optional(),
  cashRequirement: z.object({
    low: z.number().finite().nonnegative(),
    base: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    evidenceRefs: z.array(evidenceRef).min(1),
  }).strict().optional(),
  timeToImpactDays: z.object({
    low: z.number().finite().nonnegative(),
    base: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    evidenceRefs: z.array(evidenceRef).min(1),
  }).strict().optional(),
  consequences: z.array(consequenceEvidenceSchema).default([]),
}).strict();
export type OpportunityEstimateEvidence = z.infer<typeof opportunityEstimateEvidenceSchema>;

function curveValue(curve: Extract<ResponseCurve, { state: "ESTIMATED" }>, input: number): number {
  const points = curve.points;
  if (input <= points[0]!.input) return points[0]!.output;
  for (let index = 1; index < points.length; index += 1) {
    const lower = points[index - 1]!;
    const upper = points[index]!;
    if (input <= upper.input) {
      const fraction = (input - lower.input) / (upper.input - lower.input);
      return lower.output + fraction * (upper.output - lower.output);
    }
  }
  return points[points.length - 1]!.output;
}

function estimateFromEvidence(
  evidence: OpportunityEstimateEvidence | undefined,
): BoundedEstimate | undefined {
  if (!evidence) return undefined;
  if (evidence.incrementalEffect) {
    const value = evidence.incrementalEffect;
    return estimatedRange(value.unit, value.low, value.base, value.high, value.evidenceRefs, value.method);
  }
  if (evidence.responseCurve?.state === "ESTIMATED" && evidence.requestedInput !== undefined) {
    const base = curveValue(evidence.responseCurve, evidence.requestedInput);
    const uncertainty = evidence.responseUncertaintyRatio;
    if (uncertainty === undefined) return undefined;
    const spread = Math.abs(base) * uncertainty;
    return estimatedRange(
      "MONEY",
      base - spread,
      base,
      base + spread,
      evidence.responseCurve.evidenceRefs,
      "RESPONSE_CURVE",
    );
  }
  return undefined;
}

function mapEffect(
  effect: BoundedEstimate | undefined,
  metric: string,
  unit: BoundedEstimate["unit"],
): BoundedEstimate {
  if (effect?.state === "ESTIMATED") {
    return effect.unit === unit
      ? effect
      : unknownEstimate(unit, "Incremental effect is expressed in a different unit", ["A causal estimate in the required metric and unit"]);
  }
  return unknownEstimate(unit, "Incremental effect is not established", ["Experiment, causal model, or defensible observational bound for " + metric]);
}

function multiplyEstimate(
  estimate: BoundedEstimate,
  rate: number | undefined,
  evidenceRefs: readonly string[],
  label: string,
): BoundedEstimate {
  if (estimate.state !== "ESTIMATED" || estimate.unit !== "MONEY" || rate === undefined) {
    return unknownEstimate("MONEY", label + " cannot be estimated from current evidence", ["Incremental revenue plus an evidenced " + label.toLowerCase() + " rate"]);
  }
  const values = [estimate.low * rate, estimate.base * rate, estimate.high * rate].sort((a, b) => a - b);
  return estimatedRange("MONEY", values[0]!, values[1]!, values[2]!, [...new Set([...estimate.evidenceRefs, ...evidenceRefs])], "ACCOUNTING");
}

function contributionEstimate(
  revenue: BoundedEstimate,
  evidence: OpportunityEstimateEvidence | undefined,
): BoundedEstimate {
  if (revenue.state !== "ESTIMATED" || revenue.unit !== "MONEY" || evidence?.contributionMarginRate === undefined) {
    if (evidence?.incrementalEffect?.metric === "contribution_profit") {
      const effect = evidence.incrementalEffect;
      return estimatedRange(effect.unit, effect.low, effect.base, effect.high, effect.evidenceRefs, effect.method);
    }
    return unknownEstimate("MONEY", "Contribution-profit impact is not established", ["Incremental revenue or direct contribution-profit effect, contribution economics, and execution cost"]);
  }
  const rate = evidence.contributionMarginRate;
  const cost = evidence.executionCost;
  const low = revenue.low * rate - (cost?.high ?? 0);
  const base = revenue.base * rate - (cost?.base ?? 0);
  const high = revenue.high * rate - (cost?.low ?? 0);
  const sorted = [low, base, high].sort((a, b) => a - b);
  const refs = [...new Set([...revenue.evidenceRefs, ...(cost?.evidenceRefs ?? [])])];
  return estimatedRange("MONEY", sorted[0]!, sorted[1]!, sorted[2]!, refs, "ACCOUNTING");
}

function confidence(effect: BoundedEstimate | undefined): OpportunityImpact["confidence"] {
  if (!effect || effect.state !== "ESTIMATED") return "UNKNOWN";
  const span = Math.abs(effect.high - effect.low);
  const scale = Math.max(1, Math.abs(effect.base));
  if (effect.method === "EXPERIMENT" && span / scale <= 0.5) return "HIGH";
  if ((effect.method === "EXPERIMENT" || effect.method === "CAUSAL_MODEL") && span / scale <= 1) return "MEDIUM";
  return "LOW";
}

export function estimateOpportunityImpact(
  template: OpportunityTemplate,
  snapshot: BusinessStateSnapshot,
  rawEvidence?: unknown,
): OpportunityImpact {
  const evidence = rawEvidence === undefined ? undefined : opportunityEstimateEvidenceSchema.parse(rawEvidence);
  if (evidence && evidence.templateId !== template.templateId) throw new Error("Estimate evidence template mismatch");

  const effect = estimateFromEvidence(evidence);
  const metric = evidence?.incrementalEffect?.metric ?? evidence?.responseCurve?.outputMetric ?? "unknown";

  const incrementalRevenue =
    metric === "incremental_revenue" || metric === "revenue_net"
      ? mapEffect(effect, "incremental revenue", "MONEY")
      : unknownEstimate("MONEY", "Incremental revenue is not directly established", ["Causal incremental-revenue estimate"]);
  const directContribution =
    metric === "contribution_profit" && effect?.state === "ESTIMATED"
      ? effect
      : undefined;
  const contributionProfit = directContribution ?? contributionEstimate(incrementalRevenue, evidence);
  const grossProfit =
    metric === "gross_profit" && effect?.state === "ESTIMATED"
      ? effect
      : multiplyEstimate(incrementalRevenue, evidence?.grossMarginRate, evidence?.incrementalEffect?.evidenceRefs ?? [], "Gross margin");
  const addressable = evidence?.addressableUpside
    ? estimatedRange(
        evidence.addressableUpside.unit,
        evidence.addressableUpside.low,
        evidence.addressableUpside.base,
        evidence.addressableUpside.high,
        evidence.addressableUpside.evidenceRefs,
        evidence.addressableUpside.method,
      )
    : unknownEstimate("MONEY", "Addressable upside has not been bounded", ["Observed headroom, capacity, or demand bound"]);

  const primaryEffect = effect?.state === "ESTIMATED" ? effect : undefined;
  const effectFor = (names: readonly string[], unit: BoundedEstimate["unit"], label: string): BoundedEstimate =>
    names.includes(metric) ? mapEffect(primaryEffect, label, unit) : unknownEstimate(unit, label + " impact is not established", ["Causal estimate for " + label]);

  const cashRequirement = evidence?.cashRequirement
    ? estimatedRange("MONEY", evidence.cashRequirement.low, evidence.cashRequirement.base, evidence.cashRequirement.high, evidence.cashRequirement.evidenceRefs, "ACCOUNTING")
    : unknownEstimate("MONEY", "Cash requirement is unknown", ["Execution and working-capital requirements"]);

  const responseCurve: ResponseCurve = evidence?.responseCurve ?? {
    state: "UNKNOWN",
    inputMetric: "intervention_intensity",
    outputMetric: template.primaryMetric,
    reason: "No merchant-specific response curve is established",
    evidenceNeeded: ["Experiment, causal model, or observational response evidence"],
  };

  return {
    addressableUpside: addressable,
    responseCurve,
    incrementalRevenue,
    grossProfit,
    contributionProfit,
    incrementalCustomers: effectFor(["new_customers", "incremental_customers"], "COUNT", "Incremental customers"),
    conversionRateChange: effectFor(["cvr", "conversion_rate_change"], "RATIO", "Conversion-rate change"),
    inventoryChange: effectFor(["inventory_units", "inventory_change"], "UNITS", "Inventory change"),
    retentionChange: effectFor(["retention_rate_90d", "retention_change", "repeat_rate"], "RATIO", "Retention change"),
    cacChange: effectFor(["cac", "cac_change"], "MONEY", "CAC change"),
    cashRequirement,
    confidence: confidence(primaryEffect),
    uncertaintyReasons: primaryEffect?.state === "ESTIMATED"
      ? ["Impact range is conditional on the cited causal or bounded evidence and current merchant state"]
      : ["Incremental response is not identified from available evidence"],
  };
}

export function buildConsequences(
  template: OpportunityTemplate,
  rawEvidence?: unknown,
): OpportunityConsequence[] {
  const evidence = rawEvidence === undefined ? undefined : opportunityEstimateEvidenceSchema.parse(rawEvidence);
  const dimensions = ["CANNIBALIZATION", "CROSS_CHANNEL", "INVENTORY", "CUSTOMER", "PROMOTION", "OPERATIONAL"] as const;
  return dimensions.map((dimension) => {
    const supplied = evidence?.consequences.find((item) => item.dimension === dimension);
    if (supplied) {
      const impact = estimatedRange(
        supplied.impact.unit,
        supplied.impact.low,
        supplied.impact.base,
        supplied.impact.high,
        supplied.impact.evidenceRefs,
        supplied.impact.method,
      );
      return {
        dimension,
        state: "ESTIMATED" as const,
        direction: supplied.direction,
        impact,
        evidenceRefs: supplied.impact.evidenceRefs,
        notes: supplied.notes,
      };
    }
    if (template.consequenceApplicability.includes(dimension)) {
      return {
        dimension,
        state: "UNKNOWN" as const,
        direction: "UNKNOWN" as const,
        evidenceRefs: [],
        notes: ["Consequence is decision-relevant but not quantified by current evidence"],
      };
    }
    return {
      dimension,
      state: "NOT_APPLICABLE" as const,
      direction: "NEUTRAL" as const,
      evidenceRefs: [],
      notes: [],
    };
  });
}

export function estimateCost(rawEvidence?: unknown): BoundedEstimate {
  const evidence = rawEvidence === undefined ? undefined : opportunityEstimateEvidenceSchema.parse(rawEvidence);
  if (!evidence?.executionCost) {
    return unknownEstimate("MONEY", "Execution cost is unknown", ["Media, labor, platform, procurement, fulfillment, and cancellation costs as applicable"]);
  }
  return estimatedRange(
    "MONEY",
    evidence.executionCost.low,
    evidence.executionCost.base,
    evidence.executionCost.high,
    evidence.executionCost.evidenceRefs,
    "ACCOUNTING",
  );
}

export function estimateTimeToImpact(rawEvidence?: unknown): BoundedEstimate {
  const evidence = rawEvidence === undefined ? undefined : opportunityEstimateEvidenceSchema.parse(rawEvidence);
  if (!evidence?.timeToImpactDays) {
    return unknownEstimate("DAYS", "Time to impact is not evidenced", ["Historical or experimental time-to-impact evidence"]);
  }
  return estimatedRange(
    "DAYS",
    evidence.timeToImpactDays.low,
    evidence.timeToImpactDays.base,
    evidence.timeToImpactDays.high,
    evidence.timeToImpactDays.evidenceRefs,
    "OBSERVATIONAL_BOUND",
  );
}
