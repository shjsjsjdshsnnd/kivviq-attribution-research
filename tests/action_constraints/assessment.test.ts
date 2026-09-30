import { describe, expect, it } from "vitest";
import {
  assessHardConstraints,
  constraintAssessmentContextSchema,
  type HardConstraint,
} from "../../src/action_constraints/index.js";

const at = "2026-09-27T12:00:00Z";
const identity = { actionId: "action.price", actionFingerprint: "fp-price" };
const target = { kind: "SKU" as const, ref: "sku.boot" };
const common = {
  evaluationBoundary: "TRANSLATION_TIME" as const,
  whenUnknown: "INELIGIBLE" as const,
};
const receipt = (overrides: Record<string, unknown> = {}) => ({
  evidenceRef: "evidence.price",
  actionId: identity.actionId,
  actionFingerprint: identity.actionFingerprint,
  constraintId: "floor",
  target,
  evaluationBoundary: "TRANSLATION_TIME" as const,
  observedAt: at,
  sourceRef: "catalog.snapshot",
  provenance: ["catalog:2026-09-27"],
  fact: {
    kind: "VALUE" as const,
    valueRef: { kind: "FACT" as const, ref: "projected.price" },
    valueBasis: "PROJECTED_AFTER_ACTION" as const,
    value: { valueType: "MONEY" as const, amountMinor: 8500, currency: "CAD" },
  },
  ...overrides,
});
const floor: HardConstraint = {
  ...common,
  constraintId: "floor",
  kind: "PRICE_FLOOR",
  target,
  valueBasis: "PROJECTED_AFTER_ACTION",
  comparator: "GTE",
  threshold: { valueType: "MONEY", amountMinor: 8000, currency: "CAD" },
  observedValue: { kind: "FACT", ref: "projected.price" },
};

describe("assessHardConstraints", () => {
  it("derives a satisfied resulting-state assessment from exactly bound evidence", () => {
    const report = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [receipt()] },
    );
    expect(report).toMatchObject({ ...identity, evaluatedAt: at, valid: true });
    expect(report.assessments).toEqual([
      expect.objectContaining({
        constraintId: "floor",
        status: "SATISFIED",
        targetRef: "SKU:sku.boot",
        evaluationBoundary: "TRANSLATION_TIME",
        evidenceRefs: ["evidence.price"],
        provenance: ["catalog:2026-09-27"],
        observedValue: { valueType: "MONEY", amountMinor: 8500, currency: "CAD" },
      }),
    ]);
  });

  it.each([
    ["actionId", "other"],
    ["actionFingerprint", "wrong"],
    ["constraintId", "other"],
    ["target", { kind: "SKU", ref: "other" }],
    ["evaluationBoundary", "DECISION_TIME"],
  ])("does not use evidence with mismatched %s binding", (key, value) => {
    const report = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [receipt({ [key]: value })] },
    );
    expect(report.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "MISSING_BOUND_EVIDENCE" });
  });

  it("treats future and stale receipts as unknown", () => {
    const future = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, maximumAgeSeconds: 60, receipts: [receipt({ observedAt: "2026-09-27T12:00:01Z" })] },
    );
    const stale = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, maximumAgeSeconds: 60, receipts: [receipt({ observedAt: "2026-09-27T11:58:59Z" })] },
    );
    expect(future.assessments[0]?.reasonCode).toBe("FUTURE_EVIDENCE");
    expect(stale.assessments[0]?.reasonCode).toBe("STALE_EVIDENCE");
  });

  it("uses the stricter freshness limit when context and receipt both define one", () => {
    const observedAt = "2026-09-27T11:58:30Z";
    const contextStricter = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, maximumAgeSeconds: 60, receipts: [receipt({ observedAt, maximumAgeSeconds: 120 })] },
    );
    const receiptStricter = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, maximumAgeSeconds: 120, receipts: [receipt({ observedAt, maximumAgeSeconds: 60 })] },
    );
    expect(contextStricter.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "STALE_EVIDENCE" });
    expect(receiptStricter.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "STALE_EVIDENCE" });
  });

  it("fails closed for duplicate exact bindings regardless of receipt order", () => {
    const satisfied = receipt({ evidenceRef: "evidence.high" });
    const violated = receipt({
      evidenceRef: "evidence.low",
      fact: {
        ...receipt().fact,
        value: { valueType: "MONEY", amountMinor: 7000, currency: "CAD" },
      },
    });
    for (const receipts of [[satisfied, violated], [violated, satisfied]]) {
      const report = assessHardConstraints(
        { ...identity, constraints: [floor], resourceRequirements: [] },
        { evaluatedAt: at, receipts },
      );
      expect(report.assessments[0]).toMatchObject({
        status: "UNKNOWN",
        reasonCode: "AMBIGUOUS_BOUND_EVIDENCE",
        evidenceRefs: ["evidence.high", "evidence.low"],
      });
    }
  });

  it("rejects duplicate evidence identities and provenance entries", () => {
    expect(() => constraintAssessmentContextSchema.parse({
      evaluatedAt: at,
      receipts: [receipt(), receipt({ constraintId: "other" })],
    })).toThrow(/Duplicate evidenceRef/);
    expect(() => constraintAssessmentContextSchema.parse({
      evaluatedAt: at,
      receipts: [receipt({ provenance: ["source.same", "source.same"] })],
    })).toThrow(/Duplicate provenance/);
  });

  it("reports a literal contradiction even when a caller includes a status claim", () => {
    const low = receipt({
      status: "SATISFIED",
      fact: { ...receipt().fact, value: { valueType: "MONEY", amountMinor: 7000, currency: "CAD" } },
    });
    const report = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [low] },
    );
    expect(report.valid).toBe(false);
    expect(report.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "INVALID_EVIDENCE_CONTEXT" });
  });

  it("distinguishes missing facts from incompatible currency and basis", () => {
    const missing = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [] },
    );
    const currency = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [receipt({ fact: { ...receipt().fact, value: { valueType: "MONEY", amountMinor: 9000, currency: "USD" } } })] },
    );
    const basis = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [receipt({ fact: { ...receipt().fact, valueBasis: "CURRENT_STATE" } })] },
    );
    expect(missing.assessments[0]?.reasonCode).toBe("MISSING_BOUND_EVIDENCE");
    expect(currency.assessments[0]).toMatchObject({ status: "VIOLATED", reasonCode: "INCOMPATIBLE_VALUE" });
    expect(basis.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "MISSING_COMPARABLE_FACT" });
  });

  it("compares budget, inventory and capacity requirements with typed availability", () => {
    const constraints: HardConstraint[] = [
      { ...common, constraintId: "budget", kind: "AVAILABLE_BUDGET", target: { kind: "CHANNEL", ref: "meta" }, resourceRequirementId: "spend", availableValue: { kind: "METRIC", ref: "available.spend" } },
      { ...common, constraintId: "inventory", kind: "INVENTORY_AVAILABILITY", target, resourceRequirementId: "units", availableValue: { kind: "FACT", ref: "available.units" } },
      { ...common, constraintId: "capacity", kind: "OPERATIONAL_CAPACITY", target: { kind: "RESOURCE", ref: "warehouse" }, resourceRequirementId: "hours", availableValue: { kind: "METRIC", ref: "available.hours" } },
    ];
    const makeResourceReceipt = (constraintId: string, targetValue: object, ref: string, value: object) => receipt({
      evidenceRef: `evidence.${constraintId}`, constraintId, target: targetValue,
      fact: { kind: "VALUE", valueRef: { kind: ref.startsWith("available.spend") || ref.startsWith("available.hours") ? "METRIC" : "FACT", ref }, value },
    });
    const report = assessHardConstraints(
      { ...identity, constraints, resourceRequirements: [
        { resourceRequirementId: "spend", value: { valueType: "MONEY", amountMinor: 1000, currency: "CAD" } },
        { resourceRequirementId: "units", value: { valueType: "QUANTITY", value: 12, unit: "item" } },
        { resourceRequirementId: "hours", value: { valueType: "QUANTITY", value: 8, unit: "hour" } },
      ] },
      { evaluatedAt: at, receipts: [
        makeResourceReceipt("budget", { kind: "CHANNEL", ref: "meta" }, "available.spend", { valueType: "MONEY", amountMinor: 999, currency: "CAD" }),
        makeResourceReceipt("inventory", target, "available.units", { valueType: "QUANTITY", value: 12, unit: "item" }),
        makeResourceReceipt("capacity", { kind: "RESOURCE", ref: "warehouse" }, "available.hours", { valueType: "QUANTITY", value: 10, unit: "hour" }),
      ] },
    );
    expect(report.assessments.map(({ status }) => status)).toEqual(["VIOLATED", "SATISFIED", "SATISFIED"]);
  });

  it("evaluates margins, discounts, channel status, policy and contract decisions", () => {
    const rule = { registryRef: "rules.main", ruleId: "allow", version: "v1", effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: "2027-01-01T00:00:00Z" };
    const constraints: HardConstraint[] = [
      { ...common, constraintId: "margin", kind: "MINIMUM_MARGIN", target, valueBasis: "CURRENT_STATE", comparator: "GTE", threshold: { valueType: "PERCENTAGE", basisPoints: 2000 }, observedValue: { kind: "METRIC", ref: "margin" } },
      { ...common, constraintId: "discount", kind: "MAXIMUM_DISCOUNT", target, valueBasis: "PROJECTED_AFTER_ACTION", comparator: "LTE", threshold: { valueType: "PERCENTAGE", basisPoints: 3000 }, observedValue: { kind: "METRIC", ref: "discount" } },
      { ...common, constraintId: "channel", kind: "CHANNEL_AVAILABILITY", target: { kind: "CHANNEL", ref: "meta" }, availabilityFact: { kind: "FACT", ref: "channel.status" }, expectedStatus: "AVAILABLE" },
      { ...common, constraintId: "policy", kind: "MERCHANT_POLICY", target, rule, expectedDecision: "ALLOW" },
      { ...common, constraintId: "contract", kind: "CONTRACTUAL_RESTRICTION", target, rule: { ...rule, registryRef: "contracts.main" }, expectedDecision: "DENY" },
    ];
    const valueReceipt = (constraintId: string, ref: string, valueBasis: string, value: object, targetValue: object = target) => receipt({ constraintId, evidenceRef: `e.${constraintId}`, target: targetValue, fact: { kind: "VALUE", valueRef: { kind: ref === "channel.status" ? "FACT" : "METRIC", ref }, ...(valueBasis ? { valueBasis } : {}), value } });
    const ruleReceipt = (constraintId: string, registryRef: string, decision: string) => receipt({ constraintId, evidenceRef: `e.${constraintId}`, fact: { kind: "RULE_DECISION", rule: { ...rule, registryRef }, decision } });
    const report = assessHardConstraints(
      { ...identity, constraints, resourceRequirements: [] },
      { evaluatedAt: at, receipts: [
        valueReceipt("margin", "margin", "CURRENT_STATE", { valueType: "PERCENTAGE", basisPoints: 2500 }),
        valueReceipt("discount", "discount", "PROJECTED_AFTER_ACTION", { valueType: "PERCENTAGE", basisPoints: 3500 }),
        valueReceipt("channel", "channel.status", "", { valueType: "STATUS", status: "UNAVAILABLE" }, { kind: "CHANNEL", ref: "meta" }),
        ruleReceipt("policy", "rules.main", "ALLOW"), ruleReceipt("contract", "contracts.main", "ALLOW"),
      ] },
    );
    expect(report.assessments.map(({ status }) => status)).toEqual(["SATISFIED", "VIOLATED", "VIOLATED", "SATISFIED", "VIOLATED"]);
  });

  it.each(["MERCHANT_POLICY", "CONTRACTUAL_RESTRICTION"] as const)(
    "requires %s evidence observation and evaluation inside the rule interval",
    (kind) => {
      const rule = {
        registryRef: kind === "MERCHANT_POLICY" ? "rules.main" : "contracts.main",
        ruleId: "allow",
        version: "v1",
        effectiveFrom: "2026-09-27T11:00:00Z",
        effectiveUntil: "2026-09-27T13:00:00Z",
      };
      const constraint: HardConstraint = {
        ...common,
        constraintId: "rule-check",
        kind,
        target,
        rule,
        expectedDecision: "ALLOW",
      };
      const decisionReceipt = (observedAt: string) => receipt({
        constraintId: "rule-check",
        observedAt,
        fact: { kind: "RULE_DECISION", rule, decision: "ALLOW" },
      });
      const before = assessHardConstraints(
        { ...identity, constraints: [constraint], resourceRequirements: [] },
        { evaluatedAt: at, receipts: [decisionReceipt("2026-09-27T10:59:59Z")] },
      );
      const atStart = assessHardConstraints(
        { ...identity, constraints: [constraint], resourceRequirements: [] },
        { evaluatedAt: "2026-09-27T11:00:00Z", receipts: [decisionReceipt("2026-09-27T11:00:00Z")] },
      );
      const atEnd = assessHardConstraints(
        { ...identity, constraints: [constraint], resourceRequirements: [] },
        { evaluatedAt: "2026-09-27T13:00:00Z", receipts: [decisionReceipt("2026-09-27T13:00:00Z")] },
      );
      expect(before.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "EVIDENCE_OUTSIDE_RULE_INTERVAL" });
      expect(atStart.assessments[0]?.status).toBe("SATISFIED");
      expect(atEnd.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "RULE_NOT_EFFECTIVE" });
    },
  );

  it("binds risk evidence to its metric, basis, typed threshold and exact horizon", () => {
    const risk: HardConstraint = { ...common, constraintId: "risk", kind: "RISK_LIMIT", target, valueBasis: "PROJECTED_AFTER_ACTION", metricRef: "return.rate", comparator: "LTE", threshold: { valueType: "SCALAR", value: 0.1, unit: "ratio" }, horizon: { amount: 30, unit: "DAY" } };
    const good = receipt({ constraintId: "risk", fact: { kind: "RISK", metricRef: "return.rate", valueBasis: "PROJECTED_AFTER_ACTION", horizon: { amount: 30, unit: "DAY" }, value: { valueType: "SCALAR", value: 0.09, unit: "ratio" } } });
    const goodReport = assessHardConstraints({ ...identity, constraints: [risk], resourceRequirements: [] }, { evaluatedAt: at, receipts: [good] });
    const wrongHorizon = assessHardConstraints({ ...identity, constraints: [risk], resourceRequirements: [] }, { evaluatedAt: at, receipts: [{ ...good, fact: { ...good.fact, horizon: { amount: 7, unit: "DAY" } } }] });
    expect(goodReport.assessments[0]?.status).toBe("SATISFIED");
    expect(wrongHorizon.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "MISSING_COMPARABLE_FACT" });
  });

  it("requires exact registered custom evidence and reports every check in definition order", () => {
    const custom: HardConstraint = { ...common, constraintId: "custom", kind: "CUSTOM", target: { kind: "GLOBAL" }, registryRef: "custom.registry", code: "LEGAL_OK" };
    const unavailable: HardConstraint = { ...common, constraintId: "channel", kind: "CHANNEL_AVAILABILITY", target: { kind: "CHANNEL", ref: "unused" }, availabilityFact: { kind: "FACT", ref: "channel.status" }, expectedStatus: "AVAILABLE" };
    const customEvidence = receipt({ constraintId: "custom", target: { kind: "GLOBAL" }, fact: { kind: "CUSTOM", registryRef: "custom.registry", code: "LEGAL_OK", decision: "SATISFIED" } });
    const report = assessHardConstraints(
      { ...identity, constraints: [custom, unavailable], resourceRequirements: [] },
      { evaluatedAt: at, receipts: [customEvidence] },
    );
    expect(report.assessments.map(({ constraintId, status }) => ({ constraintId, status }))).toEqual([
      { constraintId: "custom", status: "SATISFIED" },
      { constraintId: "channel", status: "UNKNOWN" },
    ]);
  });

  it("fails closed without throwing when the assessment context is malformed", () => {
    expect(() => constraintAssessmentContextSchema.parse({ evaluatedAt: "yesterday", receipts: [] })).toThrow();
    const report = assessHardConstraints(
      { ...identity, constraints: [floor], resourceRequirements: [] },
      { evaluatedAt: "yesterday", receipts: [] },
    );
    expect(report).toMatchObject({ valid: false, errors: expect.any(Array) });
    expect(report.assessments[0]).toMatchObject({ status: "UNKNOWN", reasonCode: "INVALID_EVIDENCE_CONTEXT" });
  });
});
