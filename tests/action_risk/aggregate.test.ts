import { describe, expect, it } from "vitest";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { createCompoundFixtures } from "../../src/compound_action/fixtures.js";
import { fingerprintCompoundAction } from "../../src/compound_action/schema.js";
import {
  describeActionRiskContracts,
  describeCanonicalCompoundRiskContracts,
  describeCompoundRiskContracts,
  describeExperimentRiskContracts,
  validateRiskMeasurementContracts,
  type RiskContractAggregateNode,
} from "../../src/action_risk/index.js";

const base = createCanonicalFixtures().find((fixture) => fixture.action)!.action!;
const sourceDefinitionRef = { registryRef: "risk.sources", code: "observed", version: "1" } as const;
const population = {
  populationId: "population_risk_view", version: 1,
  definitionFingerprint: "fnv1a64:0123456789abcdef",
  binding: "DECISION_TIME" as const, membershipMode: "FROZEN_MEMBERSHIP" as const,
};
const common = { horizon: { amount: 7, unit: "DAY" as const }, aggregation: "INTERVAL" as const, evidencePolicyRef: "policy.observed", sourceDefinitionRef };
function contracts(prefix: string) {
  return {
    FINANCIAL_DOWNSIDE: [{ ...common, measurementId: `${prefix}.financial`, metricRef: "metric.loss", dimension: "FINANCIAL_DOWNSIDE" as const, target: { kind: "GLOBAL" as const }, valueType: { kind: "MONEY" as const, currency: "USD" }, lossBaselineRef: "baseline.loss" }],
    IRREVERSIBILITY: [{ ...common, measurementId: `${prefix}.irreversible`, metricRef: "metric.irreversible", dimension: "IRREVERSIBILITY" as const, target: { kind: "GLOBAL" as const }, valueType: { kind: "PERCENTAGE" as const }, reversibilityContractRef: "reversibility.primary", irreversibleEffectKinds: ["CUSTOMER_EXPOSED" as const], restorationCriterionRef: "criterion.restored" }],
    UNCERTAINTY: [{ ...common, measurementId: `${prefix}.uncertainty`, metricRef: "metric.uncertainty", dimension: "UNCERTAINTY" as const, target: { kind: "GLOBAL" as const }, valueType: { kind: "PERCENTAGE" as const }, uncertainQuantityRef: "quantity.response", uncertaintySource: { kind: "PARAMETER_METRIC" as const, parameterRef: "parameter.response", metricRef: "metric.response" } }],
    INVENTORY_EXPOSURE: [{ ...common, measurementId: `${prefix}.inventory`, metricRef: "metric.inventory", dimension: "INVENTORY_EXPOSURE" as const, inventoryTarget: { productRef: "product.alpha" }, valueType: { kind: "QUANTITY" as const, unit: "units" as const } }],
    CUSTOMER_IMPACT: [{ ...common, measurementId: `${prefix}.customer`, metricRef: "metric.customer", dimension: "CUSTOMER_IMPACT" as const, population, impactFamily: { registryRef: "risk.impact", code: "disruption", version: "1" }, valueType: { kind: "QUANTITY" as const, unit: "customers" as const } }],
    TIME_TO_RECOVERY: [{ ...common, measurementId: `${prefix}.recovery`, metricRef: "metric.recovery", dimension: "TIME_TO_RECOVERY" as const, target: { kind: "GLOBAL" as const }, recoveryBaselineRef: "baseline.recovery", recoveryCriterionRef: "criterion.recovered", startBoundary: "DOWNSIDE_OBSERVED" as const, valueType: { kind: "DURATION" as const, unit: "HOUR" as const } }],
  };
}
const action = (id: string, prefix = id) => ({ ...base, actionId: id, riskDimensions: contracts(prefix) });

function forbiddenKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (/^(score|weight|probability|estimate|expectedLoss|prediction|rank|recommendation|value)$/i.test(key)) return key;
    const child = forbiddenKey(nested);
    if (child) return child;
  }
  return undefined;
}

describe("action risk contract views", () => {
  it("retains all six atomic measurement definitions and exact origin identity without values", () => {
    const member = action("action_risk_atomic");
    const result = describeActionRiskContracts(member);
    expect(result.status).toBe("VALID");
    expect(Object.keys(result.dimensions).sort()).toEqual(["CUSTOMER_IMPACT", "FINANCIAL_DOWNSIDE", "INVENTORY_EXPOSURE", "IRREVERSIBILITY", "TIME_TO_RECOVERY", "UNCERTAINTY"]);
    expect(result.dimensions.FINANCIAL_DOWNSIDE[0]).toMatchObject({
      origin: { kind: "MEMBER", memberPaths: [member.actionId], actionId: member.actionId, actionFingerprint: fingerprintCanonicalAction(member) },
      measurement: { measurementId: "action_risk_atomic.financial", horizon: { amount: 7, unit: "DAY" }, valueType: { kind: "MONEY", currency: "USD" } },
    });
    expect(forbiddenKey(result)).toBeUndefined();
    expect(describeActionRiskContracts({ ...member, riskDimensions: { state: "ABSENT" } }).status).toBe("UNKNOWN");
    expect(validateRiskMeasurementContracts(member).viewFingerprint).toBe(result.viewFingerprint);
    expect(describeActionRiskContracts({ bad: true }).issues).toEqual(["INVALID_ACTION"]);
  });

  it("groups compound definitions by dimension while preserving nested paths and interaction origins", () => {
    const a = action("action_risk_a");
    const b = action("action_risk_b");
    const nested: RiskContractAggregateNode = {
      kind: "COMPOUND", compoundId: "compound_root", members: [
        { componentId: "a", node: { kind: "ACTION", action: a } },
        { componentId: "nested", node: { kind: "COMPOUND", compoundId: "compound_nested", members: [{ componentId: "b", node: { kind: "ACTION", action: b } }] } },
      ],
    };
    const result = describeCompoundRiskContracts(nested, {
      interactions: [{ interactionId: "interaction.shared_customer_harm", memberPaths: ["compound_root/a", "compound_root/nested/b"], measurements: [contracts("interaction").CUSTOMER_IMPACT[0]] }],
    });
    expect(result.status).toBe("VALID");
    expect(result.dimensions.FINANCIAL_DOWNSIDE.map((entry) => entry.origin)).toEqual([
      expect.objectContaining({ memberPaths: ["compound_root/a"] }),
      expect.objectContaining({ memberPaths: ["compound_root/nested/b"] }),
    ]);
    expect(result.dimensions.CUSTOMER_IMPACT).toContainEqual(expect.objectContaining({ origin: { kind: "INTERACTION", interactionId: "interaction.shared_customer_harm", memberPaths: ["compound_root/a", "compound_root/nested/b"] } }));
    expect(result).not.toHaveProperty("total");
    expect(result).not.toHaveProperty("compositeRisk");
    expect(forbiddenKey(result)).toBeUndefined();
  });

  it("rejects repeated execution identities unless one exact alias preserves every path", () => {
    const shared = action("action_risk_shared");
    const node: RiskContractAggregateNode = { kind: "COMPOUND", compoundId: "compound_dup", members: [
      { componentId: "a", node: { kind: "ACTION", action: shared } },
      { componentId: "b", node: { kind: "ACTION", action: shared } },
    ] };
    expect(describeCompoundRiskContracts(node).issues).toContain("DUPLICATE_EXECUTION_IDENTITY");
    const alias = { aliasContractRef: "alias.shared", version: "1", actionId: shared.actionId, actionFingerprint: fingerprintCanonicalAction(shared), paths: ["compound_dup/a", "compound_dup/b"] };
    const result = describeCompoundRiskContracts(node, { aliases: [alias] });
    expect(result.status).toBe("VALID");
    expect(result.dimensions.UNCERTAINTY).toHaveLength(1);
    expect(result.dimensions.UNCERTAINTY[0]!.origin).toMatchObject({ kind: "MEMBER", memberPaths: ["compound_dup/a", "compound_dup/b"] });
    expect(result.audit.aliases).toEqual([alias]);
    expect(describeCompoundRiskContracts(node, { aliases: [alias, { ...alias, aliasContractRef: "alias.other" }] }).issues).toContain("AMBIGUOUS_ALIAS_CONTRACT");
  });

  it("validates interaction paths and only exposes explicit registered aggregation groups", () => {
    const a = action("action_risk_group_a");
    const b = action("action_risk_group_b");
    const node: RiskContractAggregateNode = { kind: "COMPOUND", compoundId: "compound_group", members: [
      { componentId: "a", node: { kind: "ACTION", action: a } }, { componentId: "b", node: { kind: "ACTION", action: b } },
    ] };
    const rule = { registryRef: "risk.aggregation", code: "correlated_loss", version: "1", dimension: "FINANCIAL_DOWNSIDE" as const, origins: [
      { memberPath: "compound_group/a", measurementId: "action_risk_group_a.financial" },
      { memberPath: "compound_group/b", measurementId: "action_risk_group_b.financial" },
    ] };
    const plain = describeCompoundRiskContracts(node);
    expect(plain.aggregationGroups).toEqual([]);
    expect(plain.dimensions.FINANCIAL_DOWNSIDE).toHaveLength(2);
    const registered = describeCompoundRiskContracts(node, { aggregationRules: [rule] });
    expect(registered.status).toBe("VALID");
    expect(registered.aggregationGroups).toEqual([{ ...rule, origins: [...rule.origins].sort((l, r) => l.memberPath.localeCompare(r.memberPath)) }]);
    expect(registered.dimensions.FINANCIAL_DOWNSIDE).toHaveLength(2);
    expect(describeCompoundRiskContracts(node, { interactions: [{ interactionId: "interaction.bad", memberPaths: ["compound_group/a", "missing"], measurements: [contracts("bad").UNCERTAINTY[0]] }] }).issues).toContain("UNKNOWN_INTERACTION_MEMBER_PATH");
  });

  it("fails closed for cycles, duplicate component paths, ambiguous definitions, and malformed runtime input", () => {
    const a = action("action_risk_cycle");
    const cyclic: any = { kind: "COMPOUND", compoundId: "compound_cycle", members: [] };
    cyclic.members.push({ componentId: "self", node: cyclic });
    expect(describeCompoundRiskContracts(cyclic).issues).toContain("EXPANSION_CYCLE");
    const duplicate: any = { kind: "COMPOUND", compoundId: "compound_components", members: [{ componentId: "x", node: { kind: "ACTION", action: a } }, { componentId: "x", node: { kind: "ACTION", action: action("action_other") } }] };
    expect(describeCompoundRiskContracts(duplicate).issues).toContain("DUPLICATE_COMPONENT_ID");
    expect(describeCompoundRiskContracts({ kind: "ACTION", action: a, score: 10 } as any).issues).toContain("INVALID_AGGREGATE_NODE");
    const ambiguous = { ...a, riskDimensions: { ...contracts("ambiguous"), UNCERTAINTY: [contracts("ambiguous").UNCERTAINTY[0], contracts("ambiguous").UNCERTAINTY[0]] } };
    expect(describeActionRiskContracts(ambiguous).status).toBe("INVALID");
    expect(() => describeCompoundRiskContracts(new Proxy({}, { get() { throw new Error("boom"); } }))).not.toThrow();
  });

  it("accepts canonical compounds without merging component contracts", () => {
    const fixture = createCompoundFixtures()[0]!.action;
    const compound = { ...fixture, components: fixture.components.map((component, index) => ({ ...component, action: action(`action_canonical_${index}`) })) };
    const result = describeCanonicalCompoundRiskContracts(compound);
    expect(result.status).toBe("VALID");
    expect(result.dimensions.TIME_TO_RECOVERY).toHaveLength(compound.components.length);
  });

  it("stratifies experiment arms with allocation metadata and shared setup separately", () => {
    const control = action("action_risk_control");
    const fixture = createCompoundFixtures()[0]!.action;
    const compound = { ...fixture, compoundActionId: "compound_risk_treatment", components: fixture.components.map((component, index) => ({ ...component, action: action(`action_risk_treatment_${index}`) })) };
    const experiment: any = { ...action("action_risk_experiment", "setup"), population, what: {
      actionType: "experiment.run", hypothesisRef: "hypothesis.risk", primaryMetricRef: "metric.primary", randomizationUnit: "CUSTOMER",
      assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, stopping: { kind: "FIXED", sampleTarget: 100 }, measurementWindow: { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" },
      arms: [
        { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 4000 },
        { entityKind: "COMPOUND", armId: "arm_treatment", role: "TREATMENT", compoundActionId: compound.compoundActionId, actionFingerprint: fingerprintCompoundAction(compound), allocationBasisPoints: 6000 },
      ],
    } };
    const result = describeExperimentRiskContracts(experiment, { actions: [control], compounds: [compound] });
    expect(result.status).toBe("VALID");
    expect(result.sharedSetup?.dimensions.FINANCIAL_DOWNSIDE[0]!.measurement.measurementId).toBe("setup.financial");
    expect(result.arms.map(({ armId, role, allocationBasisPoints }) => ({ armId, role, allocationBasisPoints }))).toEqual([
      { armId: "arm_control", role: "CONTROL", allocationBasisPoints: 4000 },
      { armId: "arm_treatment", role: "TREATMENT", allocationBasisPoints: 6000 },
    ]);
    expect(result).not.toHaveProperty("dimensions");
    expect(result).not.toHaveProperty("weightedRisk");
    expect(forbiddenKey(result)).toBeUndefined();
  });

  it("rejects ambiguous or mismatched experiment registry entries deterministically", () => {
    const control = action("action_risk_registry_control");
    const treatment = action("action_risk_registry_treatment");
    const experiment: any = { ...base, actionId: "action_risk_registry_experiment", population, what: {
      actionType: "experiment.run", hypothesisRef: "hypothesis.registry", primaryMetricRef: "metric.primary", randomizationUnit: "CUSTOMER",
      assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" }, stopping: { kind: "FIXED", sampleTarget: 100 }, measurementWindow: { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" },
      arms: [
        { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
        { armId: "arm_treatment", role: "TREATMENT", actionId: treatment.actionId, actionFingerprint: fingerprintCanonicalAction(treatment), allocationBasisPoints: 5000 },
      ],
    } };
    const duplicate = describeExperimentRiskContracts(experiment, { actions: [control, control, treatment] });
    expect(duplicate.issues).toContain("AMBIGUOUS_EXPERIMENT_ARM");
    const reversed = describeExperimentRiskContracts(experiment, { actions: [treatment, control, control] });
    expect(reversed.viewFingerprint).toBe(duplicate.viewFingerprint);
    const changed = { ...control, riskDimensions: contracts("changed") };
    expect(describeExperimentRiskContracts(experiment, { actions: [changed, treatment] }).issues).toContain("EXPERIMENT_ARM_FINGERPRINT_MISMATCH");
    expect(describeExperimentRiskContracts(experiment, { actions: [control, changed, treatment] }).issues).toContain("ACTION_ID_FINGERPRINT_CONFLICT");
    expect(describeExperimentRiskContracts(experiment, { actions: [control], compounds: [], typo: true } as any).issues).toEqual(["INVALID_EXPERIMENT_REGISTRY"]);
    expect(describeExperimentRiskContracts(experiment, { actions: [control] }).status).toBe("UNKNOWN");
  });
});
