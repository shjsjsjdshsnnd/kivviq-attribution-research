import { describe, expect, it } from "vitest";
import {
  assessActionSpacePortfolio,
  auditDeterministicBusinessTranslation,
  validateActionSpaceEntity,
  validateActionSpacePortfolio,
} from "../../src/action_validation/index.js";
import {
  canonicalActionSchema,
  createCanonicalFixtures,
  fingerprintCanonicalAction,
} from "../../src/canonical_action/index.js";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { actionId } from "../../src/action_ontology/identity.js";
import {
  fullTranslationContext,
  pauseUnderperformingMetaCampaign,
  reduceSkuPrice899To849,
  runCollectionPromotion15FourDays,
} from "../../src/action_translation/fixtures.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";
import { evaluateEligibilityForTest } from "../action_translation/eligibility-helper.js";

const evaluatedAt = "2026-09-27T12:00:00Z";

function outcomeState(suffix: string) {
  return {
    state: "PRESENT" as const,
    value: [{
      outcomeId: "outcome.primary",
      role: "PRIMARY" as const,
      metricRef: "metric.contribution_profit",
      metricFamily: "CONTRIBUTION_PROFIT" as const,
      target: { kind: "GLOBAL" as const },
      valueType: { kind: "MONEY" as const, currency: "CAD" },
      comparison: { kind: "NONE" as const },
      successCondition: {
        kind: "ABSOLUTE_THRESHOLD" as const,
        comparator: "GTE" as const,
        threshold: { valueType: "MONEY" as const, amountMinor: 1, currency: "CAD" },
      },
      horizon: { amount: 30, unit: "DAY" as const, anchor: "ACTION_EFFECTIVE" as const },
      evidencePolicyRef: "evidence.policy.incremental",
      sourceDefinitionRef: {
        registryRef: "metric.registry",
        code: "contribution_profit",
        version: "1",
      },
      decisionLedger: {
        outcomeKey: `decision.outcome.${suffix}`,
        evidenceSlotRef: `decision.evidence.${suffix}`,
      },
      learning: {
        signalRef: `learning.signal.${suffix}`,
        updateRuleRef: "learning.rule.observed",
      },
    }],
  };
}

const timing = createCanonicalFixtures()[2]!.action!.timing;

function generatedNoOp(id: string) {
  return canonicalActionSchema.parse({
    schemaVersion: "2.0.0",
    actionId: id,
    what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
    timing,
    outcomes: outcomeState(id.replace(/^action_/, "")),
    provenance: ["test.generated"],
  });
}

function interventionMeaning(result: ReturnType<typeof translateBusinessAction>) {
  if (result.status !== "TRANSLATED") return result.status;
  return result.interventions.map((intervention) => ({
    interventionType: intervention.interventionType,
    target: intervention.target,
    scope: intervention.scope,
    operation: intervention.operation,
    effectiveTime: intervention.effectiveTime,
    duration: intervention.duration,
    endCondition: intervention.endCondition,
  }));
}

describe("Step 24 Action Space validation and adversarial tests", () => {
  it("validates 4,096 generated measurable Actions deterministically", () => {
    for (let index = 0; index < 4_096; index += 1) {
      const action = generatedNoOp(`action_generated_${index}`);
      const first = validateActionSpaceEntity(action);
      const second = validateActionSpaceEntity(action);
      expect(first).toEqual(second);
      expect(first.valid).toBe(true);
      if (first.valid) {
        expect(first.entity.entityKind).toBe("ACTION");
        expect(first.entity.fingerprint).toBe(fingerprintCanonicalAction(action));
      }
    }
  });

  it("rejects thousands of invalid targets and impossible parameters", () => {
    const base = adaptLegacyAction(increaseGoogleShoppingBudget20);
    for (let index = 0; index < 1_024; index += 1) {
      const invalidTarget = {
        ...base,
        actionId: `action_bad_target_${index}`,
        what: {
          ...base.what,
          target: { kind: "planet", planetId: "mars" },
        },
      };
      expect(validateActionSpaceEntity(invalidTarget).valid).toBe(false);

      const invalidParameter = {
        ...base,
        actionId: `action_bad_parameter_${index}`,
        what: {
          ...base.what,
          parameters: {
            ...(base.what as any).parameters,
            operation: {
              ...(base.what as any).parameters.operation,
              factor: -1,
            },
          },
        },
      };
      expect(validateActionSpaceEntity(invalidParameter).valid).toBe(false);
    }
  });

  it("rejects hidden God-mode outcome information across generated Actions", () => {
    for (let index = 0; index < 512; index += 1) {
      const candidate = {
        ...generatedNoOp(`action_hidden_${index}`),
        outcomes: {
          ...outcomeState(`hidden_${index}`),
          value: outcomeState(`hidden_${index}`).value.map((outcome) => ({
            ...outcome,
            sourceDefinitionRef: {
              ...outcome.sourceDefinitionRef,
              registryRef: "ground_truth.metrics",
            },
          })),
        },
      };
      expect(validateActionSpaceEntity(candidate).valid).toBe(false);
    }
  });

  it("rejects malformed compound decisions at scale", () => {
    for (let index = 0; index < 512; index += 1) {
      const left = generatedNoOp(`action_compound_${index}_left`);
      const right = generatedNoOp(`action_compound_${index}_right`);
      const malformed = {
        schemaVersion: 1,
        kind: "compound_action",
        compoundActionId: `compound_generated_${index}`,
        components: [
          { componentId: "component.left", role: "PRIMARY", action: left },
          { componentId: "component.right", role: "SECONDARY", action: right },
        ],
        ordering: "ORDERED",
        concurrency: "INDEPENDENT_TIMING",
        dependencies: [{
          kind: "START_AFTER",
          componentId: "component.right",
          dependsOn: "component.missing",
        }],
        atomicity: "ALL_OR_NOTHING",
        failurePolicy: "STOP_REMAINING",
        rollbackPolicy: "NO_AUTOMATIC_ROLLBACK",
        constraints: [],
        populationRelationships: [],
        measurementHorizon: { amount: 7, unit: "DAY" },
        provenance: ["test.generated"],
      };
      expect(validateActionSpaceEntity(malformed).valid).toBe(false);
    }
  });

  it("validates more than two thousand Action portfolios and rejects duplicate identities", () => {
    for (let index = 0; index < 1_024; index += 1) {
      const left = generatedNoOp(`action_portfolio_${index}_left`);
      const right = generatedNoOp(`action_portfolio_${index}_right`);
      expect(validateActionSpacePortfolio([left, right]).valid).toBe(true);
      expect(validateActionSpacePortfolio([left, left]).valid).toBe(false);
    }
  });

  it("rejects conflicting portfolios through the canonical conflict engine", () => {
    for (let index = 0; index < 128; index += 1) {
      const right = generatedNoOp(`action_conflict_${index}_right`);
      const rightRef = {
        entityKind: "ACTION" as const,
        actionId: right.actionId,
        actionFingerprint: fingerprintCanonicalAction(right),
      };
      const left = canonicalActionSchema.parse({
        ...generatedNoOp(`action_conflict_${index}_left`),
        conflicts: [{
          conflictId: `conflict.generated.${index}`,
          kind: "MUTUALLY_EXCLUSIVE_INTENT",
          target: { kind: "GLOBAL" },
          scope: { coordinates: [{ kind: "GLOBAL" }] },
          overlapRule: "EFFECTIVE_OVERLAP",
          counterparty: rightRef,
        }],
      });
      const assessed = assessActionSpacePortfolio([left, right], {
        evaluatedAt,
        evaluationBoundary: "TRANSLATION_TIME",
        maximumAgeSeconds: 3600,
        registry: [
          { entityKind: "ACTION", action: left },
          { entityKind: "ACTION", action: right },
        ],
        timingContexts: {},
        scopeIntersectionReceipts: [],
        priceBaselineReceipts: [],
        partitionReceipts: [],
      });
      expect(assessed.valid).toBe(true);
      if (assessed.valid)
        expect(assessed.compatibility.status).toBe("CONFLICTING");
    }
  });

  it("rejects a validly-defined Action when a hard constraint is violated", () => {
    const action = canonicalActionSchema.parse({
      ...generatedNoOp("action_constraint_violation"),
      constraints: [{
        constraintId: "constraint.policy",
        kind: "CUSTOM",
        target: { kind: "GLOBAL" },
        evaluationBoundary: "TRANSLATION_TIME",
        whenUnknown: "INELIGIBLE",
        registryRef: "merchant.policy",
        code: "allowed",
      }],
    });
    const evaluated = evaluateEligibilityForTest(
      action,
      "TRANSLATION_TIME",
      evaluatedAt,
      "INELIGIBLE",
    );
    const reference = {
      entityKind: "ACTION" as const,
      actionId: action.actionId,
      actionFingerprint: fingerprintCanonicalAction(action),
    };
    const result = translateCanonicalAction(action, {
      timing: { approvedClock: evaluatedAt },
      eligibility: evaluated.eligibility,
      eligibilityEvaluationContext: evaluated.evaluationContext,
      eligibilityResourceRequirements: [],
      eligibilityMaximumAgeSeconds: 3600,
      portfolioReferences: [reference],
      portfolioCompatibilityContext: {
        evaluatedAt,
        evaluationBoundary: "TRANSLATION_TIME",
        maximumAgeSeconds: 3600,
        registry: [{ entityKind: "ACTION", action }],
        timingContexts: {},
        scopeIntersectionReceipts: [],
        priceBaselineReceipts: [],
        partitionReceipts: [],
      },
    });
    expect(result.status).toBe("INELIGIBLE_ACTION");
  });

  it("translates 2,000 valid business Actions deterministically without semantic drift", () => {
    const bases = [
      increaseGoogleShoppingBudget20,
      pauseUnderperformingMetaCampaign,
      reduceSkuPrice899To849,
      runCollectionPromotion15FourDays,
    ] as const;
    const expected = new Map(
      bases.map((base) => [
        base.actionId,
        interventionMeaning(translateBusinessAction(base, fullTranslationContext)),
      ]),
    );

    for (let index = 0; index < 2_000; index += 1) {
      const base = bases[index % bases.length]!;
      const clone = assertValidAction({
        ...base,
        actionId: actionId(`action_translation_generated_${index}`),
        description: `Adversarial generated Action ${index}; structured semantics unchanged.`,
      });
      const context =
        base.actionId === increaseGoogleShoppingBudget20.actionId
          ? {
              ...fullTranslationContext,
              referenceBindings: fullTranslationContext.referenceBindings.map(
                (binding) =>
                  binding.actionId === increaseGoogleShoppingBudget20.actionId
                    ? { ...binding, actionId: clone.actionId }
                    : binding,
              ),
            }
          : fullTranslationContext;
      const audit = auditDeterministicBusinessTranslation(clone, context);
      expect(audit.deterministic).toBe(true);
      expect(audit.inputUnchanged).toBe(true);
      expect(audit.provenancePreserved).toBe(true);
      expect(audit.first.status).toBe("TRANSLATED");
      expect(interventionMeaning(audit.first)).toEqual(expected.get(base.actionId));
    }
  });
});
