import { describe, expect, it } from "vitest";
import {
  validateActionSpaceDecision,
  validateActionSpacePortfolio,
} from "../../src/action_validation/index.js";
import {
  measurableCanonicalActionSchema,
} from "../../src/canonical_action/schema.js";
import {
  fingerprintCanonicalAction,
} from "../../src/canonical_action/serialization.js";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import {
  measurableCompoundActionSchema,
} from "../../src/compound_action/schema.js";
import {
  translateCanonicalAction,
} from "../../src/action_translation/canonical.js";
import {
  translateBusinessAction,
} from "../../src/action_translation/translate.js";
import {
  fullTranslationContext,
  increaseGoogleShoppingBudget20,
  pauseUnderperformingMetaCampaign,
  reduceSkuPrice899To849,
  runCollectionPromotion15FourDays,
  unsupportedPageChangeAction,
} from "../../src/action_translation/fixtures.js";
import {
  evaluateEligibilityForTest,
  withTranslationEligibility,
} from "../action_translation/eligibility-helper.js";

const NOW = "2026-09-27T00:00:00Z";
const LEGACY_NOW = "2026-09-21T13:00:00Z";

const AUTHOR_FINGERPRINT = "fnv1a64:0123456789abcdef";
const authorCharacteristics = {
  implementationCost: [
    {
      lineItemId: "cost.validation",
      category: "LABOR" as const,
      amount: {
        state: "KNOWN" as const,
        value: { amountMinor: 100, currency: "CAD" },
      },
    },
  ],
  reversibility: {
    kind: "FULLY_REVERSIBLE" as const,
    reversal: {
      kind: "ACTION" as const,
      actionId: "action_generated_reverse",
      actionFingerprint: AUTHOR_FINGERPRINT,
    },
  },
  cancellationCosts: [
    {
      stage: "BEFORE_START" as const,
      cancellationAvailable: true,
      cancellationCost: [],
      compensationCost: [],
      operationalBurden: [],
    },
  ],
  operationalBurden: [],
};

const authorRiskCommon = {
  horizon: { amount: 7, unit: "DAY" as const },
  aggregation: "INTERVAL" as const,
  evidencePolicyRef: "policy.observed",
  sourceDefinitionRef: {
    registryRef: "risk.sources",
    code: "validation",
    version: "1",
  },
};

const authorRiskPopulation = {
  populationId: "population_validation",
  version: 1,
  definitionFingerprint: AUTHOR_FINGERPRINT,
  binding: "DECISION_TIME" as const,
  membershipMode: "FROZEN_MEMBERSHIP" as const,
  snapshotRef: "snapshot_validation",
};

const authorRiskDimensions = {
  FINANCIAL_DOWNSIDE: [
    {
      ...authorRiskCommon,
      measurementId: "risk.financial",
      metricRef: "metric.loss",
      dimension: "FINANCIAL_DOWNSIDE" as const,
      target: { kind: "GLOBAL" as const },
      valueType: { kind: "MONEY" as const, currency: "CAD" },
      lossBaselineRef: "baseline.financial",
    },
  ],
  IRREVERSIBILITY: [
    {
      ...authorRiskCommon,
      measurementId: "risk.irreversible",
      metricRef: "metric.irreversible",
      dimension: "IRREVERSIBILITY" as const,
      target: { kind: "GLOBAL" as const },
      valueType: { kind: "PERCENTAGE" as const },
      reversibilityContractRef: "characteristics.reversibility",
      irreversibleEffectKinds: ["CUSTOMER_EXPOSED" as const],
      restorationCriterionRef: "criterion.restored",
    },
  ],
  UNCERTAINTY: [
    {
      ...authorRiskCommon,
      measurementId: "risk.uncertainty",
      metricRef: "metric.uncertainty",
      dimension: "UNCERTAINTY" as const,
      target: { kind: "GLOBAL" as const },
      valueType: { kind: "PERCENTAGE" as const },
      uncertainQuantityRef: "quantity.response",
      uncertaintySource: {
        kind: "PARAMETER_METRIC" as const,
        parameterRef: "parameter.response",
        metricRef: "metric.response",
      },
    },
  ],
  INVENTORY_EXPOSURE: [
    {
      ...authorRiskCommon,
      measurementId: "risk.inventory",
      metricRef: "metric.inventory",
      dimension: "INVENTORY_EXPOSURE" as const,
      inventoryTarget: { productRef: "product.alpha" },
      valueType: { kind: "QUANTITY" as const, unit: "units" as const },
    },
  ],
  CUSTOMER_IMPACT: [
    {
      ...authorRiskCommon,
      measurementId: "risk.customer",
      metricRef: "metric.customer",
      dimension: "CUSTOMER_IMPACT" as const,
      population: authorRiskPopulation,
      impactFamily: {
        registryRef: "risk.customer",
        code: "disruption",
        version: "1",
      },
      valueType: { kind: "QUANTITY" as const, unit: "customers" as const },
    },
  ],
  TIME_TO_RECOVERY: [
    {
      ...authorRiskCommon,
      measurementId: "risk.recovery",
      metricRef: "metric.recovery",
      dimension: "TIME_TO_RECOVERY" as const,
      target: { kind: "GLOBAL" as const },
      recoveryBaselineRef: "baseline.recovery",
      recoveryCriterionRef: "criterion.recovery",
      startBoundary: "ACTION_EFFECTIVE" as const,
      valueType: { kind: "DURATION" as const, unit: "HOUR" as const },
    },
  ],
};

function plan(id: string, days = 14) {
  return {
    schemaVersion: 1 as const,
    outcomes: [
      {
        outcomeId: id,
        family: "CONTRIBUTION_PROFIT" as const,
        metricRef: "metric.contribution_profit",
        role: "PRIMARY" as const,
        valueType: { kind: "MONEY" as const, currency: "CAD" },
        comparison: {
          kind: "PRE_ACTION_BASELINE" as const,
          baselineRef: "baseline.pre_action",
        },
        successCriterion: {
          kind: "DIRECTIONAL" as const,
          direction: "INCREASE" as const,
        },
        measurementWindow: {
          anchor: "ACTION_EFFECTIVE" as const,
          earliestMeaningful: { amount: 1, unit: "DAY" as const },
          primaryEvaluation: { amount: days, unit: "DAY" as const },
          longTermFollowUp: {
            amount: Math.max(8, Math.ceil(days / 7) + 2),
            unit: "WEEK" as const,
          },
        },
        sourceDefinitionRef: {
          registryRef: "metric_registry",
          code: "contribution_profit",
          version: "1.0.0",
        },
        evidencePolicyRef: "evidence_policy.contribution_profit",
      },
    ],
  };
}

function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function rawAction(index: number, days = 14) {
  return {
    schemaVersion: "2.0.0" as const,
    actionId: "action_generated_" + index,
    what: {
      actionType: "no_op.do_nothing" as const,
      scope: { kind: "GLOBAL" as const },
    },
    timing: immediatePersistentBudgetTiming,
    characteristics: {
      state: "PRESENT" as const,
      value: authorCharacteristics,
    },
    riskDimensions: authorRiskDimensions,
    outcomePlan: plan("generated.primary." + index, days),
    provenance: ["generator.step24"],
  };
}

function compound(index: number) {
  return {
    schemaVersion: 1 as const,
    kind: "compound_action" as const,
    compoundActionId: "compound_generated_" + index,
    components: [rawAction(index * 2), rawAction(index * 2 + 1)].map(
      (action, componentIndex) => ({
        componentId: "component_" + componentIndex,
        role: "ROLE_" + componentIndex,
        action,
      }),
    ),
    ordering: "UNORDERED" as const,
    concurrency: "INDEPENDENT_TIMING" as const,
    dependencies: [],
    atomicity: "BEST_EFFORT" as const,
    failurePolicy: "STOP_REMAINING" as const,
    rollbackPolicy: "ROLLBACK_ALL_REVERSIBLE_COMPONENTS" as const,
    constraints: [],
    populationRelationships: [],
    measurementHorizon: { amount: 14, unit: "DAY" as const },
    outcomePlan: plan("compound.primary." + index),
    provenance: ["generator.step24"],
  };
}

function portfolioContext(
  actions: readonly ReturnType<typeof measurableCanonicalActionSchema.parse>[],
) {
  return {
    evaluatedAt: NOW,
    evaluationBoundary: "TRANSLATION_TIME" as const,
    maximumAgeSeconds: 3600,
    horizonEnd: "2026-10-27T00:00:00Z",
    registry: actions.map((action) => ({
      entityKind: "ACTION" as const,
      action,
    })),
    timingContexts: {},
    scopeIntersectionReceipts: [],
    priceBaselineReceipts: [],
    partitionReceipts: [],
  };
}

function semanticIntervention(value: any) {
  const effectiveTime =
    typeof value.effectiveTime === "string"
      ? Date.parse(value.effectiveTime)
      : value.effectiveTime;
  const endAt =
    value.endCondition?.kind === "fixed_end"
      ? Date.parse(value.endCondition.at)
      : value.endCondition?.kind === "fixed_duration" &&
          typeof effectiveTime === "number"
        ? effectiveTime + value.endCondition.durationSeconds * 1000
        : value.endCondition;
  return {
    interventionType: value.interventionType,
    target: value.target,
    operation: value.operation,
    scope: value.scope,
    effectiveTime,
    duration: value.duration,
    endAt,
  };
}

describe("Step 24 generated Action Space validation", () => {
  it("accepts 3,000 deterministic valid Actions and 1,000 valid portfolios", () => {
    const random = generator(0x23_24_20_26);
    let accepted = 0;
    for (let index = 0; index < 3000; index += 1) {
      const days = 2 + Math.floor(random() * 27);
      const result = validateActionSpaceDecision(rawAction(index, days));
      if (!result.ok)
        throw new Error(
          "Valid generated Action rejected at " +
            index +
            ": " +
            JSON.stringify(result.issues),
        );
      accepted += 1;
    }
    expect(accepted).toBe(3000);

    let portfolios = 0;
    for (let index = 0; index < 1000; index += 1) {
      const base = 10_000 + index * 3;
      const result = validateActionSpacePortfolio([
        rawAction(base),
        rawAction(base + 1),
        rawAction(base + 2),
      ]);
      if (!result.ok)
        throw new Error(
          "Valid generated portfolio rejected at " +
            index +
            ": " +
            JSON.stringify(result.issues),
        );
      portfolios += 1;
    }
    expect(portfolios).toBe(1000);
  }, 20_000);

  it("rejects 1,500 adversarial Actions and malformed compounds", () => {
    const supported = {
      ...adaptLegacyAction(increaseGoogleShoppingBudget20),
      characteristics: {
        state: "PRESENT",
        value: authorCharacteristics,
      },
      riskDimensions: authorRiskDimensions,
      outcomePlan: plan("supported.primary"),
    } as any;
    let rejected = 0;

    for (let index = 0; index < 300; index += 1) {
      const hidden: any = structuredClone(rawAction(20_000 + index));
      hidden.what.groundTruth = {
        actualBestAction: "action_secret",
        optimalValue: index,
      };
      if (!validateActionSpaceDecision(hidden).ok) rejected += 1;
    }

    for (let index = 0; index < 300; index += 1) {
      const badHorizon: any = structuredClone(rawAction(21_000 + index));
      badHorizon.outcomePlan.outcomes[0].measurementWindow.primaryEvaluation = {
        amount: 0,
        unit: "DAY",
      };
      if (!validateActionSpaceDecision(badHorizon).ok) rejected += 1;
    }

    for (let index = 0; index < 300; index += 1) {
      const badTarget: any = structuredClone(supported);
      badTarget.actionId = "action_bad_target_" + index;
      badTarget.what.target = { kind: "campaign" };
      if (!validateActionSpaceDecision(badTarget).ok) rejected += 1;
    }

    for (let index = 0; index < 300; index += 1) {
      const badParameter: any = structuredClone(supported);
      badParameter.actionId = "action_bad_parameter_" + index;
      badParameter.what.parameters.operation.factor = -1 - index;
      if (!validateActionSpaceDecision(badParameter).ok) rejected += 1;
    }

    for (let index = 0; index < 300; index += 1) {
      const malformed: any = structuredClone(compound(30_000 + index));
      malformed.components[1].componentId = malformed.components[0].componentId;
      malformed.dependencies = [
        {
          kind: "START_AFTER",
          componentId: "component_0",
          dependsOn: "component_1",
        },
        {
          kind: "START_AFTER",
          componentId: "component_1",
          dependsOn: "component_0",
        },
      ];
      if (!validateActionSpaceDecision(malformed).ok) rejected += 1;
    }

    expect(rejected).toBe(1500);
  });

  it("requires measurable outcomes on every component of a new compound decision", () => {
    const value: any = structuredClone(compound(40_000));
    delete value.components[1].action.outcomePlan;
    const result = validateActionSpaceDecision(value);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.issues.some((issue) =>
          issue.path.includes("components.1.action.outcomePlan"),
        ),
      ).toBe(true);
  });

  it("rejects duplicate portfolio identities before runtime compatibility", () => {
    const action = rawAction(50_000);
    const result = validateActionSpacePortfolio([action, structuredClone(action)]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "DUPLICATE_PORTFOLIO_DECISION" }],
    });
  });

  it("rejects an explicitly conflicting portfolio using the existing conflict engine", () => {
    const target = measurableCanonicalActionSchema.parse(rawAction(51_000));
    const targetRef = {
      entityKind: "ACTION" as const,
      actionId: target.actionId,
      actionFingerprint: fingerprintCanonicalAction(target),
    };
    const counterparty = measurableCanonicalActionSchema.parse({
      ...rawAction(51_001),
      conflicts: [
        {
          conflictId: "conflict.step24.global",
          kind: "MUTUALLY_EXCLUSIVE_INTENT",
          target: { kind: "GLOBAL" },
          scope: { coordinates: [{ kind: "GLOBAL" }] },
          overlapRule: "EFFECTIVE_OVERLAP",
          counterparty: targetRef,
        },
      ],
    });
    const result = validateActionSpacePortfolio(
      [target, counterparty],
      portfolioContext([target, counterparty]),
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PORTFOLIO_CONFLICT" }],
      compatibility: { validity: "VALID", status: "CONFLICTING" },
    });
  });

  it("rejects a hard constraint violation before any intervention can be emitted", () => {
    const action = measurableCanonicalActionSchema.parse({
      ...rawAction(52_000),
      constraints: [
        {
          constraintId: "constraint.step24.policy",
          kind: "CUSTOM",
          target: { kind: "GLOBAL" },
          evaluationBoundary: "TRANSLATION_TIME",
          whenUnknown: "UNKNOWN",
          registryRef: "merchant_policy",
          code: "ACTION_ALLOWED",
        },
      ],
    });
    const evaluated = evaluateEligibilityForTest(
      action,
      "TRANSLATION_TIME",
      NOW,
      "INELIGIBLE",
    );
    const reference = {
      entityKind: "ACTION" as const,
      actionId: action.actionId,
      actionFingerprint: fingerprintCanonicalAction(action),
    };
    const translated = translateCanonicalAction(action, {
      timing: { approvedClock: NOW },
      eligibilityMaximumAgeSeconds: 3600,
      eligibility: evaluated.eligibility,
      eligibilityEvaluationContext: evaluated.evaluationContext,
      eligibilityResourceRequirements: [],
      portfolioReferences: [reference],
      portfolioCompatibilityContext: portfolioContext([action]),
    });
    expect(translated).toMatchObject({
      status: "INELIGIBLE_ACTION",
      code: "ACTION_INELIGIBLE",
    });
    expect("interventions" in translated).toBe(false);
  });

  it("translates supported measurable Actions deterministically without changing business semantics", () => {
    const supported = [
      increaseGoogleShoppingBudget20,
      reduceSkuPrice899To849,
      runCollectionPromotion15FourDays,
    ];

    for (const [index, historical] of supported.entries()) {
      const action = measurableCanonicalActionSchema.parse({
        ...adaptLegacyAction(historical),
        outcomePlan: plan("translation.primary." + index),
      });
      const context = withTranslationEligibility(action, {
        timing: { approvedClock: LEGACY_NOW },
        simulator: fullTranslationContext,
      });
      const first = translateCanonicalAction(action, context);
      const second = translateCanonicalAction(action, context);
      expect(first).toEqual(second);
      expect(first.status).toBe("TRANSLATED");

      const historicalResult = translateBusinessAction(
        historical,
        fullTranslationContext,
      );
      expect(historicalResult.status).toBe("TRANSLATED");

      if (
        first.status === "TRANSLATED" &&
        historicalResult.status === "TRANSLATED"
      ) {
        expect(first.interventions.map(semanticIntervention)).toEqual(
          historicalResult.interventions.map(semanticIntervention),
        );
      }
    }
  });

  it("preserves the frozen manual-reversal migration boundary", () => {
    expect(() => adaptLegacyAction(pauseUnderperformingMetaCampaign)).toThrow(
      "Legacy manual reversal requires explicit reversal-event timing migration",
    );
  });

  it("returns a deterministic explicit unsupported result instead of approximating semantics", () => {
    const action = measurableCanonicalActionSchema.parse({
      ...adaptLegacyAction(unsupportedPageChangeAction),
      outcomePlan: plan("unsupported.primary"),
    });
    const context = withTranslationEligibility(action, {
      timing: { approvedClock: LEGACY_NOW },
      simulator: fullTranslationContext,
    });
    const first = translateCanonicalAction(action, context);
    const second = translateCanonicalAction(action, context);
    expect(first).toEqual(second);
    expect([
      "UNSUPPORTED_ACTION_TYPE",
      "UNSUPPORTED_SIMULATOR_CAPABILITY",
    ]).toContain(first.status);
    expect("interventions" in first).toBe(false);
  });

  it("translates 500 generated measurable no-op Actions deterministically to zero causal interventions", () => {
    let translated = 0;
    for (let index = 0; index < 500; index += 1) {
      const action = measurableCanonicalActionSchema.parse(
        rawAction(60_000 + index),
      );
      const context = withTranslationEligibility(action, {
        timing: { approvedClock: NOW },
      });
      const first = translateCanonicalAction(action, context);
      const second = translateCanonicalAction(action, context);
      if (JSON.stringify(first) !== JSON.stringify(second))
        throw new Error("Nondeterministic translation at " + index);
      if (first.status !== "TRANSLATED")
        throw new Error(
          "Generated valid no-op did not translate at " +
            index +
            ": " +
            JSON.stringify(first),
        );
      if (first.interventions.length !== 0)
        throw new Error("No-op emitted a causal intervention at " + index);
      translated += 1;
    }
    expect(translated).toBe(500);
  }, 20_000);

  it("parses 500 generated compounds deterministically and rejects cycles", () => {
    let valid = 0;
    for (let index = 0; index < 500; index += 1) {
      const value = compound(70_000 + index);
      const first = measurableCompoundActionSchema.parse(value);
      const second = measurableCompoundActionSchema.parse(
        structuredClone(value),
      );
      expect(first).toEqual(second);
      valid += 1;
    }
    expect(valid).toBe(500);

    const cyclic: any = structuredClone(compound(80_000));
    cyclic.ordering = "ORDERED";
    cyclic.dependencies = [
      {
        kind: "START_AFTER",
        componentId: "component_0",
        dependsOn: "component_1",
      },
      {
        kind: "START_AFTER",
        componentId: "component_1",
        dependsOn: "component_0",
      },
    ];
    expect(validateActionSpaceDecision(cyclic).ok).toBe(false);
  });
});
