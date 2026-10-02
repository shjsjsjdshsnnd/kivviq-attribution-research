import { z } from "zod";
import {
  businessStateSnapshotSchema,
  type BusinessConstraint,
  type BusinessStateSnapshot,
  type MetricState,
} from "../business_state/schema.js";
import {
  OPPORTUNITY_ENGINE_VERSION,
  OPPORTUNITY_SCHEMA_VERSION,
  opportunitySetSchema,
  unknownEstimate,
  type BoundedEstimate,
  type Opportunity,
  type OpportunityArea,
  type OpportunityDomain,
  type OpportunitySet,
  type OpportunityTarget,
} from "./contract.js";
import { normalizeDiagnosis } from "./diagnosis-adapter.js";
import {
  buildConsequences,
  estimateCost,
  estimateOpportunityImpact,
  estimateTimeToImpact,
  opportunityEstimateEvidenceSchema,
  type OpportunityEstimateEvidence,
} from "./estimation.js";
import { OPPORTUNITY_TEMPLATES, templatesForArea, type OpportunityTemplate } from "./templates.js";

const hintSchema = z.object({
  templateId: z.string().min(1),
  target: z.object({
    kind: z.enum([
      "MERCHANT", "CHANNEL", "CAMPAIGN", "AD_SET", "PRODUCT", "SKU", "COLLECTION",
      "CUSTOMER_SEGMENT", "PAGE", "FUNNEL_STAGE", "LIFECYCLE_FLOW", "PROMOTION",
      "SHIPPING_POLICY", "INVENTORY_LOCATION", "RESOURCE",
    ]),
    ref: z.string().min(1),
  }).strict().optional(),
  parameters: z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).default({}),
  requiredResources: z.array(z.string().min(1)).default([]),
}).strict();
export type OpportunityCandidateHint = z.infer<typeof hintSchema>;

export interface OpportunityEngineInput {
  readonly snapshot: unknown;
  readonly diagnosis?: unknown;
  readonly candidateHints?: readonly OpportunityCandidateHint[];
  readonly estimateEvidence?: readonly OpportunityEstimateEvidence[];
  readonly supportedActionTypes?: readonly string[];
}

const safe = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, "_").replace(/^([^A-Za-z])/, "r_$1");
  return normalized.length > 0 ? normalized : "ref";
};
const refs = (values: readonly string[]): string[] => [...new Set(values.map(safe))].sort();

function metric(snapshot: BusinessStateSnapshot, id: string): MetricState | undefined {
  return snapshot.metrics.find((row) => row.metricId === id);
}

function addArea(target: Map<string, OpportunityArea>, area: OpportunityArea): void {
  const existing = target.get(area.code);
  if (!existing) {
    target.set(area.code, area);
    return;
  }
  target.set(area.code, {
    ...existing,
    source: existing.source === "DIAGNOSIS" || area.source === "DIAGNOSIS" ? "DIAGNOSIS" : existing.source,
    diagnosisRefs: refs([...existing.diagnosisRefs, ...area.diagnosisRefs]),
    evidenceRefs: refs([...existing.evidenceRefs, ...area.evidenceRefs]),
    unresolvedQuestions: [...new Set([...existing.unresolvedQuestions, ...area.unresolvedQuestions])].sort(),
  });
}

function area(code: string, source: OpportunityArea["source"], domain: OpportunityDomain, summary: string, diagnosisRefs: readonly string[], evidenceRefs: readonly string[], unresolvedQuestions: readonly string[]): OpportunityArea {
  return {
    areaId: "area_" + safe(code),
    source,
    code: safe(code),
    domain,
    summary,
    diagnosisRefs: refs(diagnosisRefs),
    evidenceRefs: refs(evidenceRefs),
    unresolvedQuestions: [...new Set(unresolvedQuestions)].sort(),
  };
}

export function deriveOpportunityAreas(snapshotInput: unknown, diagnosisInput?: unknown): OpportunityArea[] {
  const snapshot = businessStateSnapshotSchema.parse(snapshotInput);
  const areas = new Map<string, OpportunityArea>();

  if (diagnosisInput !== undefined) {
    for (const signal of normalizeDiagnosis(diagnosisInput)) {
      const evidence = refs(signal.evidenceRefs);
      const unresolved = signal.unresolved;
      if (signal.code === "diagnosis_unknown" || signal.direction === "UNKNOWN") {
        addArea(areas, area("measurement_gap", "DIAGNOSIS", "INVESTIGATION", "Decision-relevant diagnosis evidence is incomplete.", [signal.diagnosisRef], evidence, unresolved.length ? unresolved : ["Resolve the unknown diagnosis evidence"]));
        continue;
      }
      if (!signal.material) continue;
      const mapping: Record<string, { down?: [string, OpportunityDomain, string]; up?: [string, OpportunityDomain, string] }> = {
        cvr: { down: ["conversion_decline", "CRO", "Conversion deteriorated materially."] },
        sessions: { down: ["traffic_decline", "ACQUISITION", "Qualified traffic or demand deteriorated materially."] },
        orders: { down: ["orders_decline", "ACQUISITION", "Order volume deteriorated materially."] },
        aov: { down: ["aov_decline", "MERCHANDISING", "Average order value deteriorated materially."] },
        revenue_net: { down: ["revenue_decline", "INVESTIGATION", "Net revenue deteriorated materially."] },
      };
      const tuple = signal.direction === "DOWN" ? mapping[signal.metricId]?.down : mapping[signal.metricId]?.up;
      if (tuple) addArea(areas, area(tuple[0], "DIAGNOSIS", tuple[1], tuple[2], [signal.diagnosisRef], evidence, unresolved));
    }
  }

  const stateMappings: Record<string, [string, OpportunityDomain, string]> = {
    retargeting_heavy: ["retargeting_heavy", "PAID_MEDIA", "Paid acquisition is overly concentrated in retargeting."],
    new_customer_growth_weak: ["new_customer_growth_weak", "ACQUISITION", "New-customer growth is weak."],
    inventory_constrained: ["inventory_constrained", "INVENTORY", "Inventory is constraining economically attractive demand."],
    inventory_four_day_cover: ["inventory_constrained", "INVENTORY", "Inventory cover is critically short."],
    measurement_confidence_low: ["measurement_confidence_low", "INVESTIGATION", "Measurement confidence is too low for confident intervention."],
    discount_driven_growth: ["discount_driven_growth", "PROMOTION", "Growth is associated with deeper discounting."],
    margin_compression: ["margin_compression", "PRICING", "Margin is compressing."],
    retention_weak: ["retention_weak", "RETENTION", "Retention is weak."],
    paid_dependency_high: ["paid_dependency_high", "PAID_MEDIA", "The business is highly dependent on paid acquisition."],
    platform_roas_high_incrementality_unmeasured: ["platform_roas_unverified", "INVESTIGATION", "Platform ROAS is high but incrementality is unmeasured."],
  };
  for (const signal of snapshot.signals.filter((item) => item.active)) {
    const mapped = stateMappings[signal.code];
    if (!mapped) continue;
    addArea(areas, area(mapped[0], "BUSINESS_STATE", mapped[1], mapped[2], [], signal.evidenceIds, signal.confidence === "UNKNOWN" ? ["Resolve signal confidence"] : []));
  }

  const inventoryRisk = metric(snapshot, "inventory_at_risk_value");
  if (inventoryRisk?.current !== null && inventoryRisk?.current !== undefined && inventoryRisk.current > 0 && inventoryRisk.confidence !== "UNKNOWN") {
    addArea(areas, area("inventory_at_risk", "PROACTIVE", "INVENTORY", "Inventory at risk creates an opportunity to improve working-capital efficiency.", [], inventoryRisk.evidence.map((item) => item.evidenceId), []));
  }

  const momentum = metric(snapshot, "product_momentum");
  if (momentum?.trend === "RISING" && momentum.confidence !== "UNKNOWN") {
    addArea(areas, area("product_momentum", "PROACTIVE", "MERCHANDISING", "Product momentum may support additional merchandising or acquisition.", [], momentum.evidence.map((item) => item.evidenceId), []));
  }

  const automationCoverage = metric(snapshot, "automation_coverage");
  if (automationCoverage?.current !== null && automationCoverage?.current !== undefined && automationCoverage.current < 0.5 && automationCoverage.confidence !== "UNKNOWN") {
    addArea(areas, area("lifecycle_underused", "PROACTIVE", "LIFECYCLE", "Lifecycle automation coverage is underused.", [], automationCoverage.evidence.map((item) => item.evidenceId), []));
  }

  const shippingCost = metric(snapshot, "shipping_fulfillment_cost");
  if (shippingCost?.trend === "RISING" && shippingCost.confidence !== "UNKNOWN") {
    addArea(areas, area("shipping_cost_pressure", "PROACTIVE", "SHIPPING", "Shipping and fulfillment cost is rising.", [], shippingCost.evidence.map((item) => item.evidenceId), []));
  }

  const returns = metric(snapshot, "return_rate");
  if (returns?.trend === "RISING" && returns.confidence !== "UNKNOWN") {
    addArea(areas, area("return_pressure", "PROACTIVE", "OPERATIONAL", "Return rate is rising and may create avoidable operating drag.", [], returns.evidence.map((item) => item.evidenceId), []));
  }

  if (!snapshot.evidenceComplete) {
    addArea(areas, area("measurement_gap", "BUSINESS_STATE", "INVESTIGATION", "Business-state evidence is incomplete.", [], snapshot.metrics.flatMap((row) => row.evidence.map((item) => item.evidenceId)), ["Complete required business-state evidence"]));
  }

  return [...areas.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function relevantConstraint(domain: OpportunityDomain, constraint: BusinessConstraint): boolean {
  if (constraint.kind === "MERCHANT_POLICY" || constraint.kind === "OPERATIONAL_CAPACITY") return true;
  if (constraint.kind === "MEASUREMENT_MINIMUM" || constraint.kind === "SAMPLE_MINIMUM") return domain !== "INVESTIGATION" && domain !== "NO_ACTION";
  if (constraint.kind === "BUDGET_LIMIT" || constraint.kind === "CHANNEL_SATURATION") return domain === "PAID_MEDIA" || domain === "ACQUISITION";
  if (constraint.kind === "INVENTORY_LIMIT") return ["INVENTORY", "PAID_MEDIA", "MERCHANDISING", "PROMOTION"].includes(domain);
  if (constraint.kind === "MARGIN_FLOOR") return domain === "PRICING" || domain === "PROMOTION";
  return false;
}

function targetFor(template: OpportunityTemplate, snapshot: BusinessStateSnapshot, hint?: OpportunityCandidateHint): OpportunityTarget {
  if (hint?.target) return { state: "RESOLVED", kind: hint.target.kind, ref: safe(hint.target.ref) };
  if (template.targetKind === "MERCHANT") return { state: "RESOLVED", kind: "MERCHANT", ref: safe(snapshot.merchantId) };
  if (template.targetKind === "FUNNEL_STAGE" && template.templateId.startsWith("cro.checkout")) return { state: "RESOLVED", kind: "FUNNEL_STAGE", ref: "checkout" };
  return {
    state: "UNRESOLVED",
    requiredKind: template.targetKind as Exclude<OpportunityTarget, { state: "RESOLVED" }>["requiredKind"],
    evidenceNeeded: ["Identify the exact " + template.targetKind.toLowerCase().replace(/_/g, " ") + " to change"],
  };
}

function parametersFor(template: OpportunityTemplate, hint?: OpportunityCandidateHint) {
  if (template.parameterKeys.length === 0) return { state: "NOT_APPLICABLE" as const };
  const known = hint?.parameters ?? {};
  const missing = template.parameterKeys.filter((key) => !(key in known));
  return missing.length === 0
    ? { state: "READY" as const, values: known }
    : { state: "NEEDS_INPUT" as const, known, required: missing };
}

function mechanismFor(template: OpportunityTemplate) {
  const leverMetric: Record<OpportunityTemplate["primaryLever"], string> = {
    TRAFFIC: "qualified_traffic",
    CONVERSION: "cvr",
    AOV: "aov",
    CAC: "cac",
    MARGIN: "gross_margin",
    INVENTORY: "inventory_availability",
    REPEAT_RATE: "repeat_rate",
    RETENTION: "retention_rate",
    RETURN_RATE: "return_rate",
    FULFILLMENT_COST: "shipping_fulfillment_cost",
    MEASUREMENT_QUALITY: "evidence_quality",
  };
  return {
    primaryLever: template.primaryLever,
    steps: [
      { from: safe(template.actionType), to: leverMetric[template.primaryLever], relation: template.primaryLever === "CAC" || template.primaryLever === "RETURN_RATE" || template.primaryLever === "FULFILLMENT_COST" ? "DECREASES" as const : template.primaryLever === "MEASUREMENT_QUALITY" ? "MEASURES" as const : "INCREASES" as const },
      { from: leverMetric[template.primaryLever], to: "contribution_profit", relation: template.primaryLever === "MEASUREMENT_QUALITY" ? "ENABLES" as const : "INCREASES" as const },
    ],
    terminalOutcome: "contribution_profit" as const,
  };
}

function measurementBaseline(snapshot: BusinessStateSnapshot, metricId: string) {
  const row = metric(snapshot, metricId);
  if (!row || row.current === null || row.evidence.length === 0 || row.confidence === "UNKNOWN") {
    return { state: "UNKNOWN" as const, reason: "Current baseline is not established in Business State" };
  }
  const unit = row.unit === "MONEY" ? "MONEY" as const
    : row.unit === "COUNT" ? "COUNT" as const
    : row.unit === "DAYS" ? "DAYS" as const
    : row.unit === "SECONDS" ? "HOURS" as const
    : "RATIO" as const;
  return { state: "KNOWN" as const, value: row.current, unit, evidenceRefs: refs(row.evidence.map((item) => item.evidenceId)) };
}

function constraintChecks(snapshot: BusinessStateSnapshot, template: OpportunityTemplate) {
  return snapshot.constraints.filter((constraint) => relevantConstraint(template.domain, constraint)).map((constraint) => ({
    constraintId: safe(constraint.constraintId),
    status: constraint.status,
    evidenceRefs: refs(constraint.evidenceMetricIds.flatMap((metricId) => metric(snapshot, metricId)?.evidence.map((item) => item.evidenceId) ?? [])),
    reasons: [constraint.reason],
  }));
}

function feasibility(
  template: OpportunityTemplate,
  target: OpportunityTarget,
  parameters: ReturnType<typeof parametersFor>,
  checks: ReturnType<typeof constraintChecks>,
  supportedActionTypes?: readonly string[],
) {
  const violated = checks.filter((check) => check.status === "VIOLATED");
  const unknown = checks.filter((check) => check.status === "UNKNOWN");
  const capabilityKnown = supportedActionTypes !== undefined;
  const missing = capabilityKnown && !supportedActionTypes.includes(template.actionType) ? [safe(template.actionType)] : [];
  const reasons: string[] = [];
  if (violated.length) reasons.push("Merchant constraint violated");
  if (unknown.length) reasons.push("Merchant constraint unresolved");
  if (missing.length) reasons.push("Required execution capability unavailable");
  if (target.state === "UNRESOLVED") reasons.push("Intervention target unresolved");
  if (parameters.state === "NEEDS_INPUT") reasons.push("Intervention parameters incomplete");
  if (!capabilityKnown) reasons.push("Execution capability not verified");
  const status = violated.length || missing.length
    ? "BLOCKED" as const
    : unknown.length || target.state === "UNRESOLVED" || parameters.state === "NEEDS_INPUT" || !capabilityKnown
      ? "UNKNOWN" as const
      : "FEASIBLE" as const;
  return {
    status,
    requiredCapabilities: template.requiredCapabilities.map(safe),
    missingCapabilities: missing,
    reasons,
  };
}

function conflictKey(template: OpportunityTemplate, target: OpportunityTarget): string {
  const family = template.actionType.split(".")[0] ?? template.domain.toLowerCase();
  const ref = target.state === "RESOLVED" ? target.ref : template.targetKind.toLowerCase();
  return safe("control." + family + "." + ref);
}

function opportunityStatus(
  impact: ReturnType<typeof estimateOpportunityImpact>,
  feasible: ReturnType<typeof feasibility>,
  target: OpportunityTarget,
  parameters: ReturnType<typeof parametersFor>,
): Opportunity["status"] {
  if (impact.contributionProfit.state !== "ESTIMATED") return "INSUFFICIENT_EVIDENCE";
  if (feasible.status !== "FEASIBLE" || target.state !== "RESOLVED" || parameters.state === "NEEDS_INPUT") return "POTENTIAL";
  return "ACTIONABLE";
}

function buildOpportunity(
  area: OpportunityArea,
  template: OpportunityTemplate,
  snapshot: BusinessStateSnapshot,
  createdAt: string,
  hint: OpportunityCandidateHint | undefined,
  evidence: OpportunityEstimateEvidence | undefined,
  supportedActionTypes?: readonly string[],
): Opportunity {
  const target = targetFor(template, snapshot, hint);
  const parameters = parametersFor(template, hint);
  const checks = constraintChecks(snapshot, template);
  const feasible = feasibility(template, target, parameters, checks, supportedActionTypes);
  const impact = estimateOpportunityImpact(template, snapshot, evidence);
  const evidenceRefs = refs([...area.evidenceRefs, ...(evidence?.incrementalEffect?.evidenceRefs ?? []), ...(evidence?.addressableUpside?.evidenceRefs ?? [])]);
  const factRefs = area.evidenceRefs.length ? refs(area.evidenceRefs) : [];
  const assumptions = impact.contributionProfit.state === "UNKNOWN"
    ? [{ assumptionId: safe("assumption.effect." + template.templateId), statement: "The intervention may affect the proposed mechanism, but incremental contribution impact is not established.", validationNeeded: impact.contributionProfit.evidenceNeeded.join("; ") }]
    : [];
  const facts = factRefs.length
    ? [{ factId: safe("fact.area." + area.code), statement: area.summary, evidenceRefs: factRefs }]
    : [];
  const cost = estimateCost(evidence);
  const timeToImpact = estimateTimeToImpact(evidence);
  const uncertainty = impact.confidence === "HIGH" ? "LOW" as const : impact.confidence === "MEDIUM" ? "MEDIUM" as const : impact.confidence === "LOW" ? "HIGH" as const : "UNKNOWN" as const;
  return {
    version: OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: "opp_" + safe(area.code + "." + template.templateId),
    areaId: area.areaId,
    merchantId: safe(snapshot.merchantId),
    createdAt,
    domain: template.domain,
    title: template.title,
    status: opportunityStatus(impact, feasible, target, parameters),
    intervention: {
      templateId: safe(template.templateId),
      actionType: safe(template.actionType),
      target,
      parameters,
      mechanism: mechanismFor(template),
      requiredResources: refs(hint?.requiredResources ?? []),
    },
    impact,
    constraints: checks,
    feasibility: feasible,
    consequences: buildConsequences(template, evidence),
    conflicts: [conflictKey(template, target)],
    mutuallyExclusiveGroup: safe("choice." + area.areaId),
    prioritization: {
      expectedContributionImpact: impact.contributionProfit,
      uncertainty,
      cost,
      effort: template.effort,
      reversibility: template.reversibility,
      timeToImpact,
      risk: template.risk,
      dependencies: [],
    },
    measurement: {
      primaryMetric: safe(template.primaryMetric),
      secondaryMetrics: refs(template.secondaryMetrics),
      guardrailMetrics: refs(template.guardrailMetrics),
      baseline: measurementBaseline(snapshot, template.primaryMetric),
      horizon: { amount: template.horizonDays, unit: "DAY" },
      successDirection: template.successDirection,
      evidenceRequired: ["Authoritative post-intervention " + template.primaryMetric + " evidence over the declared horizon"],
    },
    rollbackConditions: [
      { kind: "HARD_CONSTRAINT_VIOLATION", action: template.reversibility === "NONE" ? "STOP" : "ROLLBACK" },
      { kind: "EVIDENCE_INVALIDATED", action: "RECONSIDER" },
      ...template.guardrailMetrics.map((metricId) => ({
        kind: "GUARDRAIL_BREACH" as const,
        metricRef: safe(metricId),
        policyRef: safe("merchant.rollback." + metricId),
        action: template.reversibility === "NONE" ? "STOP" as const : "ROLLBACK" as const,
      })),
    ],
    evidence: {
      diagnosisRefs: refs(area.diagnosisRefs),
      businessStateEvidenceRefs: refs(area.evidenceRefs),
      estimationEvidenceRefs: evidenceRefs,
      facts,
      assumptions,
    },
  };
}

function noAction(snapshot: BusinessStateSnapshot, createdAt: string, evidenceComplete: boolean): Opportunity {
  const reason = evidenceComplete
    ? "No-action remains available when the expected value of acting is unclear."
    : "Gather more evidence before committing to an intervention.";
  const unknownMoney = unknownEstimate("MONEY", "No incremental impact is claimed for the no-action option", ["Future observed evidence"]);
  return {
    version: OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: "opp_no_action",
    areaId: "area_no_action",
    merchantId: safe(snapshot.merchantId),
    createdAt,
    domain: "NO_ACTION",
    title: evidenceComplete ? "Do nothing yet" : "Gather more evidence before acting",
    status: "NO_ACTION",
    intervention: {
      templateId: "no_action",
      actionType: evidenceComplete ? "no_op.do_nothing" : "no_op.wait_observe",
      target: { state: "RESOLVED", kind: "MERCHANT", ref: safe(snapshot.merchantId) },
      parameters: { state: "NOT_APPLICABLE" },
      mechanism: {
        primaryLever: "MEASUREMENT_QUALITY",
        steps: [
          { from: "no_action", to: "evidence_quality", relation: "MEASURES" },
          { from: "evidence_quality", to: "contribution_profit", relation: "ENABLES" },
        ],
        terminalOutcome: "contribution_profit",
      },
      requiredResources: [],
    },
    impact: {
      addressableUpside: unknownMoney,
      responseCurve: { state: "UNKNOWN", inputMetric: "time", outputMetric: "evidence_quality", reason: "No response is assumed for no-action", evidenceNeeded: ["Future evidence"] },
      incrementalRevenue: unknownMoney,
      grossProfit: unknownMoney,
      contributionProfit: unknownMoney,
      incrementalCustomers: unknownEstimate("COUNT", "No incremental customers claimed", ["Future evidence"]),
      conversionRateChange: unknownEstimate("RATIO", "No conversion change claimed", ["Future evidence"]),
      inventoryChange: unknownEstimate("UNITS", "No inventory change claimed", ["Future evidence"]),
      retentionChange: unknownEstimate("RATIO", "No retention change claimed", ["Future evidence"]),
      cacChange: unknownMoney,
      cashRequirement: { state: "ESTIMATED", unit: "MONEY", low: 0, base: 0, high: 0, evidenceRefs: ["policy.no_action"], method: "ACCOUNTING" },
      confidence: "UNKNOWN",
      uncertaintyReasons: [reason],
    },
    constraints: [],
    feasibility: { status: "FEASIBLE", requiredCapabilities: [], missingCapabilities: [], reasons: [] },
    consequences: (["CANNIBALIZATION", "CROSS_CHANNEL", "INVENTORY", "CUSTOMER", "PROMOTION", "OPERATIONAL"] as const).map((dimension) => ({ dimension, state: "NOT_APPLICABLE", direction: "NEUTRAL", evidenceRefs: [], notes: [] })),
    conflicts: [],
    prioritization: {
      expectedContributionImpact: unknownMoney,
      uncertainty: "UNKNOWN",
      cost: { state: "ESTIMATED", unit: "MONEY", low: 0, base: 0, high: 0, evidenceRefs: ["policy.no_action"], method: "ACCOUNTING" },
      effort: "LOW",
      reversibility: "FULL",
      timeToImpact: unknownEstimate("DAYS", "No intervention impact horizon applies", ["Future evidence"]),
      risk: "LOW",
      dependencies: [],
    },
    measurement: {
      primaryMetric: "evidence_quality",
      secondaryMetrics: [],
      guardrailMetrics: [],
      baseline: { state: "UNKNOWN", reason: "No canonical evidence-quality baseline is required for no-action" },
      horizon: { amount: 7, unit: "DAY" },
      successDirection: "OBSERVE",
      evidenceRequired: [reason],
    },
    rollbackConditions: [{ kind: "EVIDENCE_INVALIDATED", action: "RECONSIDER" }],
    evidence: { diagnosisRefs: [], businessStateEvidenceRefs: [], estimationEvidenceRefs: [], facts: [], assumptions: [] },
  };
}

function wireDependencies(opportunities: Opportunity[], areas: readonly OpportunityArea[]): Opportunity[] {
  const conversionDecline = areas.some((item) => item.code === "conversion_decline");
  if (!conversionDecline) return opportunities;
  const checkout = opportunities.find((item) => item.intervention.templateId === "cro.checkout_fix");
  if (!checkout) return opportunities;
  return opportunities.map((item) => {
    if (item.intervention.templateId !== "paid.scale_incremental") return item;
    return {
      ...item,
      prioritization: {
        ...item.prioritization,
        dependencies: [checkout.opportunityId],
      },
      rollbackConditions: [
        ...item.rollbackConditions,
        { kind: "DEPENDENCY_FAILED" as const, dependencyRef: checkout.opportunityId, action: "STOP" as const },
      ],
    };
  });
}

export function generateOpportunities(input: OpportunityEngineInput): OpportunitySet {
  const snapshot = businessStateSnapshotSchema.parse(input.snapshot);
  const hints = (input.candidateHints ?? []).map((item) => hintSchema.parse(item));
  const evidence = (input.estimateEvidence ?? []).map((item) => opportunityEstimateEvidenceSchema.parse(item));
  const hintByTemplate = new Map(hints.map((item) => [item.templateId, item]));
  const evidenceByTemplate = new Map(evidence.map((item) => [item.templateId, item]));
  const areas = deriveOpportunityAreas(snapshot, input.diagnosis);
  const generated = areas.flatMap((opportunityArea) =>
    templatesForArea(opportunityArea.code).map((template) =>
      buildOpportunity(
        opportunityArea,
        template,
        snapshot,
        snapshot.asOf,
        hintByTemplate.get(template.templateId),
        evidenceByTemplate.get(template.templateId),
        input.supportedActionTypes,
      ),
    ),
  );
  const opportunities = wireDependencies([...generated, noAction(snapshot, snapshot.asOf, snapshot.evidenceComplete)], areas);
  return opportunitySetSchema.parse({
    engineVersion: OPPORTUNITY_ENGINE_VERSION,
    merchantId: safe(snapshot.merchantId),
    asOf: snapshot.asOf,
    areas,
    opportunities,
    evidenceComplete: snapshot.evidenceComplete && !opportunities.some((item) => item.status === "INSUFFICIENT_EVIDENCE"),
  });
}

export function availableOpportunityTemplates(): readonly OpportunityTemplate[] {
  return OPPORTUNITY_TEMPLATES;
}
