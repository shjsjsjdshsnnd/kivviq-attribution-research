import { describe, expect, it } from "vitest";
import {
  googleBudgetUp2000,
  reduceSkuPrice899To849,
} from "../../src/action_translation/fixtures.js";
import { actionId } from "../../src/action_ontology/identity.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
} from "../../src/evaluation/baseline-contract.js";
import {
  buildCanonicalOperatorInput,
  invokeOperatorAtDecision,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import {
  ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
} from "../../src/operator/advertising-heuristics.js";
import {
  CANONICAL_OPERATOR_CAPABILITY_SCHEMA_FINGERPRINT,
  CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
  CANONICAL_OPERATOR_INPUT_SCHEMA_FINGERPRINT,
  CANONICAL_OPERATOR_INTERFACE_SCHEMA_FINGERPRINT,
  CANONICAL_OPERATOR_INTERFACE_VERSION,
  CANONICAL_OPERATOR_METADATA_SCHEMA_FINGERPRINT,
  CANONICAL_OPERATOR_OUTPUT_SCHEMA_FINGERPRINT,
  CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION,
  canonicalInputFingerprint,
  canonicalOperatorDecisionFingerprint,
  conformLegacyOperator,
  ensureCanonicalOperatorV2,
  assertCanonicalOperatorInputV2,
  validateCanonicalDecisionEnvelope,
  type CanonicalOperatorDecisionMetadata,
  type CanonicalOperatorMetadataV2,
  type CanonicalOperatorV2,
} from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { FLAWED_OPTIMIZER_BASELINE_OPERATORS } from "../../src/operator/flawed-optimizers.js";
import { GREEDY_BASELINE_OPERATORS } from "../../src/operator/greedy-operators.js";
import { INVENTORY_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/inventory-heuristics.js";
import { MERCHANDISING_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/merchandising-heuristics.js";
import {
  createMerchantPolicy,
  type MerchantPolicyComponentInput,
} from "../../src/operator/merchant-policy.js";
import { PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/pricing-promotion-heuristics.js";
import { createStatusQuoOperator } from "../../src/operator/status-quo.js";
import type { CanonicalOperator } from "../../src/operator/types.js";
import { operatorFingerprint, stableOperatorJson } from "../../src/operator/identity.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";

function opportunity() {
  return createFixedIntervalDecisionOpportunity(contract, START, 0);
}

function emptyObservation() {
  const o = opportunity();
  return buildOperatorObservationSnapshot(contract, o, []);
}

function emptyAvailability() {
  const o = opportunity();
  return buildActionAvailabilitySnapshot(contract, o, []);
}

function canonicalInput() {
  const o = opportunity();
  const obs = emptyObservation();
  const avail = emptyAvailability();
  return buildCanonicalOperatorInput(
    contract,
    o,
    obs,
    avail,
    toOperatorDecisionInput(o, obs, avail),
  );
}

function emptyComponent(
  domain: "advertising" | "pricing" | "promotions" | "merchandising" | "inventory",
): MerchantPolicyComponentInput {
  return {
    domain,
    coverage: "undefined",
    componentVersion: "1.0.0",
    sourceRef: "merchant-policy-fixture:step3.10:" + domain,
    effectivePeriod: { start: START },
    parameters: { policyKind: "undefined" },
    rules: [],
  };
}

function statusQuoOperator(): CanonicalOperator {
  return createStatusQuoOperator(
    createMerchantPolicy({
      policyId: "merchant-policy:step3.10-conformance",
      policyVersion: "1.1.0",
      description: "Step 3.10 empty STATUS_QUO conformance policy.",
      source: {
        sourceRef: "merchant-policy-fixture:step3.10",
        capturedAt: START,
        description: "Synthetic conformance policy.",
      },
      effectivePeriod: { start: START },
      components: {
        advertising: emptyComponent("advertising"),
        pricing: emptyComponent("pricing"),
        promotions: emptyComponent("promotions"),
        merchandising: emptyComponent("merchandising"),
        inventory: emptyComponent("inventory"),
      },
    }),
  );
}

const EXISTING_OPERATORS: readonly CanonicalOperator[] = [
  DO_NOTHING_OPERATOR,
  statusQuoOperator(),
  ...Object.values(ADVERTISING_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(INVENTORY_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(MERCHANDISING_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(GREEDY_BASELINE_OPERATORS),
  ...Object.values(FLAWED_OPTIMIZER_BASELINE_OPERATORS),
];

function decisionMetadata(
  metadata: CanonicalOperatorMetadataV2,
): CanonicalOperatorDecisionMetadata {
  return {
    interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
    decisionTimestamp: START,
    deterministicReplayExpected:
      metadata.capabilities.randomness.kind === "deterministic",
    randomness: metadata.capabilities.randomness,
    canonicalActionOrdering:
      "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC",
  };
}

describe("Step 3.10 canonical operator interface", () => {
  function inputBindings(input = canonicalInput()) {
    return {
      opportunityId: input.opportunityId,
      decisionTime: input.decisionTime,
      decisionContext: input.decisionContext,
      observationRecords: input.observation.records,
      legalActionSpace: input.legalActionSpace,
      constraints: input.constraints,
      evaluationContractFingerprint: input.provenance.evaluationContractFingerprint,
      evaluationContractVersion: input.provenance.evaluationContractVersion,
      observationFingerprint: input.provenance.observationFingerprint,
      legalActionSpaceFingerprint: input.provenance.legalActionSpaceFingerprint,
      actionOntologyVersion: input.provenance.actionOntologyVersion,
    };
  }

  it("authoritatively validates and freezes an exact canonical input", () => {
    const input = canonicalInput();
    const validated = assertCanonicalOperatorInputV2(input, inputBindings(input));
    expect(validated).toEqual(input);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.legalActionSpace.rules)).toBe(true);
  });

  it.each([
    ["top-level", (input: any) => { input.extra = true; }],
    ["observation", (input: any) => { input.observation.extra = true; }],
    ["Action rule", (input: any) => { input.legalActionSpace.rules = [{ extra: true }]; }],
    ["constraints", (input: any) => { input.constraints.extra = true; }],
    ["provenance", (input: any) => { input.provenance.extra = true; }],
  ])("rejects unknown or malformed %s canonical-input fields", (_label, mutate) => {
    const input = structuredClone(canonicalInput());
    mutate(input);
    expect(() => assertCanonicalOperatorInputV2(input, inputBindings())).toThrow(/canonical operator input/i);
  });

  it("rejects nested binding tampering and provenance fingerprint mismatch", () => {
    const legal = structuredClone(canonicalInput());
    (legal.legalActionSpace as any).rules = [{
      actionType: "advertising.adjust_budget",
      eligibleTargets: [{ kind: "campaign", channelId: "google_ads", campaignId: "tampered" }],
      parameterBounds: [],
      requiredPreconditionIds: [],
    }];
    expect(() => assertCanonicalOperatorInputV2(legal, inputBindings())).toThrow(/binding/i);

    const provenance = structuredClone(canonicalInput());
    (provenance.provenance as any).observationFingerprint = "fnv1a64:0000000000000000";
    expect(() => assertCanonicalOperatorInputV2(provenance, inputBindings())).toThrow(/binding/i);
  });

  it("freezes explicit v2 interface and schema fingerprints", () => {
    expect(CANONICAL_OPERATOR_INTERFACE_VERSION).toBe("2.0.0");
    for (const fingerprint of [
      CANONICAL_OPERATOR_INTERFACE_SCHEMA_FINGERPRINT,
      CANONICAL_OPERATOR_INPUT_SCHEMA_FINGERPRINT,
      CANONICAL_OPERATOR_OUTPUT_SCHEMA_FINGERPRINT,
      CANONICAL_OPERATOR_METADATA_SCHEMA_FINGERPRINT,
      CANONICAL_OPERATOR_CAPABILITY_SCHEMA_FINGERPRINT,
    ]) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }
    expect(CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION).toBe("1.0.0");
  });

  it("builds a structural observable-only input with context, constraints and provenance", () => {
    const input = canonicalInput();
    expect(input.schemaVersion).toBe("1.0.0");
    expect(input.decisionContext).toEqual({
      sequence: 0,
      trigger: { kind: "fixed_interval", intervalIndex: 0 },
    });
    expect(input.constraints.silentModificationForbidden).toBe(true);
    expect(input.provenance).toMatchObject({
      evaluationContractFingerprint: contract.contractFingerprint,
      observationFingerprint: emptyObservation().observationFingerprint,
      legalActionSpaceFingerprint:
        emptyAvailability().availabilityFingerprint,
      actionOntologyVersion: contract.actionSpace.ontologySchemaVersion,
    });
    const serialized = stableOperatorJson(input);
    for (const forbidden of [
      "simulator",
      "groundTruth",
      "futureOutcomes",
      "evaluatorMetrics",
      "latentCustomers",
      "counterfactualOutcomes",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.observation)).toBe(true);
    expect(Object.isFrozen(input.legalActionSpace)).toBe(true);
  });

  describe.each(EXISTING_OPERATORS.map((operator) => [operator.metadata.operatorId, operator] as const))(
    "shared conformance: %s",
    (_operatorId, legacyOperator) => {
      it("conforms through the same v2 boundary without changing frozen identity", () => {
        const canonical = conformLegacyOperator(legacyOperator);
        expect(canonical.metadata.interfaceVersion).toBe("2.0.0");
        expect(canonical.metadata.implementationFingerprint).toBe(
          legacyOperator.metadata.implementationFingerprint,
        );
        expect(canonical.metadata.operatorId).toBe(
          legacyOperator.metadata.operatorId,
        );
        expect(canonical.metadata.configurationFingerprint).toMatch(
          /^fnv1a64:[0-9a-f]{16}$/,
        );
        expect(canonical.metadata.adapterFingerprint).toMatch(
          /^fnv1a64:[0-9a-f]{16}$/,
        );
      });

      it("accepts the same canonical input, cannot mutate it, and returns canonical Action[]", () => {
        const canonical = ensureCanonicalOperatorV2(legacyOperator);
        const input = canonicalInput();
        const before = canonicalInputFingerprint(input);
        const output = canonical.decide(input);
        expect(canonicalInputFingerprint(input)).toBe(before);
        expect(Object.isFrozen(input)).toBe(true);
        expect(output.schemaVersion).toBe(
          CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
        );
        expect(Array.isArray(output.actions)).toBe(true);
        for (const action of output.actions) {
          expect(assertValidAction(action)).toEqual(action);
          expect(
            canonical.metadata.capabilities.actionDomains,
          ).toContain(String(action.actionCategory));
        }
        expect(output.actions.length).toBeLessThanOrEqual(
          canonical.metadata.capabilities.maximumActionsPerDecision,
        );
      });

      it("replays deterministically under identical input", () => {
        const canonical = ensureCanonicalOperatorV2(legacyOperator);
        const input = canonicalInput();
        const first = canonical.decide(input);
        const second = canonical.decide(input);
        expect(canonicalOperatorDecisionFingerprint(first)).toBe(
          canonicalOperatorDecisionFingerprint(second),
        );
        expect(first.actions).toEqual(second.actions);
      });

      it("uses the same evaluator path and records complete v2 provenance", () => {
        const result = invokeOperatorAtDecision(
          contract,
          legacyOperator,
          opportunity(),
          emptyObservation(),
          emptyAvailability(),
        );
        expect(result.invocation.interfaceVersion).toBe("2.0.0");
        expect(result.invocation.operatorId).toBe(
          legacyOperator.metadata.operatorId,
        );
        expect(result.invocation.configurationFingerprint).toMatch(
          /^fnv1a64:[0-9a-f]{16}$/,
        );
        expect(result.invocation.interfaceAdapterFingerprint).toMatch(
          /^fnv1a64:[0-9a-f]{16}$/,
        );
        expect(result.invocation.inputFingerprint).toMatch(
          /^fnv1a64:[0-9a-f]{16}$/,
        );
        expect(result.invocation.outputFingerprint).toMatch(
          /^fnv1a64:[0-9a-f]{16}$/,
        );
      });
    },
  );

  it("supports zero, one and multiple canonical Actions with deterministic ordering", () => {
    const canonical = conformLegacyOperator(
      GREEDY_BASELINE_OPERATORS.IMMEDIATE_REVENUE,
    );
    const metadata: CanonicalOperatorMetadataV2 = {
      ...canonical.metadata,
      operatorId: "decision-system.synthetic.multi-action",
      operatorVersion: "1.0.0",
      operatorFamily: "advanced_decision_system",
      implementationFingerprint: operatorFingerprint({
        implementation: "synthetic multi action",
      }),
      configurationFingerprint: operatorFingerprint({
        configuration: "synthetic",
      }),
      capabilities: {
        ...canonical.metadata.capabilities,
        actionDomains: ["advertising", "pricing"],
        maximumActionsPerDecision: 4,
      },
      adapterFingerprint: operatorFingerprint({
        adapter: "native-v2-synthetic",
      }),
    };
    const input = canonicalInput();

    const ordered = [googleBudgetUp2000, reduceSkuPrice899To849];
    const valid = validateCanonicalDecisionEnvelope(input, metadata, {
      schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
      actions: ordered,
      operatorMetadata: metadata,
      decisionMetadata: decisionMetadata(metadata),
    });
    expect(valid.actions).toEqual(ordered);

    expect(() =>
      validateCanonicalDecisionEnvelope(input, metadata, {
        schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
        actions: [...ordered].reverse(),
        operatorMetadata: metadata,
        decisionMetadata: decisionMetadata(metadata),
      }),
    ).toThrow(/canonical deterministic ordering/);
  });

  it("rejects malformed envelopes, duplicate Actions, conflicts, invalid Actions, non-finite values and capability violations", () => {
    const input = canonicalInput();
    const pricingCanonical = conformLegacyOperator(
      PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS.FIXED_DISCOUNT,
    );
    const pricingMetadata = pricingCanonical.metadata;

    const baseEnvelope = {
      schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
      actions: [reduceSkuPrice899To849],
      operatorMetadata: pricingMetadata,
      decisionMetadata: decisionMetadata(pricingMetadata),
    };

    expect(() =>
      validateCanonicalDecisionEnvelope(input, pricingMetadata, {
        ...baseEnvelope,
        extra: true,
      }),
    ).toThrow(/unsupported field/);

    expect(() =>
      validateCanonicalDecisionEnvelope(input, pricingMetadata, {
        ...baseEnvelope,
        actions: [reduceSkuPrice899To849, reduceSkuPrice899To849],
      }),
    ).toThrow(/duplicate/);

    const conflicting = assertValidAction({
      ...reduceSkuPrice899To849,
      actionId: actionId("action_step310_conflicting_price"),
      parameters: {
        kind: "price_adjustment",
        operation: {
          kind: "SET",
          value: {
            kind: "money",
            amountMinor: 79_900,
            currency: "CAD",
          },
        },
      },
    });

    expect(() =>
      validateCanonicalDecisionEnvelope(input, pricingMetadata, {
        ...baseEnvelope,
        actions: [reduceSkuPrice899To849, conflicting],
      }),
    ).toThrow(/conflicting Actions/);

    const invalidTarget = {
      ...reduceSkuPrice899To849,
      target: {
        kind: "sku",
        productId: "product:A",
        skuId: "",
      },
    };
    expect(() =>
      validateCanonicalDecisionEnvelope(input, pricingMetadata, {
        ...baseEnvelope,
        actions: [invalidTarget],
      }),
    ).toThrow();

    const nonFinite = {
      ...reduceSkuPrice899To849,
      parameters: {
        kind: "price_adjustment",
        operation: {
          kind: "SET",
          value: {
            kind: "money",
            amountMinor: Number.NaN,
            currency: "CAD",
          },
        },
      },
    };
    expect(() =>
      validateCanonicalDecisionEnvelope(input, pricingMetadata, {
        ...baseEnvelope,
        actions: [nonFinite],
      }),
    ).toThrow();

    expect(() =>
      validateCanonicalDecisionEnvelope(input, pricingMetadata, {
        ...baseEnvelope,
        actions: [googleBudgetUp2000],
      }),
    ).toThrow(/undeclared Action domain/);
  });

  it("supports a native future advanced operator through the exact same evaluator path", () => {
    const legacy = conformLegacyOperator(DO_NOTHING_OPERATOR);
    const metadata: CanonicalOperatorMetadataV2 = {
      ...legacy.metadata,
      operatorId: "decision-system.future-kivviq",
      operatorVersion: "1.0.0",
      operatorFamily: "advanced_decision_system",
      description: "Synthetic future advanced operator conformance fixture.",
      legacyInterfaceVersion: null,
      implementationFingerprint: operatorFingerprint({
        implementation: "future advanced v2",
      }),
      configurationFingerprint: operatorFingerprint({
        configuration: "future advanced v2",
      }),
      capabilities: {
        ...legacy.metadata.capabilities,
        actionDomains: [
          "advertising",
          "pricing",
          "promotion",
          "inventory",
          "merchandising",
        ],
        maximumActionsPerDecision: 16,
      },
      adapterFingerprint: operatorFingerprint({
        adapter: "native-v2",
      }),
    };

    const future: CanonicalOperatorV2 = {
      metadata,
      decide(input) {
        return {
          schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
          actions: [],
          operatorMetadata: metadata,
          decisionMetadata: {
            interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
            decisionTimestamp: input.decisionTime,
            deterministicReplayExpected: true,
            randomness: { kind: "deterministic" },
            canonicalActionOrdering:
              "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC",
          },
        };
      },
    };

    const operators = [
      DO_NOTHING_OPERATOR,
      statusQuoOperator(),
      FLAWED_OPTIMIZER_BASELINE_OPERATORS.MAX_ROAS,
      FLAWED_OPTIMIZER_BASELINE_OPERATORS.HIGHEST_CONVERSION_RATE,
      future,
    ];

    for (const operator of operators) {
      const result = invokeOperatorAtDecision(
        contract,
        operator,
        opportunity(),
        emptyObservation(),
        emptyAvailability(),
      );
      expect(result.invocation.interfaceVersion).toBe("2.0.0");
      expect(result.decisionRecord.actionAttempts).toEqual([]);
    }
  });

  it("keeps constraint validation evaluator-owned rather than exposing an executor to operators", () => {
    const input = canonicalInput() as unknown as Record<string, unknown>;
    expect(input["constraintAssessor"]).toBeUndefined();
    expect(input["simulator"]).toBeUndefined();
    expect(input["executeAction"]).toBeUndefined();
    expect(input["outcomes"]).toBeUndefined();
    expect(input["evaluatorMetrics"]).toBeUndefined();
  });
});
